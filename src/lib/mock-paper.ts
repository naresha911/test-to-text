import type { DocumentMeta, MockGenerationState, MockStrategy } from "@/lib/document-types";
import { mockGenerationTotal } from "@/lib/document-types";
import {
  buildQuestionPromptPayload,
  isPrintedDirection,
  printedInstructionText,
} from "@/lib/question-context";
import {
  emptyQuestion,
  normalizeQuestion,
  optionKeyToken,
  type Figure,
  type Question,
} from "@/lib/question-schema";

export { printedInstructionText };

export type MockPaperAudience = {
  subject?: string | null;
  exam?: string | null;
  notes?: string | null;
  standard?: string | null;
  stream?: string | null;
  /** Paper-level difficulty (easy / medium / hard). */
  difficulty?: string | null;
  topic?: string | null;
};

/** Pull a class/grade number from names like "Class 6", "6th Standard", "Grade 9". */
export function parseGradeFromStandardName(name: string | null | undefined): number | null {
  if (!name?.trim()) return null;
  const text = name.trim();
  const patterns = [
    /\b(?:class|grade|std\.?|standard)\s*[-:]?\s*(\d{1,2})\b/i,
    /\b(\d{1,2})\s*(?:st|nd|rd|th)\s*(?:class|grade|std\.?|standard)?\b/i,
    /\b(\d{1,2})\b/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;
    const grade = Number(match[1]);
    if (Number.isInteger(grade) && grade >= 1 && grade <= 12) return grade;
  }
  return null;
}

/**
 * Leveling rules for the model: respect student standard, source difficulty/intent,
 * and allow stretching at most +2 grades when appropriate.
 */
export function buildLevelingGuidance(options: {
  audience?: MockPaperAudience;
  sourceQuestion?: Question | null;
}): string[] {
  const audience = options.audience;
  const source = options.sourceQuestion ?? null;
  const studentGrade = parseGradeFromStandardName(audience?.standard ?? null);
  const maxStretchGrade = studentGrade != null ? Math.min(12, studentGrade + 2) : null;

  const sourceDifficulty =
    source?.difficulty ??
    (audience?.difficulty as "easy" | "medium" | "hard" | null | undefined) ??
    null;

  const lines: string[] = [
    "LEVELING (must follow):",
    "- Match the SOURCE question's learning intent / skill (what concept is being tested), not its wording.",
  ];

  if (audience?.standard) {
    lines.push(
      `- Student standard / grade band: ${audience.standard}${
        studentGrade != null ? ` (parsed grade ${studentGrade})` : ""
      }.`,
    );
  } else {
    lines.push(
      "- Student standard is unknown — infer an age-appropriate level from the source content and keep language/curriculum suitable.",
    );
  }

  if (studentGrade != null && maxStretchGrade != null) {
    lines.push(
      `- Target the student's grade (${studentGrade}), but you MAY go slightly harder up to about grade ${maxStretchGrade} (+2 max) when the source is already challenging or paper difficulty is hard.`,
    );
    lines.push(
      `- Do NOT use concepts, vocabulary, or methods that belong well above grade ${maxStretchGrade}.`,
    );
  }

  if (sourceDifficulty) {
    lines.push(
      `- Source / target difficulty: ${sourceDifficulty}. Keep the mock at a similar difficulty (easy→easy/medium, medium→medium, hard→medium/hard). Set the output "difficulty" field accordingly.`,
    );
  } else if (audience?.difficulty) {
    lines.push(
      `- Paper difficulty preference: ${audience.difficulty}. Align the mock to this unless the source question clearly differs.`,
    );
  } else {
    lines.push(
      '- Infer difficulty from the source (steps required, abstraction, calculation load) and set output "difficulty" to easy|medium|hard.',
    );
  }

  if (audience?.subject) lines.push(`- Subject: ${audience.subject}.`);
  if (audience?.stream) lines.push(`- Stream: ${audience.stream}.`);
  if (audience?.exam) lines.push(`- Exam / board context: ${audience.exam}.`);
  if (audience?.topic) lines.push(`- Preferred topic: ${audience.topic}.`);
  if (audience?.notes) lines.push(`- Paper notes: ${audience.notes}`);

  lines.push(
    "- Preserve pedagogical intent: same skill family (e.g. fractions word-problem, reading inference, algebra linear equations) with new numbers/context.",
  );

  return lines;
}

