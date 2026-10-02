/**
 * Pure description of one exam-prep push: which rows belong to each question,
 * and which of those questions still need a write.
 */
import type { ExamPrepExport } from "@/lib/exam-prep-export";
import { contentHash } from "@/lib/exam-prep/stable-id";

export type Row = Record<string, unknown>;

const QUESTION_TYPES = new Set([
  "mcq_single",
  "mcq_multi",
  "true_false",
  "fill_blank",
  "short_answer",
  "matching",
  "comprehension",
  "assertion_reason",
]);

const DIFFICULTIES = new Set(["easy", "medium", "hard"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QuestionCounts = {
  translations: number;
  options: number;
  optionTranslations: number;
  tags: number;
  matchingItems: number;
  matchingPairs: number;
  groupLinks: number;
  groupTranslations: number;
};

export type RemotePresence = QuestionCounts & {
  linked: boolean;
  /** Link row currently stored for this question, when the paper still includes it. */
  link: Row | null;
};

export type QuestionPushUnit = {
  questionId: string;
  contentHash: string;
  question: Row;
  translation: Row;
  options: Row[];
  optionTranslations: Row[];
  tags: Row[];
  matchingItems: Row[];
  matchingPairs: Row[];
  group: Row | null;
  groupTranslation: Row | null;
  groupQuestion: Row | null;
  link: Row;
  counts: QuestionCounts;
};

export type PushPlan = {
  documentId: string;
  title: string;
  kind: "paper" | "test";
  container: Row;
  sections: Row[];
  units: QuestionPushUnit[];
  standardIds: number[];
  subjectIds: number[];
  topicIds: number[];
  streamIds: number[];
};

export function asRows(value: unknown[]): Row[] {
  return value.filter((row): row is Row => !!row && typeof row === "object" && !Array.isArray(row));
}

export function readContainerId(payload: ExamPrepExport): string | null {
  const paper = asRows(payload.tables.papers)[0];
  const test = asRows(payload.tables.tests)[0];
  const id = paper?.["id"] ?? test?.["id"];
  return typeof id === "string" && id ? id : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const row of rows) {
    const id = str(row[key]);
    if (!id) continue;
    const list = map.get(id);
    if (list) list.push(row);
    else map.set(id, [row]);
  }
  return map;
}

function first(map: Map<string, Row[]>, id: string): Row | null {
  return map.get(id)?.[0] ?? null;
}

/** Local image paths are not exam-prep storage keys, so they are not written. */
function withoutLocalImages(row: Row, fields: string[]): Row {
  const next = { ...row };
  for (const field of fields) next[field] = null;
  return next;
}

function integerIds(rows: Row[], key: string): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value === "number" && Number.isInteger(value)) ids.add(value);
  }
  return [...ids];
}

function fitsNumeric(value: unknown, precision: number, scale: number): boolean {
  if (value == null) return true;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const max = 10 ** (precision - scale) - 10 ** -scale;
  if (Math.abs(value) > max + 1e-9) return false;
  const factor = 10 ** scale;
  return Math.abs(value * factor - Math.round(value * factor)) < 1e-6;
}

export function validateExamPrepExport(payload: ExamPrepExport): string[] {
  const errors: string[] = [];
  const papers = asRows(payload.tables.papers);
  const tests = asRows(payload.tables.tests);
  if (papers.length + tests.length !== 1) {
    errors.push("The export must contain exactly one paper or one test.");
  }
  const container = papers[0] ?? tests[0];
  const containerId = str(container?.["id"]);
  if (!UUID_RE.test(containerId)) {
    errors.push("The paper id is not a UUID exam-prep can store.");
  }
  if (typeof container?.["standard_id"] !== "number") {
    errors.push("Choose a standard (5th or 8th) before pushing.");
  }
  if (typeof container?.["title"] !== "string" || !container["title"].trim()) {
    errors.push("The paper needs a title before it can be pushed.");
  }

  const seen = new Set<string>();
  for (const question of asRows(payload.tables.questions)) {
    const id = str(question["id"]);
    if (!UUID_RE.test(id)) {
      errors.push(`Question "${id || "(missing id)"}" is not a UUID.`);
      continue;
    }
    if (seen.has(id)) errors.push(`Question ${id} is listed more than once.`);
    seen.add(id);
    const type = str(question["question_type"]);
    if (!QUESTION_TYPES.has(type)) errors.push(`Question ${id} has unsupported type "${type}".`);
    const difficulty = question["difficulty"];
    if (difficulty != null && !DIFFICULTIES.has(str(difficulty))) {
      errors.push(`Question ${id} has unsupported difficulty "${String(difficulty)}".`);
    }
    if (!fitsNumeric(question["marks"], 4, 1)) {
      errors.push(`Question ${id} has marks outside exam-prep's numeric(4,1) range.`);
    }
    if (!fitsNumeric(question["negative_marks"], 4, 1)) {
      errors.push(`Question ${id} has negative marks outside exam-prep's numeric(4,1) range.`);
    }
    const optionKeys = new Set<string>();
    for (const option of asRows(payload.tables.question_options)) {
      if (str(option["question_id"]) !== id) continue;
      const key = str(option["option_key"]);
      if (!key) errors.push(`Question ${id} has an option without a key.`);
      else if (optionKeys.has(key)) errors.push(`Question ${id} has duplicate option key ${key}.`);
      else optionKeys.add(key);
    }
  }

  if (!asRows(payload.tables.questions).length) {
    errors.push("This paper has no learner-facing questions to push.");
  }
  return errors;
}

