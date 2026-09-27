import type { Difficulty } from "@/lib/document-types";
import type { QuestionType } from "@/lib/question-schema";
import type { SkillFamily } from "@/lib/question-taxonomy";

export type StructuralConstraints = {
  option_count: number | null;
  answer_count: number | null;
  has_figure: boolean;
  has_option_images: boolean;
  has_passage: boolean;
  has_math: boolean;
};

export type PatternAnalysis = {
  analysis_id: string;
  family: SkillFamily;
  type: QuestionType;
  skill_type: string;
  learning_intent: string;
  difficulty: Difficulty | null;
  structural_constraints: StructuralConstraints;
  /** Skill structure only. Source wording and answer keys do not belong here. */
  pattern: Record<string, unknown>;
  confidence: number | null;
  created_at: string;
};
