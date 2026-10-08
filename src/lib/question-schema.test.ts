import { describe, expect, test } from "bun:test";

import { normalizeQuestion } from "@/lib/question-schema";

describe("normalizeQuestion drawings", () => {
  test("reads option drawings from either svg or image_svg", () => {
    const question = normalizeQuestion(
      {
        type: "mcq",
        stem: "Pick one",
        options: [
          { key: "A", text: "", image_svg: '<svg viewBox="0 0 1 1"></svg>' },
          { key: "B", text: "", svg: '<svg viewBox="0 0 2 2"></svg>' },
        ],
      },
      1,
    );

    expect(question.options[0]?.svg).toContain("0 0 1 1");
    expect(question.options[1]?.svg).toContain("0 0 2 2");
  });

  test("reads figure drawings from image_svg when svg is absent", () => {
    const question = normalizeQuestion(
      {
        type: "mcq",
        stem: "s",
        figures: [{ description: "d", image_svg: '<svg viewBox="0 0 3 3"></svg>' }],
      },
      1,
    );

    expect(question.figures[0]?.svg).toContain("0 0 3 3");
  });
});