function describeSourceMetadata(question: Question): string[] {
  const lines: string[] = ["SOURCE METADATA (use for intent & leveling):"];
  lines.push(`- type: ${question.type}`);
  if (question.difficulty) lines.push(`- difficulty: ${question.difficulty}`);
  if (question.marks != null) lines.push(`- marks: ${question.marks}`);
  if (question.section) lines.push(`- section: ${question.section}`);
  if (question.tags.length) lines.push(`- tags: ${question.tags.join(", ")}`);
  if (question.instructions)
    lines.push(`- instructions: ${printedInstructionText(question.instructions)}`);
  if (question.negative_marks != null) {
    lines.push(`- negative marks: ${question.negative_marks}`);
  }
  return lines;
}

export function stripQuestionForPrompt(question: Question): Question {
  return emptyQuestion({
    ...question,
    hint: null,
    explanation: null,
    // Avoid leaking printed answers as copy targets; model invents new ones.
    answer_keys: [],
    answer_text: null,
    answer_boolean: null,
    blanks: question.type === "fill_blank" ? question.blanks.map(() => "") : [],
    options: question.options.map((option) => ({
      key: option.key,
      text: option.text,
      is_correct: null,
      image_path: null,
      image_description: option.image_description ?? null,
    })),
    sub_questions: question.sub_questions.map(stripQuestionForPrompt),
    figures: question.figures.map((figure) => ({
      description: figure.description,
      caption: figure.caption ?? null,
      bbox: null,
      page: figure.page ?? null,
      image_path: null,
    })),
    approved: false,
  });
}

/** Extra lines describing nested sub-questions (for comprehension / multi-part sources). */
function appendSubQuestionPattern(lines: string[], question: Question, depth = 0): void {
  if (!question.sub_questions.length) return;
  const indent = depth === 0 ? "" : "  ".repeat(depth);
  lines.push("");
  lines.push(
    `${indent}Sub-questions (${question.sub_questions.length}) — invent new ones of similar skill:`,
  );
  question.sub_questions.forEach((sub, index) => {
    const bits = [`type=${sub.type}`, `marks=${sub.marks ?? "?"}`];
    if (sub.difficulty) bits.push(`difficulty=${sub.difficulty}`);
    lines.push(`${indent}${index + 1}. ${bits.join("; ")}`);
    if (sub.stem) lines.push(`${indent}   stem pattern: ${sub.stem.slice(0, 220)}`);
    if (sub.options.length) {
      lines.push(
        `${indent}   options: ${sub.options.map((o) => o.key).join(", ")} (${sub.options.length} choices)`,
      );
    }
    appendSubQuestionPattern(lines, sub, depth + 1);
  });
}

