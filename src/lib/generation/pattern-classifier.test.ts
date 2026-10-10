import { describe, expect, test } from "bun:test";

import { patternSubtypeOf, patternTypeOf } from "@/lib/generation/pattern-classifier";
import { detectSkill } from "@/lib/generation/skill-detect";
import { emptyQuestion } from "@/lib/question-schema";

describe("patternTypeOf", () => {
  test("figure skills collapse to figure_pattern", () => {
    expect(patternTypeOf("mirror_image")).toBe("figure_pattern");
    expect(patternTypeOf("embedded_figure")).toBe("figure_pattern");
    expect(patternTypeOf("missing_number_figure")).toBe("figure_pattern");
  });

  test("families map to their coarse type", () => {
    expect(patternTypeOf("number_series")).toBe("number_series");
    expect(patternTypeOf("letter_series")).toBe("letter_series");
    expect(patternTypeOf("coding_decoding")).toBe("coding");
    expect(patternTypeOf("general_knowledge")).toBe("knowledge");
    expect(patternTypeOf("grammar")).toBe("language");
    expect(patternTypeOf("blood_relations")).toBe("verbal_reasoning");
    expect(patternTypeOf("percentage")).toBe("arithmetic");
    expect(patternTypeOf(null)).toBe("unknown");
  });
});

describe("patternSubtypeOf", () => {
  test("mirror is vertical unless the wording asks for water", () => {
    expect(
      patternSubtypeOf({
        skillType: "mirror_image",
        source: emptyQuestion({ stem: "Choose the mirror image of the figure." }),
      }),
    ).toBe("vertical");
    expect(
      patternSubtypeOf({
        skillType: "mirror_image",
        source: emptyQuestion({ stem: "Choose the water image of the figure." }),
      }),
    ).toBe("water");
    expect(
      patternSubtypeOf({
        skillType: "water_image",
        source: emptyQuestion({ stem: "Choose the water image of the figure." }),
      }),
    ).toBe("water");
  });

  test("number series subtype reads the term gaps", () => {
    const arithmetic = emptyQuestion({ stem: "Find the next: 3, 6, 9, 12, ___" });
    const geometric = emptyQuestion({ stem: "Find the next: 2, 4, 8, 16, ___" });
    expect(patternSubtypeOf({ skillType: "number_series", source: arithmetic })).toBe("arithmetic");
    expect(patternSubtypeOf({ skillType: "number_series", source: geometric })).toBe("geometric");
  });

  test("ordinal term positions are ignored when reading the series", () => {
    const ordinal = emptyQuestion({ stem: "Find the 10th term of 2, 5, 8, 11" });
    expect(patternSubtypeOf({ skillType: "number_series", source: ordinal })).toBe("arithmetic");
  });

  test("decimal-step series are arithmetic", () => {
    const decimal = emptyQuestion({ stem: "Find the next: 0.1, 0.2, 0.3, 0.4, ___" });
    expect(patternSubtypeOf({ skillType: "number_series", source: decimal })).toBe("arithmetic");
  });

  test("synonym vs antonym follows the printed instruction", () => {
    expect(
      patternSubtypeOf({
        skillType: "synonym_antonym",
        source: emptyQuestion({ stem: "Brave", instructions: "Choose the opposite word." }),
      }),
    ).toBe("antonym");
    expect(
      patternSubtypeOf({
        skillType: "synonym_antonym",
        source: emptyQuestion({ stem: "Brave", instructions: "Choose the same meaning." }),
      }),
    ).toBe("synonym");
  });

  test("unknown skills fall back to the skill name", () => {
    expect(patternSubtypeOf({ skillType: null })).toBe("unknown");
    expect(patternSubtypeOf({ skillType: "percentage" })).toBe("percentage");
  });
});

describe("detectSkill water image", () => {
  test("a water-image stem is not labelled as a plain mirror", () => {
    expect(detectSkill({ stem: "Choose the water image of the figure." })).toBe("water_image");
    expect(detectSkill({ stem: "Choose the mirror image of the figure." })).toBe("mirror_image");
  });
});

describe("detectSkill Class 9 skills", () => {
  test("logic and coding items are recognised", () => {
    expect(
      detectSkill({
        stem: "Statements: All roses are flowers. All flowers are plants. Which conclusion definitely follows?",
      }),
    ).toBe("syllogism");
    expect(
      detectSkill({
        stem: "In a code, each letter is replaced by its position in the alphabet. What is the code for CAT?",
      }),
    ).toBe("matrix_coding");
  });

  test("math items are recognised", () => {
    expect(detectSkill({ stem: "What is the square root of 144?" })).toBe("squares_roots");
    expect(detectSkill({ stem: "What is 7³?" })).toBe("cubes_roots");
    expect(
      detectSkill({ stem: "Find the compound interest on ₹1000 at 10% per year for 2 years." }),
    ).toBe("compound_interest");
    expect(
      detectSkill({
        stem: "A bag contains 3 red and 2 blue balls. What is the probability that it is red?",
      }),
    ).toBe("probability");
    expect(
      detectSkill({ stem: "The angles of a quadrilateral are in the ratio 1 : 2 : 3 : 4." }),
    ).toBe("quadrilaterals");
  });
});
