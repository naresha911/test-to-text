import { describe, expect, test } from "bun:test";

import {
  inlineStackedFractions,
  mathTranscriptIsSmashed,
  type PlacedWord,
} from "@/lib/reading/math-text";

function word(text: string, x: number, y: number, w: number, h: number): PlacedWord {
  return { text, bbox: [x, y, w, h] };
}

describe("inlineStackedFractions", () => {
  test("a number sitting on another number becomes a fraction", () => {
    const text = inlineStackedFractions([
      word("2", 0.2, 0.1, 0.02, 0.02),
      word("3", 0.2, 0.13, 0.02, 0.02),
    ]);

    expect(text).toBe("$\\frac{2}{3}$");
  });

  test("a whole number tight against a stacked pair becomes a mixed number", () => {
    const text = inlineStackedFractions([
      word("2", 0.1, 0.11, 0.02, 0.03),
      word("1", 0.14, 0.1, 0.015, 0.018),
      word("3", 0.14, 0.125, 0.015, 0.018),
    ]);

    expect(text).toBe("$2\\frac{1}{3}$");
  });

  test("option fractions stay beside the choice letter and a decimal", () => {
    const text = inlineStackedFractions([
      word("(a)", 0.05, 0.115, 0.03, 0.02),
      word("2", 0.1, 0.1, 0.015, 0.018),
      word("3", 0.1, 0.125, 0.015, 0.018),
      word("4", 0.16, 0.1, 0.015, 0.018),
      word("5", 0.16, 0.125, 0.015, 0.018),
      word("0.5", 0.21, 0.112, 0.03, 0.02),
    ]);

    expect(text).toBe("(a) $\\frac{2}{3}$ $\\frac{4}{5}$ 0.5");
  });

  test("question numbers on successive lines stay question numbers", () => {
    const text = inlineStackedFractions([
      word("162", 0.045, 0.019, 0.067, 0.04),
      word(".", 0.045, 0.019, 0.067, 0.04),
      word("Express", 0.118, 0.02, 0.12, 0.04),
      word("the", 0.25, 0.02, 0.05, 0.04),
      word("163", 0.042, 0.103, 0.067, 0.034),
      word(".", 0.042, 0.103, 0.067, 0.034),
      word("The", 0.115, 0.103, 0.06, 0.033),
      word("difference", 0.19, 0.103, 0.12, 0.034),
      word("2", 0.201, 0.578, 0.021, 0.021),
      word("(a)", 0.093, 0.596, 0.05, 0.029),
      word("1055", 0.169, 0.609, 0.082, 0.025),
    ]);

    expect(text).toMatch(/162\. Express/);
    expect(text).toMatch(/163\. The difference/);
    expect(text).not.toContain("\\frac{162}");
    expect(text).toContain("(a) $\\frac{2}{1055}$");
  });

  test("a digit inside a sentence is not a fraction over the next line", () => {
    const text = inlineStackedFractions([
      word("digits", 0.365, 0.139, 0.08, 0.029),
      word("0", 0.464, 0.139, 0.02, 0.029),
      word("and", 0.5, 0.139, 0.04, 0.029),
      word("(b)", 0.307, 0.172, 0.04, 0.029),
      word("69994", 0.372, 0.172, 0.134, 0.029),
    ]);

    expect(text).toBeNull();
  });

  test("ordinary words with no stack are left alone", () => {
    expect(
      inlineStackedFractions([
        word("The", 0.1, 0.1, 0.04, 0.02),
        word("cat", 0.15, 0.1, 0.04, 0.02),
      ]),
    ).toBeNull();
  });
});

describe("mathTranscriptIsSmashed", () => {
  test("digit soup in the options is smashed math", () => {
    const text = [
      "164. Which of the following numbers are in the ascending order:",
      "(a) 3,5,05",
      "(b) 3,0.5, 5",
      "(c) 0.5, 3'5",
      "(d) 3, 0.5,3",
    ].join("\n");

    expect(mathTranscriptIsSmashed(text)).toBe(true);
  });

  test("a flattened mixed-number sum is smashed math", () => {
    expect(mathTranscriptIsSmashed("172. 2 1 3 + 1 1 2 - 2 1 4 = ?")).toBe(true);
  });

  test("plain numeric choices are not smashed", () => {
    const text = "(a) 427 (b) 28 (c) 61 (d) 35";
    expect(mathTranscriptIsSmashed(text)).toBe(false);
  });

  test("recovered fractions are not sent to the vision reader again", () => {
    expect(mathTranscriptIsSmashed("(a) $\\frac{2}{3}$ (b) $\\frac{4}{5}$")).toBe(false);
  });

  test("a recovered fraction does not hide other smashed options", () => {
    const text = "(a) $\\frac{2}{1055}$ (b) 3,5,05 (c) 0.5, 3'5";
    expect(mathTranscriptIsSmashed(text)).toBe(true);
  });
});