export function buildFromSourceUserPrompt(options: {
  sourceQuestion: Question;
  index: number;
  total: number;
  audience?: MockPaperAudience;
  hasImages?: boolean;
  /** Teacher notes applied to every equivalent question in the mock. */
  authorInstructions?: string | null;
  /** rewrite keeps the question and metadata; write_new invents a new one. */
  strategy?: MockStrategy;
  /** Catalog names the model may pick from to fill missing subject/topic metadata. */
  metadataCatalog?: { subjects?: string[]; topics?: string[] };
}): string {
  const stripped = stripQuestionForPrompt(options.sourceQuestion);
  const payload = buildQuestionPromptPayload(stripped, {
    audience: {
      subject: options.audience?.subject ?? null,
      exam: options.audience?.exam ?? null,
      notes: options.audience?.notes ?? null,
    },
    ...(options.hasImages ? { hasImages: true } : {}),
  });

  const extras: string[] = [];
  extras.push(`Slot: ${options.index + 1} of ${options.total}`);

  const rewrite = options.strategy === "rewrite";

  const isComprehension =
    options.sourceQuestion.type === "comprehension" ||
    Boolean(options.sourceQuestion.passage?.trim()) ||
    options.sourceQuestion.sub_questions.length > 0;

  const comprehensionRules = isComprehension
    ? rewrite
      ? [
          "COMPREHENSION / PASSAGE SET (required):",
          '- type must be "comprehension".',
          '- REWORD the source passage with new names, facts and numbers; keep the same theme and reading level.',
          '- Keep the SAME number of sub-questions as the source. Each sub needs answers + hint + explanation.',
          "- Do NOT copy the source passage — reword it.",
        ]
      : [
          "COMPREHENSION / PASSAGE SET (required):",
          '- type must be "comprehension".',
          '- You MUST invent a completely NEW shared passage in the "passage" field (several sentences).',
          "- Do NOT leave passage null/empty. Do NOT copy the source passage — rewrite the theme with new facts/names/numbers.",
          '- Put related items in "sub_questions" that can be answered from YOUR new passage.',
          "- Sub-question count may differ from the source. Each sub needs answers + hint + explanation.",
          '- Parent stem may be a short instruction (e.g. "Read the passage and answer") or empty; the passage carries the content.',
          "- Keep passage reading level aligned with the student standard / leveling rules above.",
        ]
    : [];

  const patternLines: string[] = [];
  appendSubQuestionPattern(patternLines, stripped);

  const intro = rewrite
    ? [
        "REWORD the SOURCE question below into an original question.",
        "Keep the SAME question: same type, same structure, same number of parts, options and marks, same skill, topic, subject and difficulty.",
        "Change only surface details: names, numbers, values, units, entities and phrasing. The correct answer must stay correct for the new values.",
        "Do not add, remove or reorder parts, options, or sub-questions.",
      ]
    : [
        "Create ONE original mock exam question inspired by the SOURCE pattern below.",
        "If OCR is garbled or incomplete, infer the intended skill and invent a correct new question.",
        "You may change sub-question counts for comprehension / assertion / similar multi-part types.",
      ];

  const copyright = [
    "COPYRIGHT (must follow):",
    "- Do NOT copy or lightly reorder the source stem, passage, options, or distinctive phrasing.",
    "- Replace every name, number, unit and entity. No source token may appear verbatim in your output.",
    "- Never reproduce more than about six consecutive words from the source.",
    "- If the source looks like a well-known or standard question, produce a materially different variant — not a near-copy.",
  ];

  const figureRule = rewrite
    ? options.hasImages
      ? "You can see the source figure. Keep the same kind of figure; reword only the surrounding text and its description."
      : "Keep the same kind of figure the source describes; reword the surrounding text only."
    : options.hasImages
      ? "You can see the source figure. Invent a new figure of the same skill and describe it in figures[].description. The answer must match the new figure."
      : "For diagram/figure questions, invent a new scenario and describe it in figures[].description.";

  const optionFigureRule =
    "OPTION FIGURES (must follow): when the answer options are picture choices, do NOT describe them in figures[]. Put a short description of each answer-option figure in that option's \"image_description\" field (option text may stay empty) and describe only the question's own figure in figures[].description.";

  const metadataLines: string[] = [];
  const subjects = options.metadataCatalog?.subjects ?? [];
  const topics = options.metadataCatalog?.topics ?? [];
  if (subjects.length || topics.length) {
    metadataLines.push(
      "",
      'METADATA: also return "subject" and "topic" string fields. Pick the closest value from these lists and copy its exact name:',
    );
    if (subjects.length) metadataLines.push(`- Subjects: ${subjects.join(", ")}`);
    if (topics.length) metadataLines.push(`- Topics: ${topics.join(", ")}`);
  }

  const printedInstruction = printedInstructionText(options.sourceQuestion.instructions);

  return [
    ...intro,
    ...copyright,
    figureRule,
    optionFigureRule,
    "Return a full Question JSON object with answers, hint, explanation, and difficulty.",
    ...metadataLines,
    "",
    ...buildLevelingGuidance({
      ...(options.audience ? { audience: options.audience } : {}),
      sourceQuestion: options.sourceQuestion,
    }),
    ...(printedInstruction
      ? [
          "",
          "SOURCE PRINTED INSTRUCTION (must follow for this question):",
          `"${printedInstruction}"`,
          "The new question must keep this exact task — new words/content, same requirement. If the source asks to choose the opposite word (antonym), the mock must also ask for the opposite word; a synonym request stays a synonym request. Do not carry over any printed question-number range.",
        ]
      : []),
    ...(options.authorInstructions?.trim()
      ? [
          "",
          "ADDITIONAL INSTRUCTIONS (must follow for this question):",
          options.authorInstructions.trim(),
          "Keep the same skill as the source. Change the surface details so the question is original. The answer must still be correct.",
        ]
      : []),
    "",
    ...describeSourceMetadata(options.sourceQuestion),
    ...comprehensionRules,
    "",
    extras.join("\n"),
    "",
    rewrite
      ? "SOURCE QUESTION (reword it — keep the question and metadata, change only the surface):"
      : "SOURCE QUESTION (pattern only — rewrite into something new):",
    payload,
    ...patternLines,
  ].join("\n");
}

