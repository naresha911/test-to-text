import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import type { DocumentMeta } from "@/lib/document-types";
import { buildExamPrepExport } from "@/lib/exam-prep-export";
import { runExamPrepPush, type PushLedger, type PushLedgerStatus } from "@/lib/exam-prep/push";
import {
  buildPushPlan,
  questionNeedsPush,
  type RemotePresence,
} from "@/lib/exam-prep/push-plan";
import {
  ExamPrepRequestError,
  isTransientRemoteError,
  withRemoteRetry,
  type RemoteWriter,
  type RowScope,
  type UpsertOptions,
} from "@/lib/exam-prep/remote-writer";
import { sha1Bytes, uuidV5 } from "@/lib/exam-prep/stable-id";
import type { Row } from "@/lib/exam-prep/push-plan";
import { emptyQuestion, type Question } from "@/lib/question-schema";

const DOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const Q1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const Q2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const Q3 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function document(): DocumentMeta {
  return {
    id: DOC,
    kind: "past_paper",
    title: "Sample",
    year: 2024,
    standard_id: 5,
    stream_id: null,
    subject_id: null,
    topic_id: null,
    duration_minutes: 60,
    total_marks: null,
    difficulty: "medium",
    exam: null,
    notes: null,
    source: null,
    description: null,
    section_timing: false,
    negative_marking: false,
    allow_pause: true,
    max_attempts: 1,
    default_marks: 1,
    default_negative_marks: 0,
    source_document_id: null,
    generation: null,
    questions_rev: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };
}

