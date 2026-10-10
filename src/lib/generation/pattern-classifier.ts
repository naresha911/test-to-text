import type { Question } from "@/lib/question-schema";
import { skillByType } from "@/lib/question-taxonomy";

/**
 * Coarse pattern category for a skill. "Type" in the exam sense —
 * a number series, a figure pattern, a language item, an arithmetic sum.
 */
export type PatternType =
  | "number_series"
  | "letter_series"
  | "figure_pattern"
  | "coding"
  | "verbal_reasoning"
  | "language"
  | "arithmetic"
  | "knowledge"
  | "unknown";

const FIGURE_SKILLS = new Set<string>([
  "mirror_image",
  "water_image",
  "embedded_figure",
  "figure_pattern",
  "figure_analogy",
  "figure_series",
  "figure_identity",
  "missing_number_figure",
  "venn_diagram",
  "number_figure",
  "counting_triangles",
]);

const CODING_SKILLS = new Set<string>(["coding_decoding", "symbol_operations", "matrix_coding"]);

/** Coarse type for a skill. Null or unknown skills fall back to "unknown". */
export function patternTypeOf(skillType: string | null | undefined): PatternType {
  if (!skillType) return "unknown";
  if (FIGURE_SKILLS.has(skillType)) return "figure_pattern";
  if (skillType === "number_series") return "number_series";
  if (skillType === "letter_series") return "letter_series";
  if (CODING_SKILLS.has(skillType)) return "coding";
  if (skillType === "general_knowledge") return "knowledge";
  const def = skillByType(skillType);
  if (def?.family === "math") return "arithmetic";
  if (def?.family === "textual") return "language";
  if (def?.family === "intelligence") return "verbal_reasoning";
  return "unknown";
}

function seriesSubtype(source: Question | null): string {
  // Strip ordinals ("10th", "3rd") so term positions are not read as series terms.
  const stem = (source?.stem ?? "").replace(/\d+\s*(?:st|nd|rd|th)\b/gi, " ");
  const numbers = (stem.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (numbers.length < 4) return "number_series";
  const diffs: number[] = [];
  for (let index = 1; index < numbers.length; index += 1) {
    diffs.push((numbers[index] as number) - (numbers[index - 1] as number));
  }
  const first = diffs[0] as number;
  // Decimal steps (0.1, 0.2, 0.3) accumulate float error, so compare with a tolerance.
  if (diffs.every((diff) => Math.abs(diff - first) < 1e-9)) return "arithmetic";
  if (numbers.every((value) => value !== 0)) {
    const ratios = numbers.slice(1).map((value, index) => value / (numbers[index] as number));
    const ratio = ratios[0] as number;
    if (ratios.every((value) => Math.abs(value - ratio) < 1e-9)) return "geometric";
  }
  return "two_step";
}

/**
 * Fine variant of the pattern, used for grouping and for the learned-skill key.
 * The source wording decides ambiguous cases (water vs vertical, synonym vs antonym).
 */
export function patternSubtypeOf(input: {
  skillType: string | null | undefined;
  source?: Question | null;
  text?: string;
}): string {
  const skill = input.skillType ?? "unknown";
  const text = (
    input.text ?? [input.source?.stem ?? "", input.source?.instructions ?? ""].join("\n")
  ).toLowerCase();

  if (skill === "mirror_image") return /water/.test(text) ? "water" : "vertical";
  if (skill === "water_image") return "water";
  if (skill === "number_series") return seriesSubtype(input.source ?? null);
  if (skill === "synonym_antonym") {
    if (/opposite|antonym/.test(text)) return "antonym";
    if (/synonym|same meaning|similar meaning|same in meaning/.test(text)) return "synonym";
    return "synonym_antonym";
  }
  if (skill === "figure_pattern" || skill === "missing_number_figure") {
    if (/mirror|reflection/.test(text)) return "mirror";
    if (/embedded|hidden/.test(text)) return "embedded";
    if (/missing number/.test(text)) return "missing";
    if (/rotat|turned/.test(text)) return "rotation";
    if (/complete the pattern|pattern completion/.test(text)) return "completion";
    return "figure_pattern";
  }
  return skill;
}