export function buildFromInstructionsUserPrompt(options: {
  instructions: string;
  index: number;
  total: number;
  audience?: MockPaperAudience;
  previousStems?: string[];
}): string {
  const extras: string[] = [];
  extras.push(`Question slot: ${options.index + 1} of ${options.total}`);

  const avoid =
    options.previousStems && options.previousStems.length
      ? [
          "",
          "Avoid duplicating these earlier stems (paraphrase topics if needed):",
          ...options.previousStems.slice(-8).map((stem, i) => `${i + 1}. ${stem.slice(0, 160)}`),
        ]
      : [];

  return [
    "Create ONE original exam question for an AI mock paper.",
    "Follow the teacher instructions. Choose a suitable type, difficulty, and content.",
    "Include correct answers, a short learner hint, a full explanation, and a difficulty field.",
    "Use LaTeX for math ($...$ / $$...$$). For diagrams, describe the question figure in figures[].description; when the answer options are figures, describe each one in its option \"image_description\" field instead; option text may stay empty.",
    "Return a full Question JSON object.",
    "",
    ...buildLevelingGuidance({
      ...(options.audience ? { audience: options.audience } : {}),
    }),
    "",
    extras.join("\n"),
    "",
    "TEACHER INSTRUCTIONS:",
    options.instructions,
    ...avoid,
  ].join("\n");
}

/**
 * Match model figure entries whose caption names an option ("A", "Option B",
 * "Figure C") to that option, mark their role, and copy the description onto
 * the option so option figures render like the source paper.
 */
function attachOptionFigureDescriptions(question: Question): Question {
  if (!question.figures.length || !question.options.length) return question;
  const keyByToken = new Map(
    question.options
      .map((option) => [optionKeyToken(option.key), option.key] as const)
      .filter(([token]) => token.length > 0),
  );
  if (!keyByToken.size) return question;

  const options = question.options.map((option) => ({ ...option }));
  const byKey = new Map(options.map((option) => [option.key, option]));
  const figures: Figure[] = question.figures.map((figure) => {
    const caption = figure.caption?.trim() ?? "";
    if (!caption) return figure;
    const tokens = [caption, caption.replace(/^(?:figure|option|choice)\s*[:.]?\s*/i, "")];
    const key = tokens
      .map(optionKeyToken)
      .map((token) => keyByToken.get(token))
      .find((found) => found != null);
    const option = key ? byKey.get(key) : null;
    if (!option) return figure;
    const hasOwnDescription = Boolean(option.image_description?.trim());
    if (option.text.trim() && !hasOwnDescription) return figure;
    if (!hasOwnDescription && figure.description.trim()) {
      option.image_description = figure.description;
    }
    return { ...figure, role: "option_figure" as const };
  });
  return { ...question, options, figures };
}

