import { describe, expect, test } from "bun:test";

import type { TextLineBox } from "@/lib/reader/parse-blocks";
import { structureOcrText } from "@/lib/ocr-structure";

import { orderedPageText } from "@/lib/reading/line-order";

function line(text: string, x: number, y: number, width = 0.3, height = 0.03): TextLineBox {
  return { text, bbox: [x, y, width, height] };
}

describe("orderedPageText", () => {
  test("reads side-by-side choices left to right and keeps the margin number", () => {
    const lines = [
      line("(a) Rib cage", 0.08, 0.2, 0.25),
      line("(c) Stapes", 0.08, 0.26, 0.25),
      line("86.", 0.02, 0.14, 0.05),
      line("______ is the smallest bone in the human body.", 0.08, 0.14, 0.7),
      line("(b) Scapula", 0.55, 0.2, 0.25),
      line("(d) Coxal bone", 0.55, 0.26, 0.25),
      line("87.", 0.02, 0.34, 0.05),
      line("The world's largest lake is ______.", 0.08, 0.34, 0.7),
      line("(a) Baikal Lake", 0.08, 0.4, 0.28),
      line("(c) Dead Sea", 0.08, 0.46, 0.28),
      line("(b) Lake Victoria", 0.55, 0.4, 0.3),
      line("(d) Caspian Sea", 0.55, 0.46, 0.3),
    ];

    const questions = structureOcrText(orderedPageText(lines), 40);

    expect(questions.map((question) => question.number)).toEqual(["86", "87"]);
    expect(questions[0]?.stem).toBe("____ is the smallest bone in the human body.");
    expect(questions[0]?.options.map((option) => option.text)).toEqual([
      "Rib cage",
      "Scapula",
      "Stapes",
      "Coxal bone",
    ]);
    expect(questions[0]?.options.map((option) => option.key)).toEqual(["A", "B", "C", "D"]);
    expect(questions[1]?.options.map((option) => option.text)).toEqual([
      "Baikal Lake",
      "Lake Victoria",
      "Dead Sea",
      "Caspian Sea",
    ]);
  });

  test("reads a two-column page down the left column first", () => {
    const text = orderedPageText([
      line("1. Left one", 0.05, 0.1, 0.35),
      line("2. Left two", 0.05, 0.3, 0.35),
      line("3. Right one", 0.55, 0.1, 0.35),
      line("4. Right two", 0.55, 0.3, 0.35),
    ]);

    expect(text.split("\n")).toEqual(["1. Left one", "2. Left two", "3. Right one", "4. Right two"]);
  });
});
