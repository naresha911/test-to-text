import {
  completeGenerationChat,
  type GenerationChatMessage,
} from "@/lib/generation/chat-transport";
import { isCheckedSkill } from "@/lib/generation/checked/registry";
import { detectSkill } from "@/lib/generation/skill-detect";
import type { Question } from "@/lib/question-schema";
import { skillByType } from "@/lib/question-taxonomy";

import type { JudgeVerdict, StructuralJudgement } from "@/lib/generation/calibration/types";

export type JudgeModelCall = (messages: GenerationChatMessage[]) => Promise<string>;

/** Skills whose answer is checked by an independent solver, so no model judge is needed. */
export function hasDeterministicOracle(skill: string): boolean {
  return (
    isCheckedSkill(skill) ||
    skill === "number_series" ||
    skill === "mirror_image" ||
    skill === "water_image" ||
    skill === "grammar"
  );
}

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** True when the generated text is a near-copy of the reference (stem or an option). */
export function isCopiedText(
  candidate: string | null | undefined,
  reference: string | null | undefined,
): boolean {
  const a = normalizeText(candidate);
  const b = normalizeText(reference);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 24 && b.includes(a)) return true;
  if (b.length >= 24 && a.includes(b)) return true;
  return jaccard(tokenSet(a), tokenSet(b)) >= 0.85;
}

function hasAnswers(question: Question): boolean {
  if (question.answer_keys.length) return true;
  if (question.answer_text?.trim()) return true;
  if (question.answer_boolean != null) return true;
  if (question.blanks.some((blank) => blank.trim())) return true;
  if (question.match_pairs.length) return true;
  return question.sub_questions.length > 0;
}

function answerableFromOracle(question: Question): boolean | null {
  const status = question.validation?.status;
  if (status === "passed") return true;
  if (status === "failed") return false;
  return null;
}

/** Deterministic checks that run for every generated question. */
export function assessStructure(input: {
  generated: Question;
  reference: Question | null;
  skill: string;
}): StructuralJudgement {
  const { generated, reference, skill } = input;
  const notes: string[] = [];

  const schemaValid =
    generated.type !== "unknown" &&
    (generated.stem.trim().length > 0 || Boolean(generated.passage?.trim()));
  if (!schemaValid) notes.push("Generated question has no usable stem.");

  const answers = hasAnswers(generated);
  if (!answers) notes.push("Generated question has no answer.");

  const optionCountOk = generated.type !== "mcq" || generated.options.length === 4;
  if (!optionCountOk) notes.push(`Expected 4 options, saw ${generated.options.length}.`);

  const detected = detectSkill({
    stem: generated.stem,
    instructions: generated.instructions,
    type: generated.type,
    figureCount: generated.figures.length,
    optionImageCount: generated.options.filter((option) => option.image_path).length,
    optionTexts: generated.options.map((option) => option.text),
    passage: generated.passage,
  });
  // The calibration generator force-stamps skill_type, so a question whose
  // own text detects nothing ("unsupported") still matches its stamp.
  const skillMatch =
    detected === skill ||
    (generated.skill_type === skill && detected === "unsupported");
  if (!skillMatch) notes.push(`Generated question reads as "${detected}", not "${skill}".`);

  // Short numeric choices coincide across questions, so one shared option is
  // not enough to call the question a copy — two or more is.
  const copiedOptions = generated.options.filter((option) =>
    reference?.options.some((refOption) => isCopiedText(option.text, refOption.text)),
  ).length;
  const copied = isCopiedText(generated.stem, reference?.stem) || copiedOptions >= 2;
  if (copied) notes.push("Generated question copies the reference wording.");

  const marksSane =
    generated.marks == null ||
    (generated.marks > 0 && (reference?.marks == null || generated.marks <= reference.marks * 3));
  if (!marksSane) notes.push("Generated marks look wrong for the reference.");

  const difficultyMatch =
    !generated.difficulty ||
    !reference?.difficulty ||
    generated.difficulty === reference.difficulty;

  const passed = schemaValid && answers && optionCountOk && skillMatch && !copied;

  return {
    schema_valid: schemaValid,
    has_answers: answers,
    option_count_ok: optionCountOk,
    skill_match: skillMatch,
    copied_reference: copied,
    oracle_passed: answerableFromOracle(generated),
    marks_sane: marksSane,
    difficulty_match: difficultyMatch,
    passed,
    notes,
  };
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}

