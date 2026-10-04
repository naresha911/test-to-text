import { skillAuthorPrompt, skillDifficultyGuidance } from "@/lib/generation/skill-prompts";

import { LANGUAGE_SKILLS, VISION_SKILLS } from "@/lib/generation/skills/catalog";
import type { SkillAuthorInput, SkillAuthorPlan } from "@/lib/generation/skills/types";

const VISION = new Set<string>(VISION_SKILLS);
const LANGUAGE = new Set<string>(LANGUAGE_SKILLS);

/** Prompt addendum for an authored skill. Checked, series, and mirror skills stay null. */
export function skillAuthorPlan(input: SkillAuthorInput): SkillAuthorPlan | null {
  const kind = VISION.has(input.skill) ? "vision" : LANGUAGE.has(input.skill) ? "language" : null;
  if (!kind) return null;

  const prompt = skillAuthorPrompt(input.skill);
  const guidance = skillDifficultyGuidance(input.skill, input.grade, input.difficultyStep);
  return {
    skill: input.skill,
    kind,
    systemAddendum: prompt ? `${prompt}\n${guidance}` : guidance,
    requiresImages: kind === "vision",
  };
}
