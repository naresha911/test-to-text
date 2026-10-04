import { describe, expect, test } from "bun:test";

import { localCheckedSolution } from "@/lib/generation/hint-solve";

describe("localCheckedSolution", () => {
  test("a percentage spec solves to 20", () => {
    const result = localCheckedSolution({
      stem: "What is 50% of 40?",
      math_spec: { kind: "checked", skill: "percentage", whole: 40, percent: 50 },
    });
    expect(result?.answerText).toBe("20");
    expect(result?.hint).toContain("20");
    expect(result?.explanation).toContain("20");
  });

  test("an unknown skill returns null", () => {
    expect(
      localCheckedSolution({
        math_spec: { kind: "checked", skill: "nope" },
      }),
    ).toBeNull();
  });
});