function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Parse the rubric JSON the judge model returns. Exported for tests. */
export function parseJudgeVerdict(raw: string): JudgeVerdict | null {
  const parsed = extractJson(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") return null;
  const skillMatch = clampScore(parsed["skill_match"]);
  const difficultyMatch = clampScore(parsed["difficulty_match"]);
  const pastPaperLike = clampScore(parsed["past_paper_like"]);
  const reasons = Array.isArray(parsed["reasons"])
    ? parsed["reasons"].filter((entry): entry is string => typeof entry === "string").slice(0, 6)
    : [];
  return {
    equivalent: parsed["equivalent"] === true,
    skill_match: skillMatch,
    difficulty_match: difficultyMatch,
    answerable: parsed["answerable"] !== false,
    past_paper_like: pastPaperLike,
    reasons,
    judge_score: (skillMatch + difficultyMatch + pastPaperLike) / 15,
    model: typeof parsed["model"] === "string" ? parsed["model"] : null,
  };
}

function questionBrief(question: Question): Record<string, unknown> {
  return {
    type: question.type,
    skill: question.skill_type ?? null,
    stem: question.stem,
    passage: question.passage ?? null,
    options: question.options.map((option) => ({
      key: option.key,
      text: option.text,
      correct: option.is_correct === true,
    })),
    answer_keys: question.answer_keys,
    answer_text: question.answer_text ?? null,
    difficulty: question.difficulty ?? null,
    marks: question.marks ?? null,
    figure_descriptions: question.figures.map((figure) => figure.description).filter(Boolean),
  };
}

const JUDGE_SYSTEM =
  "You are an exam-question calibrator. You compare a freshly generated question against a real past-paper question for the same skill. Judge whether the generated question is equivalent in skill and difficulty, answerable, and looks like a past-paper question rather than random filler. Return ONLY JSON.";

export const JUDGE_RUBRIC_KEYS =
  '{"equivalent": boolean, "skill_match": 0-5, "difficulty_match": 0-5, "answerable": boolean, "past_paper_like": 0-5, "reasons": string[]}';

/** Ask the free-model router whether the generated question matches the reference. */
export async function judgeWithModel(
  input: { generated: Question; reference: Question; skill: string },
  call: JudgeModelCall = (messages) => completeGenerationChat({ messages }),
): Promise<JudgeVerdict | null> {
  const skillLabel = skillByType(input.skill)?.family ?? "unknown";
  const messages: GenerationChatMessage[] = [
    { role: "system", content: JUDGE_SYSTEM },
    {
      role: "user",
      content: [
        `Skill under test: ${input.skill} (${skillLabel} family).`,
        "",
        "REFERENCE (a real past-paper question):",
        JSON.stringify(questionBrief(input.reference), null, 2),
        "",
        "GENERATED (must be equivalent to the reference):",
        JSON.stringify(questionBrief(input.generated), null, 2),
        "",
        `Return JSON exactly like ${JUDGE_RUBRIC_KEYS}.`,
      ].join("\n"),
    },
  ];
  // Provider/transport errors (missing API key, rate limit, network) throw:
  // the caller decides whether that counts as a calibration failure. Only an
  // unparseable response is a null verdict.
  const raw = await call(messages);
  return parseJudgeVerdict(raw);
}

/** Combine the deterministic checks with the optional model verdict. */
export function scoreCase(input: {
  structural: StructuralJudgement;
  judge: JudgeVerdict | null;
  oracleSkill: boolean;
}): { score: number; passed: boolean } {
  const { structural, judge, oracleSkill } = input;
  const checks = [
    structural.schema_valid,
    structural.has_answers,
    structural.option_count_ok,
    structural.skill_match,
    !structural.copied_reference,
  ];
  const structuralScore = checks.filter(Boolean).length / checks.length;

  if (oracleSkill) {
    const oraclePassed = structural.oracle_passed === true;
    return {
      score: structural.passed ? (oraclePassed ? 1 : 0.4) : 0,
      passed: structural.passed && oraclePassed,
    };
  }

  if (!judge) {
    // Judge unavailable (e.g. no AI key): structural-only scoring, no penalty.
    return { score: structuralScore, passed: structural.passed };
  }
  const passed =
    structural.passed && judge.equivalent && judge.answerable && judge.judge_score >= 0.6;
  return { score: 0.5 * structuralScore + 0.5 * judge.judge_score, passed };
}

/** Full per-case judgement used by the engine. */
export async function judgeCalibrationCase(
  input: { generated: Question; reference: Question | null; skill: string },
  call?: JudgeModelCall,
): Promise<{
  structural: StructuralJudgement;
  judge: JudgeVerdict | null;
  /** True when the judge call itself failed (no API key, rate limit, ...). */
  judgeFailed: boolean;
  score: number;
  passed: boolean;
}> {
  const structural = assessStructure(input);
  const oracleSkill = hasDeterministicOracle(input.skill);
  let judge: JudgeVerdict | null = null;
  let judgeFailed = false;
  if (!oracleSkill && input.reference) {
    try {
      judge = await judgeWithModel(
        {
          generated: input.generated,
          reference: input.reference,
          skill: input.skill,
        },
        call,
      );
    } catch {
      // The judge is unavailable; the structural result stands alone.
      judgeFailed = true;
    }
  }
  const { score, passed } = scoreCase({ structural, judge, oracleSkill });
  return { structural, judge, judgeFailed, score, passed };
}
