import { SKILL_CATALOG, isAutoGeneratable } from "@/lib/question-taxonomy";
import { LANGUAGE_SKILLS, VISION_SKILLS } from "@/lib/generation/skills/catalog";

const LANGUAGE = new Set<string>(LANGUAGE_SKILLS);
const VISION = new Set<string>(VISION_SKILLS);

/** Skills the calibrator can author and judge: auto-generatable, language, vision. */
export const CALIBRATABLE_SKILLS = SKILL_CATALOG.map((entry) => entry.skill_type)
  .filter((skill) => isAutoGeneratable(skill) || LANGUAGE.has(skill) || VISION.has(skill))
  .filter((skill, index, list) => list.indexOf(skill) === index)
  .sort((a, b) => a.localeCompare(b));
