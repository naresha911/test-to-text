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

export const APPROVAL_STATUSES = [
  "draft",
  "generated",
  "reviewed",
  "rejected",
  "published",
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type Option = {
  key: string;
  text: string;
  is_correct?: boolean | null;
  /** Local compatibility path. Production identity is the asset id, not this path. */
  image_path?: string | null;
  image_description?: string | null;
  /** Inline SVG markup for a generated option figure, pushed to exam-prep as text. */
  svg?: string | null;
};

export type MatchPair = {
  left: string;
  right: string;
};

/** Normalized option key token used to match figures and captions to options. */
export function optionKeyToken(value: string | null | undefined): string {
  return (value ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export const FIGURE_ROLES = [
  "question_figure",
  "option_figure",
  "source_figure",
  "answer_figure",
] as const;

export type FigureRole = (typeof FIGURE_ROLES)[number];

export const READ_FLAGS = [
  "options_in_stem",
  "missing_options",
  "broken_math",
  "suspicious_currency",
  "partial_stem",
  "number_gap",
] as const;

export type ReadFlag = (typeof READ_FLAGS)[number];

/** Printed region for one question, plus the checks that still fail. */
export type SourceBlock = {
  /** [x, y, width, height] on the source page, 0..1. Null when the lines had no boxes. */
  bbox: [number, number, number, number] | null;
  image_path?: string | null;
  flags: ReadFlag[];
  /** 1 after the page read, then one per repair attempt, up to 3. */
  passes: number;
};

export const GENERATION_METHODS = ["cropped", "svg", "canvas", "image_model", "uploaded"] as const;

export type GenerationMethod = (typeof GENERATION_METHODS)[number];

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
  /** Inline SVG markup for a generated figure, pushed to exam-prep as text. */
  svg?: string | null;
  id?: string | null;
  role?: FigureRole | null;
  generation_method?: GenerationMethod | null;
  asset_id?: string | null;
};

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ValidationCheckSummary = {
  name: string;
  status: "passed" | "failed" | "skipped" | "needs_review";
  details?: string | null;
};

export type ValidationSummary = {
  status: "passed" | "failed" | "needs_review";
  checks: ValidationCheckSummary[];
  errors?: string[];
};

export type Question = {
  id: string;
  number: string | null;
  type: QuestionType;
  /** Educational skill, separate from the render type. Absent on older papers. */
  skill_type?: string | null;
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
  /** Learner nudge only — never reveals the final answer. */
  hint?: string | null;
  /** Full worked solution / explanation (printed or AI-generated). */
  explanation?: string | null;
  marks?: number | null;
  section?: string | null;
  difficulty?: "easy" | "medium" | "hard" | null;
  tags: string[];
  figures: Figure[];
  page?: number | null;
  /** AI confidence in the reading of this question, 0..1. */
  confidence?: number | null;
  /**
   * Extraction review flag. For a generated question this is derived from
   * approval_status: true only when the status is reviewed or published.
   */
  approved: boolean;
  /** Set on generated questions. Extraction papers leave this empty. */
  approval_status?: ApprovalStatus | null;
  /** Compatibility copies. The generation job is authoritative. */
  math_spec?: { [key: string]: JsonValue } | null;
  visual_spec?: { [key: string]: JsonValue } | null;
  source_question_id?: string | null;
  generation_job_id?: string | null;
  validation?: ValidationSummary | null;
  subject_id?: number | null;
  topic_id?: number | null;
  standard_id?: number | null;
  stream_id?: number | null;
  negative_marks?: number | null;
  year?: number | null;
  source?: string | null;
  /** Reader that produced this extraction. Absent on older papers. */
  reader_id?: string | null;
  reader_version?: string | null;
  /** Crop of the printed question. Absent on older papers and on generated questions. */
  source_block?: SourceBlock | null;
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
    subject_id: null,
    topic_id: null,
    standard_id: null,
    stream_id: null,
    negative_marks: null,
    year: null,
    source: null,
    ...partial,
  };
}

function localAssetPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /^https?:/i.test(trimmed) || trimmed.startsWith("data:")) return null;
  return trimmed;
}

function specRecord(value: unknown): { [key: string]: JsonValue } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record["kind"] !== "string") return null;
  return record as { [key: string]: JsonValue };
}

function parseApprovalStatus(value: unknown): ApprovalStatus | null {
  return APPROVAL_STATUSES.includes(value as ApprovalStatus) ? (value as ApprovalStatus) : null;
}

