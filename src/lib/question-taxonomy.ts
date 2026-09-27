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
];

export function skillByType(skillType: string | null | undefined): SkillDefinition | null {
  if (!skillType) return null;
  return SKILL_CATALOG.find((entry) => entry.skill_type === skillType) ?? null;
}

/** A skill can run only when its generator, validator, and golden path exist. */
export function isAutoGeneratable(skillType: string | null | undefined): boolean {
  const entry = skillByType(skillType);
  return Boolean(entry?.enabled && entry.generator && entry.validator);
}
