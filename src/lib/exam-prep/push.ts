/**
 * Push one library paper to exam-prep.
 *
 * Questions are written in batches. A batch is recorded locally only after
 * exam-prep accepts every row in it. The next push skips a question when that
 * record matches the current content and the remote rows are still complete.
 * A dropped connection therefore resumes at the first unconfirmed question.
 *
 * Child rows are deleted and upserted with stable ids, so repeating a batch
 * cannot duplicate options, translations, or links. Question rows that are no
 * longer in the paper are unlinked and deactivated. They are not deleted,
 * because attempt history references them.
 */
import type { ExamPrepExport } from "@/lib/exam-prep-export";
import {
  buildPushPlan,
  emptyPresence,
  questionNeedsPush,
  readContainerId,
  validateExamPrepExport,
  type PushPlan,
  type QuestionPushUnit,
  type RemotePresence,
  type Row,
} from "@/lib/exam-prep/push-plan";
import type { RemoteWriter } from "@/lib/exam-prep/remote-writer";

const DEFAULT_STANDARDS: Record<number, { name: string; display_order: number }> = {
  5: { name: "5th", display_order: 5 },
  8: { name: "8th", display_order: 8 },
};

const BATCH_SIZE = 20;

export type PushLedgerStatus = {
  status: "in_progress" | "incomplete" | "complete";
  total: number;
  synced: number;
  error: string | null;
};

export type PushLedger = {
  read(documentId: string): Promise<Map<string, string>>;
  mark(
    documentId: string,
    entries: { questionId: string; contentHash: string }[],
  ): Promise<void>;
  remove(documentId: string, questionIds: string[]): Promise<void>;
  saveStatus(documentId: string, status: PushLedgerStatus): Promise<void>;
};

export type ExamPrepPushResult = {
  documentId: string;
  title: string;
  total: number;
  pushed: number;
  skipped: number;
  removed: number;
  complete: boolean;
  error: string | null;
};

