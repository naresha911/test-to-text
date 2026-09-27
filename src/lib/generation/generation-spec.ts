import type { Difficulty } from "@/lib/document-types";
import type { QuestionType } from "@/lib/question-schema";
import type { SkillFamily } from "@/lib/question-taxonomy";

import type { PatternAnalysis, StructuralConstraints } from "@/lib/generation/pattern-types";

export type GenerationAudience = {
  standard?: string | null;
  subject?: string | null;
  exam?: string | null;
};

export type GenerationSpec = {
  source_question_id: string | null;
  family: SkillFamily;
  type: QuestionType;
  skill_type: string;
  learning_intent: string;
  difficulty: Difficulty | null;
  audience: GenerationAudience;
  structural_constraints: StructuralConstraints;
  pattern: Record<string, unknown>;
  visual_required: boolean;
  math_validation_required: boolean;
};

/** Handoff to a generator. Answer keys and source sentences are already gone. */
export function buildGenerationSpec(
  analysis: PatternAnalysis,
  options: {
    sourceQuestionId?: string | null;
    audience?: GenerationAudience;
    visualRequired?: boolean;
    mathValidationRequired?: boolean;
  } = {},
): GenerationSpec {
  return {
    source_question_id: options.sourceQuestionId ?? null,
    family: analysis.family,
    type: analysis.type,
    skill_type: analysis.skill_type,
    learning_intent: analysis.learning_intent,
    difficulty: analysis.difficulty,
    audience: {
      standard: options.audience?.standard ?? null,
      subject: options.audience?.subject ?? null,
      exam: options.audience?.exam ?? null,
    },
    structural_constraints: analysis.structural_constraints,
    pattern: analysis.pattern,
    visual_required: options.visualRequired === true,
    math_validation_required: options.mathValidationRequired === true,
  };
}