function parseValidationSummary(value: unknown): ValidationSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const status = record["status"];
  if (status !== "passed" && status !== "failed" && status !== "needs_review") return null;
  const checks = Array.isArray(record["checks"])
    ? record["checks"].flatMap((check) => {
        if (!check || typeof check !== "object") return [];
        const row = check as Record<string, unknown>;
        const name = typeof row["name"] === "string" ? row["name"] : "";
        const checkStatus = row["status"];
        if (!name) return [];
        if (
          checkStatus === "passed" ||
          checkStatus === "failed" ||
          checkStatus === "skipped" ||
          checkStatus === "needs_review"
        ) {
          const summary: ValidationCheckSummary = {
            name,
            status: checkStatus,
            details: typeof row["details"] === "string" ? row["details"] : null,
          };
          return [summary];
        }
        return [];
      })
    : [];
  return { status, checks };
}

/** True when a generated question may enter the learner-facing exam-prep export. */
export function isLearnerFacingQuestion(question: Question): boolean {
  if (!question.approval_status) return true;
  return question.approval_status === "reviewed" || question.approval_status === "published";
}

export function withGeneratedStatus(question: Question, status: ApprovalStatus): Question {
  return {
    ...question,
    approval_status: status,
    approved: status === "reviewed" || status === "published",
  };
}

function blankOptions(count = 4): Option[] {
  return Array.from({ length: count }, (_, index) => ({
    key: String.fromCharCode(65 + index),
    text: "",
    is_correct: null,
  }));
}

const ASSERTION_REASON_OPTIONS: Option[] = [
  {
    key: "A",
    text: "Both Assertion and Reason are true and Reason is the correct explanation of Assertion.",
    is_correct: null,
  },
  {
    key: "B",
    text: "Both Assertion and Reason are true but Reason is not the correct explanation of Assertion.",
    is_correct: null,
  },
  {
    key: "C",
    text: "Assertion is true but Reason is false.",
    is_correct: null,
  },
  {
    key: "D",
    text: "Assertion is false but Reason is true.",
    is_correct: null,
  },
];

/**
 * Switch a question's type and seed the editor fields that type needs when they are empty.
 * Existing options, blanks, pairs, and sub-questions are kept.
 */
export function withQuestionType(question: Question, type: QuestionType): Question {
  if (question.type === type) return question;

  const next: Question = { ...question, type };

  if ((type === "mcq" || type === "multi_select") && next.options.length === 0) {
    next.options = blankOptions();
  }

  if (type === "assertion_reason" && next.options.length === 0) {
    next.options = ASSERTION_REASON_OPTIONS.map((option) => ({ ...option }));
  }

  if (type === "fill_blank" && next.blanks.length === 0) {
    next.blanks = [""];
  }

  if (type === "match_the_following" && next.match_pairs.length === 0) {
    next.match_pairs = Array.from({ length: 4 }, () => ({ left: "", right: "" }));
  }

  if (type === "comprehension" && next.sub_questions.length === 0) {
    next.sub_questions = [
      emptyQuestion({
        type: "short_answer",
        ...(question.page != null ? { page: question.page } : {}),
      }),
    ];
  }

  return next;
}

