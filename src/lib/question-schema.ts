/**
 * Canonical JSON shape for an extracted question paper.
 * This is the contract for the downloadable JSON and the `papers.questions` column.
 */

export const QUESTION_TYPES = [
  "mcq",
  "multi_select",
  "true_false",
  "fill_blank",
  "assertion_reason",
  "comprehension",
  "match_the_following",
  "short_answer",
  "long_answer",
  "numerical",
  "diagram",
  "unknown",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: "Multiple choice",
  multi_select: "Multiple correct",
  true_false: "True / False",
  fill_blank: "Fill in the blanks",
  assertion_reason: "Assertion & reason",
  comprehension: "Comprehension",
  match_the_following: "Match the following",
  short_answer: "Short answer",
  long_answer: "Long answer",
  numerical: "Numerical",
  diagram: "Diagram based",
  unknown: "Unclassified",
};

export type Option = {
  key: string;
  text: string;
  is_correct?: boolean | null;
};

export type MatchPair = {
  left: string;
  right: string;
};

export type Figure = {
  /** Plain-language description of the figure, written by the AI reader. */
  description: string;
  /** Optional caption printed under the figure in the paper. */
  caption?: string | null;
  /** Normalised crop box on the source page: [x, y, width, height] in 0..1. */
  bbox?: [number, number, number, number] | null;
  /** Index of the uploaded page the figure was found on. */
  page?: number | null;
  /** Storage path of the cropped figure image, once uploaded. */
  image_path?: string | null;
};

export type Question = {
  id: string;
  number: string | null;
  type: QuestionType;
  /** Question text. Math is inline LaTeX between $...$ or display LaTeX between $$...$$. */
  stem: string;
  instructions?: string | null;
  /** Shared passage / case study text for comprehension sets. */
  passage?: string | null;
  assertion?: string | null;
  reason?: string | null;
  options: Option[];
  /** One entry per blank, in order, for fill-in-the-blanks. */
  blanks: string[];
  match_pairs: MatchPair[];
  /** Sub-questions, used by comprehension sets. */
  sub_questions: Question[];
  /** Answer keys (option keys) when the paper prints them. */
  answer_keys: string[];
  answer_text?: string | null;
  answer_boolean?: boolean | null;
  explanation?: string | null;
  marks?: number | null;
  section?: string | null;
  difficulty?: "easy" | "medium" | "hard" | null;
  tags: string[];
  figures: Figure[];
  page?: number | null;
  /** AI confidence in the reading of this question, 0..1. */
  confidence?: number | null;
  /** Set after a reviewer compares this extraction with the source page. */
  approved: boolean;
};

export type PaperMeta = {
  title: string;
  subject?: string | null;
  exam?: string | null;
  notes?: string | null;
};

export type PaperExport = {
  schema_version: 1;
  paper: PaperMeta & { id?: string; created_at?: string };
  question_count: number;
  questions: Question[];
};

export function emptyQuestion(partial: Partial<Question> = {}): Question {
  return {
    id: crypto.randomUUID(),
    number: null,
    type: "unknown",
    stem: "",
    options: [],
    blanks: [],
    match_pairs: [],
    sub_questions: [],
    answer_keys: [],
    tags: [],
    figures: [],
    approved: false,
    ...partial,
  };
}

/** Coerce loosely-shaped AI output into the canonical Question shape. */
export function normalizeQuestion(raw: unknown, page: number): Question {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const type = QUESTION_TYPES.includes(r["type"] as QuestionType)
    ? (r["type"] as QuestionType)
    : "unknown";

  const options: Option[] = arr(r["options"]).map((o, i) => {
    const oo = (o ?? {}) as Record<string, unknown>;
    return {
      key: str(oo["key"]) ?? String.fromCharCode(65 + i),
      text: str(oo["text"]) ?? "",
      is_correct: typeof oo["is_correct"] === "boolean" ? (oo["is_correct"] as boolean) : null,
    };
  });

  const bbox = (v: unknown): Figure["bbox"] => {
    if (!Array.isArray(v) || v.length !== 4) return null;
    const nums = v.map((n) => (typeof n === "number" ? Math.min(1, Math.max(0, n)) : NaN));
    return nums.some(Number.isNaN) ? null : (nums as [number, number, number, number]);
  };

  return {
    id: crypto.randomUUID(),
    number: str(r["number"]),
    type,
    stem: str(r["stem"]) ?? "",
    instructions: str(r["instructions"]),
    passage: str(r["passage"]),
    assertion: str(r["assertion"]),
    reason: str(r["reason"]),
    options,
    blanks: arr(r["blanks"]).map((b) => (typeof b === "string" ? b : "")),
    match_pairs: arr(r["match_pairs"]).map((p) => {
      const pp = (p ?? {}) as Record<string, unknown>;
      return { left: str(pp["left"]) ?? "", right: str(pp["right"]) ?? "" };
    }),
    sub_questions: arr(r["sub_questions"]).map((q) => normalizeQuestion(q, page)),
    answer_keys: arr(r["answer_keys"]).filter((k): k is string => typeof k === "string"),
    answer_text: str(r["answer_text"]),
    answer_boolean:
      typeof r["answer_boolean"] === "boolean" ? (r["answer_boolean"] as boolean) : null,
    explanation: str(r["explanation"]),
    marks: typeof r["marks"] === "number" ? (r["marks"] as number) : null,
    section: str(r["section"]),
    difficulty: (["easy", "medium", "hard"] as const).includes(r["difficulty"] as "easy")
      ? (r["difficulty"] as "easy" | "medium" | "hard")
      : null,
    tags: arr(r["tags"]).filter((t): t is string => typeof t === "string"),
    figures: arr(r["figures"]).map((f) => {
      const ff = (f ?? {}) as Record<string, unknown>;
      return {
        description: str(ff["description"]) ?? "",
        caption: str(ff["caption"]),
        bbox: bbox(ff["bbox"]) ?? null,
        page,
        image_path: null,
      };
    }),
    page,
    confidence: typeof r["confidence"] === "number" ? (r["confidence"] as number) : null,
    approved: r["approved"] === true,
  };
}

export function buildExport(meta: PaperMeta, questions: Question[], id?: string): PaperExport {
  return {
    schema_version: 1,
    paper: {
      ...meta,
      ...(id ? { id } : {}),
      created_at: new Date().toISOString(),
    },
    question_count: questions.length,
    questions,
  };
}