function mcq(id: string, stem: string): Question {
  return emptyQuestion({
    id,
    type: "mcq",
    stem,
    approved: true,
    options: ["A", "B"].map((key, index) => ({
      key,
      text: `Choice ${key}`,
      is_correct: index === 0,
    })),
  });
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

class MemoryRemote implements RemoteWriter {
  readonly tables = new Map<string, Map<string, Row>>();
  failQuestionId: string | null = null;
  failTable: string | null = null;

  private bucket(table: string): Map<string, Row> {
    let found = this.tables.get(table);
    if (!found) {
      found = new Map();
      this.tables.set(table, found);
    }
    return found;
  }

  private key(table: string, row: Row): string {
    if (table === "question_tags") return `${row["question_id"]}\0${row["tag"]}`;
    if (table === "matching_pairs") {
      return `${row["question_id"]}\0${row["left_item_id"]}\0${row["right_item_id"]}`;
    }
    if (table === "group_questions") return `${row["group_id"]}\0${row["question_id"]}`;
    if (table === "paper_questions") return `${row["paper_id"]}\0${row["question_id"]}`;
    if (table === "test_questions") return `${row["test_id"]}\0${row["question_id"]}`;
    return String(row["id"] ?? "");
  }

  async selectEq(
    table: string,
    _columns: string,
    column: string,
    value: string | number,
  ): Promise<Row[]> {
    return [...(this.tables.get(table)?.values() ?? [])].filter((row) => row[column] === value);
  }

  async selectIn(
    table: string,
    _columns: string,
    column: string,
    values: Array<string | number>,
  ): Promise<Row[]> {
    const wanted = new Set(values.map(String));
    return [...(this.tables.get(table)?.values() ?? [])].filter((row) =>
      wanted.has(String(row[column] ?? "")),
    );
  }

  async upsert(table: string, rows: Row[], options?: UpsertOptions): Promise<void> {
    if (this.failTable === table) {
      throw new ExamPrepRequestError(table, "network down", null, true);
    }
    if (
      table === "questions" &&
      this.failQuestionId &&
      rows.some((row) => row["id"] === this.failQuestionId)
    ) {
      throw new ExamPrepRequestError("questions", "network down", null, true);
    }
    const bucket = this.bucket(table);
    for (const row of rows) {
      const key = this.key(table, row);
      if (options?.ignoreDuplicates && bucket.has(key)) continue;
      const previous = bucket.get(key);
      bucket.set(key, previous ? { ...previous, ...row } : { ...row });
    }
  }

  async deleteIn(
    table: string,
    column: string,
    values: Array<string | number>,
    scope?: RowScope,
  ): Promise<void> {
    const wanted = new Set(values.map(String));
    const bucket = this.tables.get(table);
    if (!bucket) return;
    const removedOptionIds: string[] = [];
    for (const [key, row] of bucket) {
      if (!wanted.has(String(row[column] ?? ""))) continue;
      if (scope && row[scope.column] !== scope.value) continue;
      if (table === "question_options") removedOptionIds.push(String(row["id"] ?? ""));
      bucket.delete(key);
    }
    if (removedOptionIds.length) {
      await this.deleteIn("option_translations", "option_id", removedOptionIds);
    }
  }

  async updateIn(
    table: string,
    patch: Row,
    column: string,
    values: Array<string | number>,
  ): Promise<void> {
    const wanted = new Set(values.map(String));
    const bucket = this.tables.get(table);
    if (!bucket) return;
    for (const [key, row] of bucket) {
      if (!wanted.has(String(row[column] ?? ""))) continue;
      bucket.set(key, { ...row, ...patch });
    }
  }
}

function memoryLedger(): PushLedger & { hashes: Map<string, string>; last: PushLedgerStatus | null } {
  const hashes = new Map<string, string>();
  const retired = new Set<string>();
  const state: { last: PushLedgerStatus | null } = { last: null };
  return {
    hashes,
    get last() {
      return state.last;
    },
    async read() {
      return new Map(hashes);
    },
    async mark(_documentId, entries) {
      for (const entry of entries) hashes.set(entry.questionId, entry.contentHash);
    },
    async remove(_documentId, questionIds) {
      for (const questionId of questionIds) hashes.delete(questionId);
    },
    async saveStatus(_documentId, status) {
      state.last = status;
    },
    async readRetiredGroups() {
      return [...retired];
    },
    async rememberRetiredGroups(_documentId, groupIds) {
      for (const groupId of groupIds) if (groupId) retired.add(groupId);
    },
    async forgetRetiredGroups(_documentId, groupIds) {
      for (const groupId of groupIds) retired.delete(groupId);
    },
  };
}

describe("stable ids", () => {
  test("sha1 matches the empty and abc vectors", () => {
    expect(hex(sha1Bytes(new Uint8Array()))).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(hex(sha1Bytes(new TextEncoder().encode("abc")))).toBe(
      "a9993e364706816aba3e25717850c26c9cd0d89d",
    );
  });

  test("uuid v5 matches the platform SHA-1 construction", () => {
    const namespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const name = "www.example.com";
    const hash = createHash("sha1")
      .update(Buffer.from(namespace.replace(/-/g, ""), "hex"))
      .update(name)
      .digest();
    const bytes = Buffer.from(hash.subarray(0, 16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    const expected = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    expect(uuidV5(namespace, name)).toBe(expected);
  });

  test("export row ids stay the same across builds", () => {
    const question = mcq(Q1, "Stem");
    const first = buildExamPrepExport(document(), [question]);
    const second = buildExamPrepExport(document(), [question]);
    expect(first.tables.question_options).toEqual(second.tables.question_options);
    expect(first.tables.question_translations).toEqual(second.tables.question_translations);
    expect(first.tables.paper_questions).toEqual(second.tables.paper_questions);
  });
});

describe("exam-prep push resume", () => {
  test("a dropped connection resumes at the first unconfirmed question", async () => {
    const remote = new MemoryRemote();
    const ledger = memoryLedger();
    remote.failQuestionId = Q2;
    const payload = buildExamPrepExport(document(), [
      mcq(Q1, "One"),
      mcq(Q2, "Two"),
      mcq(Q3, "Three"),
    ]);

    const stopped = await runExamPrepPush(payload, {
      writer: remote,
      ledger,
      batchSize: 1,
      now: () => "2026-02-01T00:00:00.000Z",
    });

    expect(stopped.complete).toBe(false);
    expect(stopped.pushed).toBe(1);
    expect(stopped.skipped).toBe(0);
    expect(stopped.error).toContain("1 of 3 questions are saved");
    expect(ledger.hashes.has(Q1)).toBe(true);
    expect(ledger.hashes.has(Q2)).toBe(false);
    expect(remote.tables.get("questions")?.has(Q1)).toBe(true);
    expect(remote.tables.get("questions")?.has(Q2)).toBe(false);
    expect(ledger.last?.status).toBe("incomplete");

    remote.failQuestionId = null;
    const resumed = await runExamPrepPush(payload, {
      writer: remote,
      ledger,
      batchSize: 1,
      now: () => "2026-02-01T00:00:00.000Z",
    });

    expect(resumed.complete).toBe(true);
    expect(resumed.skipped).toBe(1);
    expect(resumed.pushed).toBe(2);
    expect(remote.tables.get("questions")?.size).toBe(3);
    expect(remote.tables.get("paper_questions")?.size).toBe(3);
    expect(remote.tables.get("question_options")?.size).toBe(6);
    expect(ledger.last?.status).toBe("complete");
  });

  test("edited questions are pushed again and unchanged ones are skipped", async () => {
    const remote = new MemoryRemote();
    const ledger = memoryLedger();
    const deps = { writer: remote, ledger, batchSize: 10, now: () => "2026-02-01T00:00:00.000Z" };
    await runExamPrepPush(buildExamPrepExport(document(), [mcq(Q1, "One"), mcq(Q2, "Two")]), deps);

    const again = await runExamPrepPush(
      buildExamPrepExport(document(), [mcq(Q1, "One revised"), mcq(Q2, "Two")]),
      deps,
    );

    expect(again.complete).toBe(true);
    expect(again.pushed).toBe(1);
    expect(again.skipped).toBe(1);
    const updated = remote.tables.get("question_translations");
    const texts = [...(updated?.values() ?? [])].map((row) => row["question_text"]);
    expect(texts).toContain("One revised");
    expect(texts).toContain("Two");
  });

  test("a question removed from the paper is unlinked and left inactive", async () => {
    const remote = new MemoryRemote();
    const ledger = memoryLedger();
    const deps = { writer: remote, ledger, batchSize: 10, now: () => "2026-02-01T00:00:00.000Z" };
    await runExamPrepPush(
      buildExamPrepExport(document(), [mcq(Q1, "One"), mcq(Q2, "Two"), mcq(Q3, "Three")]),
      deps,
    );

    const removed = await runExamPrepPush(
      buildExamPrepExport(document(), [mcq(Q1, "One"), mcq(Q2, "Two")]),
      deps,
    );

    expect(removed.complete).toBe(true);
    expect(removed.removed).toBe(1);
    expect(removed.skipped).toBe(2);
    expect(remote.tables.get("paper_questions")?.size).toBe(2);
    expect(remote.tables.get("questions")?.get(Q3)?.["is_active"]).toBe(false);
    expect(ledger.hashes.has(Q3)).toBe(false);
  });

  test("a confirmed question is rewritten when its remote link is missing", async () => {
    const remote = new MemoryRemote();
    const ledger = memoryLedger();
    const deps = { writer: remote, ledger, batchSize: 5, now: () => "2026-02-01T00:00:00.000Z" };
    const payload = buildExamPrepExport(document(), [mcq(Q1, "One")]);
    await runExamPrepPush(payload, deps);
    remote.tables.get("paper_questions")?.clear();

    const repaired = await runExamPrepPush(payload, deps);
    expect(repaired.skipped).toBe(0);
    expect(repaired.pushed).toBe(1);
    expect(remote.tables.get("paper_questions")?.size).toBe(1);
  });

  test("an already published paper stays published", async () => {
    const remote = new MemoryRemote();
    remote.tables.set(
      "papers",
      new Map([
        [
          DOC,
          {
            id: DOC,
            title: "Old",
            is_published: true,
            created_at: "2020-01-01T00:00:00.000Z",
          },
        ],
      ]),
    );
    const ledger = memoryLedger();
    await runExamPrepPush(buildExamPrepExport(document(), [mcq(Q1, "One")]), {
      writer: remote,
      ledger,
      now: () => "2026-02-01T00:00:00.000Z",
    });
    const paper = remote.tables.get("papers")?.get(DOC);
    expect(paper?.["is_published"]).toBe(true);
    expect(paper?.["created_at"]).toBe("2020-01-01T00:00:00.000Z");
    expect(paper?.["title"]).toBe("Sample");
  });

  test("duplicate option keys are rejected before any write", async () => {
    const remote = new MemoryRemote();
    const question = mcq(Q1, "One");
    question.options = [
      { key: "A", text: "First", is_correct: true },
      { key: "A", text: "Second", is_correct: false },
    ];
    const result = await runExamPrepPush(buildExamPrepExport(document(), [question]), {
      writer: remote,
      ledger: memoryLedger(),
    });
    expect(result.complete).toBe(false);
    expect(result.error).toContain("duplicate option key A");
    expect(remote.tables.size).toBe(0);
  });

  test("a practice test resumes without duplicating sections or questions", async () => {
    const remote = new MemoryRemote();
    const ledger = memoryLedger();
    const testDocument: DocumentMeta = { ...document(), kind: "practice_test" };
    const payload = buildExamPrepExport(testDocument, [mcq(Q1, "One"), mcq(Q2, "Two")]);
    const deps = { writer: remote, ledger, batchSize: 1, now: () => "2026-02-01T00:00:00.000Z" };
    const first = await runExamPrepPush(payload, deps);
    const second = await runExamPrepPush(payload, deps);
    expect(first.complete).toBe(true);
    expect(first.pushed).toBe(2);
    expect(second.skipped).toBe(2);
    expect(second.pushed).toBe(0);
    expect(remote.tables.get("tests")?.size).toBe(1);
    expect(remote.tables.get("test_sections")?.size).toBe(1);
    expect(remote.tables.get("test_questions")?.size).toBe(2);
  });

  test("re-pushing an edited question keeps translations in other languages", async () => {
    const remote = new MemoryRemote();
    const ledger = memoryLedger();
    const deps = { writer: remote, ledger, batchSize: 5, now: () => "2026-02-01T00:00:00.000Z" };
    await runExamPrepPush(buildExamPrepExport(document(), [mcq(Q1, "One")]), deps);
    const optionId = [...(remote.tables.get("question_options")?.values() ?? [])][0]?.["id"];
    remote.tables.get("question_translations")?.set("hi-question", {
      id: "11111111-1111-4111-8111-111111111111",
      question_id: Q1,
      language_code: "hi",
      question_text: "Hindi stem",
    });
    remote.tables.get("option_translations")?.set("hi-option", {
      id: "22222222-2222-4222-8222-222222222222",
      option_id: optionId,
      language_code: "hi",
      option_text: "Hindi choice",
    });

    const edited = await runExamPrepPush(
      buildExamPrepExport(document(), [mcq(Q1, "One revised")]),
      deps,
    );
    expect(edited.pushed).toBe(1);
    const questionText = [...(remote.tables.get("question_translations")?.values() ?? [])].map(
      (row) => row["question_text"],
    );
    expect(questionText).toContain("Hindi stem");
    expect(questionText).toContain("One revised");
    const optionText = [...(remote.tables.get("option_translations")?.values() ?? [])].map(
      (row) => row["option_text"],
    );
    expect(optionText).toContain("Hindi choice");

    const again = await runExamPrepPush(
      buildExamPrepExport(document(), [mcq(Q1, "One revised")]),
      deps,
    );
    expect(again.skipped).toBe(1);
    expect(again.pushed).toBe(0);
  });

  test("a drifted section is rewritten and an unused section is removed", async () => {
    const remote = new MemoryRemote();
    const ledger = memoryLedger();
    const testDocument: DocumentMeta = { ...document(), kind: "practice_test" };
    const deps = { writer: remote, ledger, now: () => "2026-02-01T00:00:00.000Z" };
    await runExamPrepPush(buildExamPrepExport(testDocument, [mcq(Q1, "One")]), deps);
    const oldSection = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    remote.tables.get("test_sections")?.set(oldSection, {
      id: oldSection,
      test_id: DOC,
      name: "Old",
    });
    const link = [...(remote.tables.get("test_questions")?.values() ?? [])][0];
    if (link) link["section_id"] = oldSection;

    const result = await runExamPrepPush(buildExamPrepExport(testDocument, [mcq(Q1, "One")]), deps);
    expect(result.complete).toBe(true);
    expect(result.pushed).toBe(1);
    expect(remote.tables.get("test_sections")?.has(oldSection)).toBe(false);
    const restored = [...(remote.tables.get("test_questions")?.values() ?? [])].find(
      (row) => row["question_id"] === Q1,
    );
    expect(restored?.["section_id"]).not.toBe(oldSection);
  });

  test("a stale section that a rule still references is kept", async () => {
    const remote = new MemoryRemote();
    const ledger = memoryLedger();
    const testDocument: DocumentMeta = { ...document(), kind: "practice_test" };
    const deps = { writer: remote, ledger, now: () => "2026-02-01T00:00:00.000Z" };
    await runExamPrepPush(buildExamPrepExport(testDocument, [mcq(Q1, "One")]), deps);
    const oldSection = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await remote.upsert("test_sections", [{ id: oldSection, test_id: DOC, name: "Old" }]);
    await remote.upsert("test_rules", [
      {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        test_id: DOC,
        section_id: oldSection,
        question_count: 1,
      },
    ]);
    const link = [...(remote.tables.get("test_questions")?.values() ?? [])][0];
    if (link) link["section_id"] = oldSection;

    const result = await runExamPrepPush(buildExamPrepExport(testDocument, [mcq(Q1, "One")]), deps);
    expect(result.complete).toBe(true);
    expect(result.pushed).toBe(1);
    expect(remote.tables.get("test_sections")?.has(oldSection)).toBe(true);
  });

  test("a group unlinked by a failed push is removed on the next resume", async () => {
    const remote = new MemoryRemote();
    const ledger = memoryLedger();
    const deps = { writer: remote, ledger, now: () => "2026-02-01T00:00:00.000Z" };
    const grouped = emptyQuestion({
      id: Q1,
      type: "comprehension",
      stem: "Passage",
      passage: "Read this",
      approved: true,
      sub_questions: [mcq(Q2, "Child")],
    });
    await runExamPrepPush(buildExamPrepExport(document(), [grouped]), deps);
    const groupId = [...(remote.tables.get("question_groups")?.keys() ?? [])][0] ?? "";
    expect(groupId.length > 0).toBe(true);

    remote.failTable = "question_translations";
    const stopped = await runExamPrepPush(
      buildExamPrepExport(document(), [
        emptyQuestion({
          ...grouped,
          sub_questions: [mcq(Q2, "Child revised")],
        }),
      ]),
      deps,
    );
    expect(stopped.complete).toBe(false);
    expect(remote.tables.get("question_groups")?.has(groupId!)).toBe(true);
    expect(remote.tables.get("group_questions")?.size ?? 0).toBe(0);

    remote.failTable = null;
    const resumed = await runExamPrepPush(buildExamPrepExport(document(), [mcq(Q2, "Child alone")]), deps);
    expect(resumed.complete).toBe(true);
    expect(remote.tables.get("question_groups")?.has(groupId!)).toBe(false);
  });

  test("a later failure does not claim that earlier questions were lost", async () => {
    const remote = new MemoryRemote();
    const ledger = memoryLedger();
    const deps = { writer: remote, ledger, now: () => "2026-02-01T00:00:00.000Z" };
    await runExamPrepPush(buildExamPrepExport(document(), [mcq(Q1, "One")]), deps);
    remote.failTable = "papers";
    const stopped = await runExamPrepPush(
      buildExamPrepExport(document(), [mcq(Q1, "One"), mcq(Q2, "Two")]),
      deps,
    );
    expect(stopped.complete).toBe(false);
    expect(ledger.last?.synced).toBe(1);
  });

  test("questionNeedsPush is false only when the fingerprint and remote counts match", () => {
    const plan = buildPushPlan(buildExamPrepExport(document(), [mcq(Q1, "One")]));
    const unit = plan.units[0]!;
    const remote: RemotePresence = { linked: true, link: unit.link, ...unit.counts };
    expect(questionNeedsPush(unit, unit.contentHash, remote)).toBe(false);
    expect(questionNeedsPush(unit, "stale", remote)).toBe(true);
    expect(questionNeedsPush(unit, unit.contentHash, { ...remote, linked: false })).toBe(true);
    expect(questionNeedsPush(unit, unit.contentHash, { ...remote, options: 0 })).toBe(true);
    expect(questionNeedsPush(unit, unit.contentHash, { ...remote, link: null })).toBe(true);
  });
});

describe("remote retries", () => {
  test("transient failures are retried and constraint failures are not", async () => {
    let calls = 0;
    const value = await withRemoteRetry(async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("fetch failed");
      return "ok";
    });
    expect(value).toBe("ok");
    expect(calls).toBe(3);

    expect(isTransientRemoteError(new ExamPrepRequestError("questions", "duplicate", "23505", false))).toBe(
      false,
    );
    await expect(
      withRemoteRetry(async () => {
        throw new ExamPrepRequestError("questions", "duplicate key", "23505", false);
      }),
    ).rejects.toThrow("duplicate key");
  });
});