/** A blank question the reviewer typed in, ready to edit and sorted by `number`. */
export function createManualQuestion(
  input: { number: string; type: QuestionType } & Partial<Omit<Question, "id" | "number" | "type">>,
): Question {
  const { number, type, ...rest } = input;
  return withQuestionType(
    emptyQuestion({
      ...rest,
      number: number.trim(),
      source: rest.source ?? "manual",
    }),
    type,
  );
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
      image_path: localAssetPath(oo["image_path"]),
      image_description: str(oo["image_description"]),
      svg: str(oo["svg"]) ?? str(oo["image_svg"]),
    };
  });

  const bbox = (v: unknown): Figure["bbox"] => {
    if (!Array.isArray(v) || v.length !== 4) return null;
    const nums = v.map((n) => (typeof n === "number" ? Math.min(1, Math.max(0, n)) : NaN));
    return nums.some(Number.isNaN) ? null : (nums as [number, number, number, number]);
  };

  const approvalStatus = parseApprovalStatus(r["approval_status"]);

  return {
    id: crypto.randomUUID(),
    number: str(r["number"]),
    type,
    skill_type: str(r["skill_type"]),
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
    hint: str(r["hint"]),
    explanation: str(r["explanation"]),
    marks: typeof r["marks"] === "number" ? (r["marks"] as number) : null,
    section: str(r["section"]),
    difficulty: (["easy", "medium", "hard"] as const).includes(r["difficulty"] as "easy")
      ? (r["difficulty"] as "easy" | "medium" | "hard")
      : null,
    tags: arr(r["tags"]).filter((t): t is string => typeof t === "string"),
    figures: arr(r["figures"]).map((f) => {
      const ff = (f ?? {}) as Record<string, unknown>;
      const role = FIGURE_ROLES.includes(ff["role"] as FigureRole)
        ? (ff["role"] as FigureRole)
        : null;
      const generationMethod = GENERATION_METHODS.includes(
        ff["generation_method"] as GenerationMethod,
      )
        ? (ff["generation_method"] as GenerationMethod)
        : null;
      return {
        description: str(ff["description"]) ?? "",
        caption: str(ff["caption"]),
        bbox: bbox(ff["bbox"]) ?? null,
        page: typeof ff["page"] === "number" ? (ff["page"] as number) : page,
        image_path: localAssetPath(ff["image_path"]),
        svg: str(ff["svg"]) ?? str(ff["image_svg"]),
        id: str(ff["id"]),
        role,
        generation_method: generationMethod,
        asset_id: str(ff["asset_id"]),
      };
    }),
    page,
    confidence: typeof r["confidence"] === "number" ? (r["confidence"] as number) : null,
    approved: approvalStatus
      ? approvalStatus === "reviewed" || approvalStatus === "published"
      : r["approved"] === true,
    approval_status: approvalStatus,
    math_spec: specRecord(r["math_spec"]),
    visual_spec: specRecord(r["visual_spec"]),
    source_question_id: str(r["source_question_id"]),
    generation_job_id: str(r["generation_job_id"]),
    validation: parseValidationSummary(r["validation"]),
    subject_id: typeof r["subject_id"] === "number" ? (r["subject_id"] as number) : null,
    topic_id: typeof r["topic_id"] === "number" ? (r["topic_id"] as number) : null,
    standard_id: typeof r["standard_id"] === "number" ? (r["standard_id"] as number) : null,
    stream_id: typeof r["stream_id"] === "number" ? (r["stream_id"] as number) : null,
    negative_marks:
      typeof r["negative_marks"] === "number" ? (r["negative_marks"] as number) : null,
    year: typeof r["year"] === "number" ? (r["year"] as number) : null,
    source: str(r["source"]),
    reader_id: str(r["reader_id"]),
    reader_version: str(r["reader_version"]),
    ...sourceBlockFields(r["source_block"], bbox),
  };
}

function sourceBlockFields(
  value: unknown,
  bbox: (value: unknown) => Figure["bbox"],
): { source_block: SourceBlock } | Record<string, never> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  const flags = (Array.isArray(row["flags"]) ? row["flags"] : []).filter((flag): flag is ReadFlag =>
    READ_FLAGS.includes(flag as ReadFlag),
  );
  const passes =
    typeof row["passes"] === "number" && Number.isFinite(row["passes"])
      ? Math.min(3, Math.max(1, Math.round(row["passes"])))
      : 1;
  return {
    source_block: {
      bbox: bbox(row["bbox"]) ?? null,
      image_path: localAssetPath(row["image_path"]),
      flags,
      passes,
    },
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

/**
 * 1-based page text from the reviewer. Empty means no page.
 * Returns null when the text is not a whole number of 1 or more.
 */
export function parseDisplayedPage(value: string): { page: number | null } | null {
  const trimmed = value.trim();
  if (!trimmed) return { page: null };
  if (!/^\d+$/.test(trimmed)) return null;
  const displayed = Number(trimmed);
  if (displayed < 1) return null;
  return { page: displayed - 1 };
}

/** Deep-update a question (including nested sub_questions) by id. */
export function updateQuestionById(
  list: Question[],
  id: string,
  updater: (question: Question) => Question,
): Question[] {
  let changed = false;
  const next = list.map((question) => {
    if (question.id === id) {
      changed = true;
      return updater(question);
    }
    if (!question.sub_questions.length) return question;
    const sub_questions = updateQuestionById(question.sub_questions, id, updater);
    if (sub_questions === question.sub_questions) return question;
    changed = true;
    return { ...question, sub_questions };
  });
  return changed ? next : list;
}

/** Remove a question by id, including nested comprehension sub-questions. */
export function removeQuestionById(list: Question[], id: string): Question[] {
  return list
    .filter((question) => question.id !== id)
    .map((question) =>
      question.sub_questions.length
        ? { ...question, sub_questions: removeQuestionById(question.sub_questions, id) }
        : question,
    );
}

/** Find a question by id in a nested tree. */
export function findQuestionById(list: Question[], id: string): Question | undefined {
  for (const question of list) {
    if (question.id === id) return question;
    const nested = findQuestionById(question.sub_questions, id);
    if (nested) return nested;
  }
  return undefined;
}
