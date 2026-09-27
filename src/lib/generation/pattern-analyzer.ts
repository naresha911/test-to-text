import type { Difficulty } from "@/lib/document-types";
import type { Question, QuestionType } from "@/lib/question-schema";
import { isAutoGeneratable, skillByType, type SkillFamily } from "@/lib/question-taxonomy";

import type { PatternAnalysis, StructuralConstraints } from "@/lib/generation/pattern-types";

const MIRROR = /\bmirror(?:\s|-)?image\b|\bwater\s+image\b|\breflection of the figure\b/i;
const SERIES = /\bnumber\s+series\b|\bfind the next\b|\bwhat comes next\b|\bmissing number\b/i;
const GRAMMAR =
  /\bgrammar\b|\btenses?\b|\bprepositions?\b|\barticles?\b|\bactive and passive\b|\breported speech\b|\bparts of speech\b|\bsynonyms?\b|\bantonyms?\b|\bsubject[- ]verb\b/i;

function focusFromText(text: string): string {
  if (/\btenses?\b/i.test(text)) return "verb tense";
  if (/\bprepositions?\b/i.test(text)) return "prepositions";
  if (/\barticles?\b/i.test(text)) return "articles";
  if (/\bvoice\b|\bpassive\b/i.test(text)) return "active and passive voice";
  if (/\breported speech\b/i.test(text)) return "reported speech";
  if (/\bsynonyms?\b|\bantonyms?\b/i.test(text)) return "synonyms and antonyms";
  if (/\bparts of speech\b/i.test(text)) return "parts of speech";
  return "grammar usage";
}

function looksLikeNumberSeries(text: string): boolean {
  const numbers = text.match(/-?\d+(?:\.\d+)?/g);
  return (numbers?.length ?? 0) >= 4 && /[,;]|…|\.\.\./.test(text);
}

function constraintsFrom(question: Question | null): StructuralConstraints {
  return {
    option_count: question?.options.length || 4,
    answer_count: 1,
    has_figure: Boolean(question?.figures.length),
    has_option_images: Boolean(question?.options.some((option) => option.image_path)),
    has_passage: Boolean(question?.passage?.trim()),
    has_math: false,
  };
}

function difficultyOf(question: Question | null): Difficulty | null {
  const value = question?.difficulty;
  return value === "easy" || value === "medium" || value === "hard" ? value : null;
}

export function analyzePattern(input: {
  source?: Question | null;
  instructions?: string | null;
  analysisId?: string;
  now?: string;
}): PatternAnalysis {
  const source = input.source ?? null;
  const instructions = input.instructions?.trim() ?? "";
  const text = [instructions, source?.stem ?? "", source?.instructions ?? ""].join("\n");
  const base = constraintsFrom(source);

  let skillType = "unsupported";
  let family: SkillFamily = "textual";
  let type: QuestionType = source?.type ?? "mcq";
  let intent = "Invent an original practice question.";
  let pattern: Record<string, unknown> = {};
  let confidence = 0.4;

  if (MIRROR.test(text) || (source?.figures.length && /\bmirror\b/i.test(text))) {
    skillType = "mirror_image";
    family = "intelligence";
    type = "mcq";
    intent = "Choose the exact vertical mirror image of a new asymmetric figure.";
    pattern = { transformation: "vertical", option_count: 4 };
    base.has_figure = true;
    base.has_option_images = true;
    base.option_count = 4;
    confidence = 0.8;
  } else if (SERIES.test(text) || looksLikeNumberSeries(source?.stem ?? "")) {
    skillType = "number_series";
    family = "math";
    type = "mcq";
    intent = "Find the next term of a number series from a typed rule.";
    pattern = { answer_count: 1, option_count: 4 };
    base.has_math = true;
    base.option_count = 4;
    confidence = 0.85;
  } else if (
    GRAMMAR.test(text) ||
    (source?.type === "mcq" && !source.figures.length && GRAMMAR.test(source.tags.join(" ")))
  ) {
    skillType = "grammar";
    family = "textual";
    type = "mcq";
    const focus = focusFromText(text);
    intent = `Practice ${focus} with a new multiple-choice question.`;
    pattern = { focus, option_count: 4 };
    base.option_count = 4;
    confidence = 0.7;
  }

  if (!isAutoGeneratable(skillType)) {
    const known = skillByType(skillType);
    if (known) family = known.family;
  }

  return {
    analysis_id: input.analysisId ?? crypto.randomUUID(),
    family,
    type,
    skill_type: skillType,
    learning_intent: intent,
    difficulty: difficultyOf(source),
    structural_constraints: base,
    pattern,
    confidence,
    created_at: input.now ?? new Date().toISOString(),
  };
}
