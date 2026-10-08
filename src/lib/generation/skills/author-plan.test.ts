import { describe, expect, test } from "bun:test";

import { skillAuthorPrompt, skillDifficultyGuidance } from "@/lib/generation/skill-prompts";
import { skillAuthorPlan } from "@/lib/generation/skills/author-plan";

const base = { grade: 6 as number | null, difficultyStep: 0, hasImages: false };

describe("skillAuthorPlan", () => {
  test("figure_pattern is a vision skill that needs images", () => {
    const plan = skillAuthorPlan({ ...base, skill: "figure_pattern", hasImages: true });
    expect(plan?.kind).toBe("vision");
    expect(plan?.requiresImages).toBe(true);
  });

  test("general_knowledge is a language skill that does not need images", () => {
    const plan = skillAuthorPlan({ ...base, skill: "general_knowledge" });
    expect(plan?.kind).toBe("language");
    expect(plan?.requiresImages).toBe(false);
  });

  test("checked, number series, and mirror skills stay on their own generators", () => {
    expect(skillAuthorPlan({ ...base, skill: "number_series" })).toBeNull();
    expect(skillAuthorPlan({ ...base, skill: "mirror_image" })).toBeNull();
    expect(skillAuthorPlan({ ...base, skill: "percentage" })).toBeNull();
  });

  test("a checked profit-and-loss plan does not reuse the percentage prompt", () => {
    const plan = skillAuthorPlan({ ...base, skill: "profit_loss" });
    const percentagePrompt = skillAuthorPrompt("percentage");
    expect(plan).toBeNull();
    expect(percentagePrompt).toBeTruthy();
    expect(plan?.systemAddendum ?? "").not.toContain(percentagePrompt ?? "Write a new percentage question");
  });

  test("grammar includes its prompt and the harder step", () => {
    const plan = skillAuthorPlan({ ...base, skill: "grammar", difficultyStep: 1 });
    const prompt = skillAuthorPrompt("grammar");
    const guidance = skillDifficultyGuidance("grammar", base.grade, 1);
    expect(prompt).toBeTruthy();
    expect(plan?.systemAddendum).toContain(prompt ?? "");
    expect(plan?.systemAddendum).toContain(
      "Make it one step harder than the source: more steps, a less obvious rule, or a less famous fact. Stay inside the class ceiling.",
    );
    expect(plan?.systemAddendum).toContain(guidance);
  });

  test("vision skills require a drawing for the question and each option", () => {
    const prompt = skillAuthorPrompt("figure_identity") ?? "";
    expect(prompt).toContain("figures[].svg");
    expect(prompt).toContain('answer-option figure');
    expect(prompt).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  test("language skills are not told to draw figures", () => {
    expect(skillAuthorPrompt("grammar") ?? "").not.toContain("figures[].svg");
  });
});