export type PushDependencies = {
  writer: RemoteWriter;
  ledger: PushLedger;
  batchSize?: number;
  now?: () => string;
};

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function uniqueRows(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const row of rows) {
    const id = String(row["id"] ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function questionWrite(row: Row, now: string): Row {
  const next = { ...row };
  delete next["created_at"];
  delete next["created_by"];
  next["updated_at"] = now;
  return next;
}

function resultBase(plan: { documentId: string; title: string; total: number }): ExamPrepPushResult {
  return {
    documentId: plan.documentId,
    title: plan.title,
    total: plan.total,
    pushed: 0,
    skipped: 0,
    removed: 0,
    complete: false,
    error: null,
  };
}

async function assertIdsExist(
  writer: RemoteWriter,
  table: string,
  ids: number[],
): Promise<void> {
  if (!ids.length) return;
  const rows = await writer.selectIn(table, "id", "id", ids);
  const found = new Set(rows.map((row) => Number(row["id"])));
  const missing = ids.filter((id) => !found.has(id));
  if (!missing.length) return;
  throw new Error(
    `${table} ${missing.join(", ")} are not in exam-prep. Import the catalog in Settings so these ids match.`,
  );
}

async function ensureStandards(writer: RemoteWriter, ids: number[]): Promise<void> {
  const known = ids.filter((id) => id in DEFAULT_STANDARDS);
  if (!known.length) return;
  const existing = await writer.selectIn("standards", "id", "id", known);
  const found = new Set(existing.map((row) => Number(row["id"])));
  const missing = known
    .filter((id) => !found.has(id))
    .map((id) => ({ id, ...DEFAULT_STANDARDS[id]! }));
  if (missing.length) {
    await writer.upsert("standards", missing, { onConflict: "id", ignoreDuplicates: true });
  }
}

async function upsertContainer(writer: RemoteWriter, plan: PushPlan): Promise<void> {
  const table = plan.kind === "paper" ? "papers" : "tests";
  const existing = await writer.selectEq(table, "id,is_published,created_at", "id", plan.documentId);
  const row = { ...plan.container };
  if (existing[0]) {
    row["is_published"] = existing[0]["is_published"];
    delete row["created_at"];
  }
  await writer.upsert(table, [row]);
}

async function loadPresence(writer: RemoteWriter, plan: PushPlan): Promise<Map<string, RemotePresence>> {
  const ids = plan.units.map((unit) => unit.questionId);
  const presence = new Map<string, RemotePresence>();
  for (const id of ids) presence.set(id, emptyPresence());
  if (!ids.length) return presence;

  const linkTable = plan.kind === "paper" ? "paper_questions" : "test_questions";
  const linkColumn = plan.kind === "paper" ? "paper_id" : "test_id";
  const links = await writer.selectEq(linkTable, "question_id", linkColumn, plan.documentId);
  for (const row of links) {
    const state = presence.get(String(row["question_id"] ?? ""));
    if (state) state.linked = true;
  }

  const countRows = async (table: string, field: keyof RemotePresence) => {
    const rows = await writer.selectIn(table, "question_id", "question_id", ids);
    for (const row of rows) {
      const state = presence.get(String(row["question_id"] ?? ""));
      if (state && field !== "linked") state[field] += 1;
    }
  };
  await countRows("question_translations", "translations");
  await countRows("question_options", "options");
  await countRows("question_tags", "tags");
  await countRows("matching_items", "matchingItems");
  await countRows("matching_pairs", "matchingPairs");
  await countRows("group_questions", "groupLinks");

  const optionOwner = new Map<string, string>();
  for (const unit of plan.units) {
    for (const option of unit.options) optionOwner.set(String(option["id"]), unit.questionId);
  }
  const optionIds = [...optionOwner.keys()];
  const optionTranslations = await writer.selectIn(
    "option_translations",
    "option_id",
    "option_id",
    optionIds,
  );
  for (const row of optionTranslations) {
    const questionId = optionOwner.get(String(row["option_id"] ?? ""));
    const state = questionId ? presence.get(questionId) : undefined;
    if (state) state.optionTranslations += 1;
  }

  const groupOwner = new Map<string, string[]>();
  for (const unit of plan.units) {
    if (!unit.group) continue;
    const groupId = String(unit.group["id"]);
    const owners = groupOwner.get(groupId);
    if (owners) owners.push(unit.questionId);
    else groupOwner.set(groupId, [unit.questionId]);
  }
  const groupTranslations = await writer.selectIn(
    "question_group_translations",
    "group_id",
    "group_id",
    [...groupOwner.keys()],
  );
  const translatedGroups = new Set(groupTranslations.map((row) => String(row["group_id"] ?? "")));
  for (const [groupId, questionIds] of groupOwner) {
    if (!translatedGroups.has(groupId)) continue;
    for (const questionId of questionIds) {
      const state = presence.get(questionId);
      if (state) state.groupTranslations = 1;
    }
  }
  return presence;
}

async function replaceBatch(
  writer: RemoteWriter,
  plan: PushPlan,
  batch: QuestionPushUnit[],
  now: string,
): Promise<string[]> {
  const ids = batch.map((unit) => unit.questionId);
  await writer.upsert(
    "questions",
    batch.map((unit) => questionWrite(unit.question, now)),
  );

  const previousGroups = await writer.selectIn("group_questions", "group_id", "question_id", ids);
  const retired = previousGroups.map((row) => String(row["group_id"] ?? "")).filter(Boolean);

  await writer.deleteIn("matching_pairs", "question_id", ids);
  await writer.deleteIn("matching_items", "question_id", ids);
  await writer.deleteIn("question_options", "question_id", ids);
  await writer.deleteIn("question_tags", "question_id", ids);
  await writer.deleteIn("question_translations", "question_id", ids);
  await writer.deleteIn("group_questions", "question_id", ids);

  const groups = uniqueRows(batch.flatMap((unit) => (unit.group ? [unit.group] : [])));
  const groupTranslations = uniqueRows(
    batch.flatMap((unit) => (unit.groupTranslation ? [unit.groupTranslation] : [])),
  );
  await writer.upsert("question_groups", groups);
  await writer.deleteIn(
    "question_group_translations",
    "group_id",
    groups.map((group) => String(group["id"])),
  );
  await writer.upsert("question_group_translations", groupTranslations);
  await writer.upsert(
    "question_translations",
    batch.map((unit) => unit.translation),
  );
  await writer.upsert(
    "question_options",
    batch.flatMap((unit) => unit.options),
  );
  await writer.upsert(
    "option_translations",
    batch.flatMap((unit) => unit.optionTranslations),
  );
  await writer.upsert(
    "question_tags",
    batch.flatMap((unit) => unit.tags),
  );
  await writer.upsert(
    "matching_items",
    batch.flatMap((unit) => unit.matchingItems),
  );
  await writer.upsert(
    "matching_pairs",
    batch.flatMap((unit) => unit.matchingPairs),
  );
  await writer.upsert(
    "group_questions",
    batch.flatMap((unit) => (unit.groupQuestion ? [unit.groupQuestion] : [])),
  );
  const linkTable = plan.kind === "paper" ? "paper_questions" : "test_questions";
  await writer.upsert(
    linkTable,
    batch.map((unit) => unit.link),
  );
  return retired;
}

async function unlinkRemoved(
  writer: RemoteWriter,
  plan: PushPlan,
  questionIds: string[],
): Promise<void> {
  if (!questionIds.length) return;
  const linkTable = plan.kind === "paper" ? "paper_questions" : "test_questions";
  const linkColumn = plan.kind === "paper" ? "paper_id" : "test_id";
  await writer.deleteIn(linkTable, "question_id", questionIds, {
    column: linkColumn,
    value: plan.documentId,
  });
  await writer.deleteIn("group_questions", "question_id", questionIds);
  await writer.updateIn("questions", { is_active: false }, "id", questionIds);
}

async function deleteEmptyGroups(
  writer: RemoteWriter,
  plan: PushPlan,
  retired: Set<string>,
): Promise<void> {
  const desired = new Set(
    plan.units.flatMap((unit) => (unit.group ? [String(unit.group["id"])] : [])),
  );
  const candidates = [...retired].filter((id) => id && !desired.has(id));
  if (!candidates.length) return;
  const remaining = await writer.selectIn("group_questions", "group_id", "group_id", candidates);
  const used = new Set(remaining.map((row) => String(row["group_id"] ?? "")));
  const empty = candidates.filter((id) => !used.has(id));
  await writer.deleteIn("question_groups", "id", empty);
}

async function deleteUnusedSections(writer: RemoteWriter, plan: PushPlan): Promise<void> {
  if (plan.kind !== "test") return;
  const remote = await writer.selectEq("test_sections", "id", "test_id", plan.documentId);
  const desired = new Set(plan.sections.map((section) => String(section["id"])));
  const stale = remote.map((row) => String(row["id"] ?? "")).filter((id) => id && !desired.has(id));
  if (!stale.length) return;
  const rules = await writer.selectIn("test_rules", "section_id", "section_id", stale);
  const blocked = new Set(rules.map((row) => String(row["section_id"] ?? "")));
  await writer.deleteIn(
    "test_sections",
    "id",
    stale.filter((id) => !blocked.has(id)),
  );
}

function resumeMessage(message: string, synced: number, total: number): string {
  if (!total) return message;
  return `${synced} of ${total} questions are saved on exam-prep. ${message} Push again to resume.`;
}

export async function runExamPrepPush(
  payload: ExamPrepExport,
  deps: PushDependencies,
): Promise<ExamPrepPushResult> {
  const errors = validateExamPrepExport(payload);
  const documentId = readContainerId(payload);
  if (errors.length || !documentId) {
    return {
      documentId: documentId ?? "",
      title: "",
      total: 0,
      pushed: 0,
      skipped: 0,
      removed: 0,
      complete: false,
      error: errors.join(" ") || "The export has no paper to push.",
    };
  }

  let plan: PushPlan;
  try {
    plan = buildPushPlan(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare the push.";
    return { ...resultBase({ documentId, title: "", total: 0 }), error: message };
  }

  const now = deps.now ?? (() => new Date().toISOString());
  const batchSize = deps.batchSize ?? BATCH_SIZE;
  let pushed = 0;
  let skipped = 0;
  let removed = 0;
  const base = resultBase({ documentId: plan.documentId, title: plan.title, total: plan.units.length });

  try {
    await deps.ledger.saveStatus(plan.documentId, {
      status: "in_progress",
      total: plan.units.length,
      synced: 0,
      error: null,
    });
    await ensureStandards(deps.writer, plan.standardIds);
    await assertIdsExist(deps.writer, "standards", plan.standardIds);
    await assertIdsExist(deps.writer, "subjects", plan.subjectIds);
    await assertIdsExist(deps.writer, "topics", plan.topicIds);
    await assertIdsExist(deps.writer, "streams", plan.streamIds);
    await upsertContainer(deps.writer, plan);
    if (plan.kind === "test") await deps.writer.upsert("test_sections", plan.sections);

    const linkTable = plan.kind === "paper" ? "paper_questions" : "test_questions";
    const linkColumn = plan.kind === "paper" ? "paper_id" : "test_id";
    const remoteLinks = await deps.writer.selectEq(
      linkTable,
      "question_id",
      linkColumn,
      plan.documentId,
    );
    const desired = new Set(plan.units.map((unit) => unit.questionId));
    const stale = [
      ...new Set(
        remoteLinks
          .map((row) => String(row["question_id"] ?? ""))
          .filter((id) => id && !desired.has(id)),
      ),
    ];
    await unlinkRemoved(deps.writer, plan, stale);
    await deps.ledger.remove(plan.documentId, stale);
    removed = stale.length;

    const ledger = await deps.ledger.read(plan.documentId);
    const presence = await loadPresence(deps.writer, plan);
    const pending = plan.units.filter((unit) =>
      questionNeedsPush(unit, ledger.get(unit.questionId), presence.get(unit.questionId)),
    );
    skipped = plan.units.length - pending.length;

    const retiredGroups = new Set<string>();
    for (const batch of chunks(pending, batchSize)) {
      const retired = await replaceBatch(deps.writer, plan, batch, now());
      for (const groupId of retired) retiredGroups.add(groupId);
      await deps.ledger.mark(
        plan.documentId,
        batch.map((unit) => ({ questionId: unit.questionId, contentHash: unit.contentHash })),
      );
      pushed += batch.length;
      await deps.ledger.saveStatus(plan.documentId, {
        status: "in_progress",
        total: plan.units.length,
        synced: skipped + pushed,
        error: null,
      });
    }

    await deleteEmptyGroups(deps.writer, plan, retiredGroups);
    await deleteUnusedSections(deps.writer, plan);
    await deps.ledger.saveStatus(plan.documentId, {
      status: "complete",
      total: plan.units.length,
      synced: plan.units.length,
      error: null,
    });
    return { ...base, pushed, skipped, removed, complete: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Push failed.";
    const synced = skipped + pushed;
    try {
      await deps.ledger.saveStatus(plan.documentId, {
        status: "incomplete",
        total: plan.units.length,
        synced,
        error: message,
      });
    } catch {
      // The question ledger is the resume source. A status-row failure must not hide the cause.
    }
    return {
      ...base,
      pushed,
      skipped,
      removed,
      error: resumeMessage(message, synced, plan.units.length),
    };
  }
}