/** Normalize model JSON into a canonical Question and assign pairing metadata. */
export function finalizeMockQuestion(
  raw: unknown,
  options: {
    number: string;
    sourceQuestionId?: string | null;
    generationJobId?: string | null;
    skillType?: string | null;
    sourceType?: Question["type"] | null;
    sourceDifficulty?: Question["difficulty"] | null;
    /** rewrite pins difficulty to the source; write_new lets the model set it. */
    strategy?: MockStrategy;
    /** Printed instruction on the source question, copied when the model omits one. */
    sourceInstructions?: string | null;
    catalog?: {
      subject_id?: number | null;
      topic_id?: number | null;
      standard_id?: number | null;
      stream_id?: number | null;
    };
  },
): Question {
  const question = normalizeQuestion(raw, 0);
  question.number = options.number;
  question.approved = false;
  question.approval_status = "generated";
  question.page = null;
  question.confidence = null;
  question.source = options.sourceQuestionId ?? "ai_mock";
  question.source_question_id = options.sourceQuestionId ?? null;
  if (options.generationJobId) question.generation_job_id = options.generationJobId;
  if (options.skillType) question.skill_type = options.skillType;
  const sourceInstruction = printedInstructionText(options.sourceInstructions);
  question.instructions =
    question.instructions ??
    (sourceInstruction && isPrintedDirection(sourceInstruction) ? sourceInstruction : null);

  // If the source was a comprehension set (or model returned subs), keep type as comprehension.
  if (
    options.sourceType === "comprehension" ||
    (question.sub_questions.length > 0 && question.passage?.trim())
  ) {
    question.type = "comprehension";
  }

  // A rewrite keeps the source difficulty. Otherwise fall back when the model omits it.
  if (options.strategy === "rewrite" && options.sourceDifficulty) {
    question.difficulty = options.sourceDifficulty;
  } else if (!question.difficulty && options.sourceDifficulty) {
    question.difficulty = options.sourceDifficulty;
  }

  if (options.catalog) {
    question.subject_id = options.catalog.subject_id ?? question.subject_id ?? null;
    question.topic_id = options.catalog.topic_id ?? question.topic_id ?? null;
    question.standard_id = options.catalog.standard_id ?? question.standard_id ?? null;
    question.stream_id = options.catalog.stream_id ?? question.stream_id ?? null;
  }
  // Nested subs should also be approved and without page refs.
  question.sub_questions = question.sub_questions.map((sub, index) => ({
    ...sub,
    approved: false,
    approval_status: "generated" as const,
    page: null,
    number: sub.number ?? `${options.number}.${index + 1}`,
    source: options.sourceQuestionId ?? "ai_mock",
    difficulty: sub.difficulty ?? question.difficulty ?? options.sourceDifficulty ?? null,
    subject_id: sub.subject_id ?? question.subject_id ?? null,
    topic_id: sub.topic_id ?? question.topic_id ?? null,
    standard_id: sub.standard_id ?? question.standard_id ?? null,
    stream_id: sub.stream_id ?? question.stream_id ?? null,
  }));
  question.figures = question.figures.map((figure) => ({
    ...figure,
    image_path: null,
    bbox: null,
    page: null,
  }));
  return attachOptionFigureDescriptions(question);
}

/** Throws when a comprehension mock is missing the shared passage or items. */
export function assertMockQuestionComplete(
  question: Question,
  sourceType?: Question["type"] | null,
): void {
  const expectsComprehension = sourceType === "comprehension" || question.type === "comprehension";
  if (!expectsComprehension) return;

  if (!question.passage?.trim()) {
    throw new Error(
      "The mock model returned a comprehension set without a passage. Resume to regenerate.",
    );
  }
  if (!question.sub_questions.length) {
    throw new Error(
      "The mock model returned a comprehension passage without sub-questions. Resume to regenerate.",
    );
  }
}

export function audienceFromDocument(
  document: DocumentMeta,
  catalogNames?: {
    subject?: string | null;
    standard?: string | null;
    stream?: string | null;
    topic?: string | null;
  },
): MockPaperAudience {
  return {
    subject: catalogNames?.subject ?? null,
    exam: document.exam,
    notes: document.notes,
    standard: catalogNames?.standard ?? null,
    stream: catalogNames?.stream ?? null,
    difficulty: document.difficulty,
    topic: catalogNames?.topic ?? null,
  };
}

export function advanceGenerationAfterSuccess(
  generation: MockGenerationState,
  pair: { source_question_id: string | null; mock_question_id: string },
): MockGenerationState {
  const nextCursor = generation.cursor + 1;
  const total = mockGenerationTotal(generation);
  const completed = nextCursor >= total;
  return {
    ...generation,
    cursor: nextCursor,
    status: completed ? "completed" : "in_progress",
    last_error: null,
    pairs: [...generation.pairs, pair],
  };
}

export function markGenerationFailed(
  generation: MockGenerationState,
  error: string,
): MockGenerationState {
  return {
    ...generation,
    status: "failed",
    last_error: error.slice(0, 2000),
  };
}

export function markGenerationInProgress(generation: MockGenerationState): MockGenerationState {
  return {
    ...generation,
    status: "in_progress",
    last_error: null,
  };
}
