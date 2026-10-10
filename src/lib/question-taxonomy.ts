import { CHECKED_SKILL_IDS } from "@/lib/generation/checked/registry";
import type { QuestionType } from "@/lib/question-schema";

export type SkillFamily = "textual" | "math" | "intelligence";

export type SkillDefinition = {
  skill_type: string;
  family: SkillFamily;
  render_type: QuestionType;
  generator: string | null;
  validator: string | null;
  deterministic_oracle: boolean;
  visual: boolean;
  enabled: boolean;
};

function skill(
  partial: Pick<SkillDefinition, "skill_type" | "family" | "render_type"> &
    Partial<SkillDefinition>,
): SkillDefinition {
  return {
    generator: null,
    validator: null,
    deterministic_oracle: false,
    visual: false,
    enabled: false,
    ...partial,
  };
}

export const SKILL_CATALOG: SkillDefinition[] = [
  skill({
    skill_type: "grammar",
    family: "textual",
    render_type: "mcq",
    generator: "textual",
    validator: "structural",
    enabled: true,
  }),
  skill({
    skill_type: "number_series",
    family: "math",
    render_type: "mcq",
    generator: "number-series",
    validator: "number-series-solver",
    deterministic_oracle: true,
    enabled: true,
  }),
  skill({
    skill_type: "mirror_image",
    family: "intelligence",
    render_type: "mcq",
    generator: "mirror-image",
    validator: "mirror-oracle",
    deterministic_oracle: true,
    visual: true,
    enabled: true,
  }),
  skill({ skill_type: "comprehension", family: "textual", render_type: "comprehension" }),
  skill({ skill_type: "vocabulary", family: "textual", render_type: "mcq" }),
  skill({ skill_type: "arithmetic", family: "math", render_type: "numerical" }),
  skill({ skill_type: "missing_number", family: "math", render_type: "mcq" }),
  skill({ skill_type: "figure_series", family: "intelligence", render_type: "mcq", visual: true }),
  skill({ skill_type: "number_figure", family: "intelligence", render_type: "mcq", visual: true }),
  skill({
    skill_type: "counting_triangles",
    family: "intelligence",
    render_type: "mcq",
    visual: true,
  }),
  skill({ skill_type: "jumbled_sentences", family: "textual", render_type: "mcq" }),
  skill({ skill_type: "cloze", family: "textual", render_type: "mcq" }),
  skill({ skill_type: "synonym_antonym", family: "textual", render_type: "mcq" }),
  skill({ skill_type: "idioms", family: "textual", render_type: "mcq" }),
  skill({ skill_type: "spelling", family: "textual", render_type: "mcq" }),
  skill({ skill_type: "one_word_substitution", family: "textual", render_type: "mcq" }),
  skill({ skill_type: "parts_of_speech", family: "textual", render_type: "mcq" }),
  skill({ skill_type: "sentence_completion", family: "textual", render_type: "mcq" }),
  skill({ skill_type: "general_knowledge", family: "textual", render_type: "mcq" }),
  skill({ skill_type: "symbol_operations", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "clock_direction", family: "intelligence", render_type: "mcq" }),
  skill({
    skill_type: "embedded_figure",
    family: "intelligence",
    render_type: "diagram",
    visual: true,
  }),
  skill({
    skill_type: "figure_identity",
    family: "intelligence",
    render_type: "diagram",
    visual: true,
  }),
  skill({ skill_type: "meaningful_order", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "letter_series", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "blood_relations", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "symbol_arrangement", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "dictionary_order", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "calendar", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "coding_decoding", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "odd_one_out", family: "intelligence", render_type: "mcq" }),
  skill({
    skill_type: "figure_pattern",
    family: "intelligence",
    render_type: "diagram",
    visual: true,
  }),
  skill({
    skill_type: "figure_analogy",
    family: "intelligence",
    render_type: "diagram",
    visual: true,
  }),
  skill({ skill_type: "word_analogy", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "number_analogy", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "word_formation", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "direction_sense", family: "intelligence", render_type: "mcq" }),
  skill({
    skill_type: "venn_diagram",
    family: "intelligence",
    render_type: "diagram",
    visual: true,
  }),
  skill({ skill_type: "seating_arrangement", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "date_puzzle", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "ranking", family: "intelligence", render_type: "mcq" }),
  skill({
    skill_type: "missing_number_figure",
    family: "intelligence",
    render_type: "diagram",
    visual: true,
  }),
  skill({ skill_type: "profit_loss", family: "math", render_type: "mcq" }),
  skill({ skill_type: "division", family: "math", render_type: "mcq" }),
  skill({ skill_type: "fractions", family: "math", render_type: "mcq" }),
  skill({ skill_type: "mensuration", family: "math", render_type: "mcq" }),
  skill({ skill_type: "number_formation", family: "math", render_type: "mcq" }),
  skill({ skill_type: "percentage", family: "math", render_type: "mcq" }),
  skill({ skill_type: "ratio_hcf", family: "math", render_type: "mcq" }),
  skill({ skill_type: "triangle_area", family: "math", render_type: "mcq" }),
  skill({ skill_type: "speed_time", family: "math", render_type: "mcq" }),
  skill({ skill_type: "factors", family: "math", render_type: "mcq" }),
  skill({ skill_type: "angles", family: "math", render_type: "mcq" }),
  skill({ skill_type: "average", family: "math", render_type: "mcq" }),
  skill({ skill_type: "simple_interest", family: "math", render_type: "mcq" }),
  skill({ skill_type: "metric_measures", family: "math", render_type: "mcq" }),
  skill({ skill_type: "linear_equation", family: "math", render_type: "mcq" }),
  skill({ skill_type: "work_rate", family: "math", render_type: "mcq" }),
  skill({ skill_type: "unitary_method", family: "math", render_type: "mcq" }),
  skill({ skill_type: "mean_proportion", family: "math", render_type: "mcq" }),
  skill({ skill_type: "divisibility", family: "math", render_type: "mcq" }),
  skill({ skill_type: "multiplication", family: "math", render_type: "mcq" }),
  skill({ skill_type: "rounding", family: "math", render_type: "mcq" }),
  skill({ skill_type: "number_properties", family: "math", render_type: "mcq" }),
  skill({ skill_type: "roman_numerals", family: "math", render_type: "mcq" }),
  skill({ skill_type: "lcm_hcf", family: "math", render_type: "mcq" }),
  skill({ skill_type: "bodmas", family: "math", render_type: "mcq" }),
  skill({ skill_type: "decimals", family: "math", render_type: "mcq" }),
  skill({ skill_type: "circle", family: "math", render_type: "mcq" }),
  skill({ skill_type: "volume_solid", family: "math", render_type: "mcq" }),
  skill({ skill_type: "temperature_conversion", family: "math", render_type: "mcq" }),
  skill({ skill_type: "question_tags", family: "textual", render_type: "mcq" }),
  skill({ skill_type: "rational_numbers", family: "math", render_type: "mcq" }),
  skill({ skill_type: "squares_roots", family: "math", render_type: "mcq" }),
  skill({ skill_type: "cubes_roots", family: "math", render_type: "mcq" }),
  skill({ skill_type: "algebraic_identities", family: "math", render_type: "mcq" }),
  skill({ skill_type: "factorization", family: "math", render_type: "mcq" }),
  skill({ skill_type: "exponents", family: "math", render_type: "mcq" }),
  skill({ skill_type: "proportion", family: "math", render_type: "mcq" }),
  skill({ skill_type: "quadrilaterals", family: "math", render_type: "mcq" }),
  skill({ skill_type: "triangle_properties", family: "math", render_type: "mcq" }),
  skill({ skill_type: "parallel_lines", family: "math", render_type: "mcq" }),
  skill({ skill_type: "euler_formula", family: "math", render_type: "mcq" }),
  skill({ skill_type: "surface_area_volume", family: "math", render_type: "mcq" }),
  skill({ skill_type: "discount", family: "math", render_type: "mcq" }),
  skill({ skill_type: "compound_interest", family: "math", render_type: "mcq" }),
  skill({ skill_type: "statistics", family: "math", render_type: "mcq" }),
  skill({ skill_type: "probability", family: "math", render_type: "mcq" }),
  skill({ skill_type: "data_interpretation", family: "math", render_type: "mcq" }),
  skill({ skill_type: "graphs", family: "math", render_type: "mcq" }),
  skill({ skill_type: "matrix_coding", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "syllogism", family: "intelligence", render_type: "mcq" }),
  skill({ skill_type: "spotting_errors", family: "textual", render_type: "mcq" }),
  skill({ skill_type: "critical_thinking", family: "intelligence", render_type: "mcq" }),
  skill({
    skill_type: "water_image",
    family: "intelligence",
    render_type: "mcq",
    generator: "mirror-image",
    validator: "mirror-oracle",
    deterministic_oracle: true,
    visual: true,
    enabled: true,
  }),
];

for (const entry of SKILL_CATALOG) {
  if (!CHECKED_SKILL_IDS.includes(entry.skill_type as (typeof CHECKED_SKILL_IDS)[number])) continue;
  entry.generator = "checked";
  entry.validator = "checked-solver";
  entry.deterministic_oracle = true;
  entry.enabled = true;
}

export function skillByType(skillType: string | null | undefined): SkillDefinition | null {
  if (!skillType) return null;
  return SKILL_CATALOG.find((entry) => entry.skill_type === skillType) ?? null;
}

/** A skill can run only when its generator, validator, and golden path exist. */
export function isAutoGeneratable(skillType: string | null | undefined): boolean {
  const entry = skillByType(skillType);
  return Boolean(entry?.enabled && entry.generator && entry.validator);
}
