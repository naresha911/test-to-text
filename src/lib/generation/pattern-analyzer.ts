import type { Difficulty } from "@/lib/document-types";
import type { Question, QuestionType } from "@/lib/question-schema";
import { detectSkill } from "@/lib/generation/skill-detect";
import { isAutoGeneratable, skillByType, type SkillFamily } from "@/lib/question-taxonomy";

import type { PatternAnalysis, StructuralConstraints } from "@/lib/generation/pattern-types";

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
  /** A skill named from the source image, used ahead of text detection. */
  skillTypeOverride?: string | null;
}): PatternAnalysis {
  const source = input.source ?? null;
  const instructions = input.instructions?.trim() ?? "";
  const text = [instructions, source?.stem ?? "", source?.instructions ?? ""].join("\n");
  const base = constraintsFrom(source);

  // Prefer an explicit skill on the source; otherwise detect it from the text.
  const explicitSkill =
    source?.skill_type && skillByType(source.skill_type) ? source.skill_type : null;
  const detectInstructions =
    [input.instructions ?? "", source?.instructions ?? ""].filter(Boolean).join("\n") || null;
  const overrideSkill =
    input.skillTypeOverride && skillByType(input.skillTypeOverride) ? input.skillTypeOverride : null;
  const skillType =
    overrideSkill ??
    explicitSkill ??
    detectSkill({
      stem: source?.stem,
      instructions: detectInstructions,
      type: source?.type,
      figureCount: source?.figures.length ?? 0,
      optionImageCount: source?.options.filter((option) => option.image_path).length ?? 0,
      optionTexts: source?.options.map((option) => option.text) ?? [],
      passage: source?.passage,
    });
  let family: SkillFamily = "textual";
  let type: QuestionType = source?.type ?? "mcq";
  let intent = "Invent an original practice question.";
  let pattern: Record<string, unknown> = {};
  let confidence = skillType === "unsupported" ? 0.4 : 0.7;
  const known = skillByType(skillType);
  if (known) {
    family = known.family;
    if (!source?.type || source.type === "unknown") type = known.render_type;
    if (known.visual) {
      base.has_figure = true;
      base.has_option_images = base.has_option_images || known.skill_type === "mirror_image";
    }
  }

  if (skillType === "mirror_image") {
    family = "intelligence";
    type = "mcq";
    intent = "Choose the exact vertical mirror image of a new asymmetric figure.";
    pattern = { transformation: "vertical", option_count: 4 };
    base.has_figure = true;
    base.has_option_images = true;
    base.option_count = 4;
    confidence = 0.8;
  } else if (skillType === "number_series") {
    family = "math";
    type = "mcq";
    intent = "Find the next term of a number series from a typed rule.";
    pattern = { answer_count: 1, option_count: 4 };
    base.has_math = true;
    base.option_count = 4;
    confidence = 0.85;
  } else if (skillType === "grammar") {
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