export function buildPushPlan(payload: ExamPrepExport): PushPlan {
  const papers = asRows(payload.tables.papers);
  const tests = asRows(payload.tables.tests);
  const kind = papers[0] ? "paper" : "test";
  const container = withoutLocalImages((papers[0] ?? tests[0]) as Row, ["pdf_path"]);
  const questions = asRows(payload.tables.questions).map((row) =>
    withoutLocalImages(row, ["diagram_path"]),
  );
  const translations = groupBy(
    asRows(payload.tables.question_translations).map((row) =>
      withoutLocalImages(row, ["explanation_diagram_path"]),
    ),
    "question_id",
  );
  const options = groupBy(asRows(payload.tables.question_options), "question_id");
  const optionTranslations = groupBy(
    asRows(payload.tables.option_translations).map((row) =>
      withoutLocalImages(row, ["option_image_path"]),
    ),
    "option_id",
  );
  const tags = groupBy(asRows(payload.tables.question_tags), "question_id");
  const matchingItems = groupBy(asRows(payload.tables.matching_items), "question_id");
  const matchingPairs = groupBy(asRows(payload.tables.matching_pairs), "question_id");
  const groups = new Map(
    asRows(payload.tables.question_groups)
      .map((row) => withoutLocalImages(row, ["shared_image_path"]))
      .map((row) => [str(row["id"]), row] as const),
  );
  const groupTranslations = groupBy(asRows(payload.tables.question_group_translations), "group_id");
  const groupQuestions = groupBy(asRows(payload.tables.group_questions), "question_id");
  const links = groupBy(
    asRows(kind === "paper" ? payload.tables.paper_questions : payload.tables.test_questions),
    "question_id",
  );

  const units = questions.map((question) => {
    const questionId = str(question["id"]);
    const questionOptions = options.get(questionId) ?? [];
    const questionOptionTranslations = questionOptions.flatMap(
      (option) => optionTranslations.get(str(option["id"])) ?? [],
    );
    const groupQuestion = first(groupQuestions, questionId);
    const group = groupQuestion ? (groups.get(str(groupQuestion["group_id"])) ?? null) : null;
    const groupTranslation = group ? first(groupTranslations, str(group["id"])) : null;
    const translation = first(translations, questionId);
    const link = first(links, questionId);
    if (!translation) throw new Error(`Question ${questionId} is missing its English text.`);
    if (!link) throw new Error(`Question ${questionId} is not linked to the paper.`);
    const unitRows = {
      question,
      translation,
      options: questionOptions,
      optionTranslations: questionOptionTranslations,
      tags: tags.get(questionId) ?? [],
      matchingItems: matchingItems.get(questionId) ?? [],
      matchingPairs: matchingPairs.get(questionId) ?? [],
      group,
      groupTranslation,
      groupQuestion,
      link,
    };
    const counts: QuestionCounts = {
      translations: 1,
      options: unitRows.options.length,
      optionTranslations: unitRows.optionTranslations.length,
      tags: unitRows.tags.length,
      matchingItems: unitRows.matchingItems.length,
      matchingPairs: unitRows.matchingPairs.length,
      groupLinks: groupQuestion ? 1 : 0,
      groupTranslations: groupTranslation ? 1 : 0,
    };
    return {
      questionId,
      contentHash: contentHash(unitRows),
      ...unitRows,
      counts,
    };
  });

  const catalogRows = [container, ...questions, ...groups.values()];
  return {
    documentId: str(container["id"]),
    title: str(container["title"]),
    kind,
    container,
    sections: asRows(payload.tables.test_sections),
    units,
    standardIds: integerIds(catalogRows, "standard_id"),
    subjectIds: integerIds(catalogRows, "subject_id"),
    topicIds: integerIds(questions, "topic_id"),
    streamIds: integerIds(catalogRows, "stream_id"),
  };
}

export function emptyPresence(): RemotePresence {
  return {
    linked: false,
    link: null,
    translations: 0,
    options: 0,
    optionTranslations: 0,
    tags: 0,
    matchingItems: 0,
    matchingPairs: 0,
    groupLinks: 0,
    groupTranslations: 0,
  };
}

function sameStoredValue(left: unknown, right: unknown): boolean {
  if (left == null && right == null) return true;
  if (typeof left === "number" || typeof right === "number") {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
  }
  return left === right;
}

/** True when the remote paper/test link still has the order, section, and marks we wrote. */
export function linkMatches(expected: Row, actual: Row | null): boolean {
  if (!actual) return false;
  return Object.entries(expected).every(([key, value]) => {
    if (key === "paper_id" || key === "test_id" || key === "question_id") return true;
    return sameStoredValue(value, actual[key]);
  });
}

/**
 * A question is already on exam-prep when the last confirmed write had this
 * exact content and the remote row counts still match that write.
 * A lost response never sets the local fingerprint, so the next push retries it.
 */
export function questionNeedsPush(
  unit: QuestionPushUnit,
  ledgerHash: string | undefined,
  remote: RemotePresence | undefined,
): boolean {
  if (ledgerHash !== unit.contentHash) return true;
  if (!remote?.linked || !linkMatches(unit.link, remote.link)) return true;
  const fields: (keyof QuestionCounts)[] = [
    "translations",
    "options",
    "optionTranslations",
    "tags",
    "matchingItems",
    "matchingPairs",
    "groupLinks",
    "groupTranslations",
  ];
  return fields.some((field) => remote[field] !== unit.counts[field]);
}
