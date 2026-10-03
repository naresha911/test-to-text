import { describe, expect, test } from "bun:test";

import { questionsFromBlocks, attachFigures } from "@/lib/reader/parse-blocks";
import { normalizeQuestion } from "@/lib/question-schema";
import type { RawReaderResult } from "@/lib/reader/types";

const now = "2026-09-27T00:00:00.000Z";

function result(blocks: RawReaderResult["blocks"]): RawReaderResult {
  return {
    reader_id: "openocr",
    reader_version: "openocr-layout-1",
    blocks,
    created_at: now,
  };
}

describe("OpenOCR blocks", () => {
  test("an English question keeps the printed stem and options", () => {
    const questions = questionsFromBlocks(
      result([
        { id: "t1", type: "text", text: "1. The cat sat on the mat." },
        { id: "t2", type: "text", text: "(a) chair (b) mat (c) tree (d) sky" },
      ]),
      0,
    );
    expect(questions[0]?.stem).toBe("The cat sat on the mat.");
    expect(questions[0]?.options.map((option) => option.text)).toEqual([
      "chair",
      "mat",
      "tree",
      "sky",
    ]);
    expect(questions[0]?.reader_id).toBe("openocr");
  });

  test("a formula block is kept as LaTeX", () => {
    const questions = questionsFromBlocks(
      result([
        { id: "t1", type: "text", text: "2. Solve" },
        { id: "f1", type: "formula", latex: "x^2 - 5x + 6 = 0" },
      ]),
      0,
    );
    expect(questions[0]?.stem).toContain("$x^2 - 5x + 6 = 0$");
    expect(questions[0]?.stem).not.toMatch(/squared/i);
  });

  test("a mirror question keeps the instruction and crops the answer figures", () => {
    const questions = questionsFromBlocks(
      result([
        {
          id: "t1",
          type: "text",
          text: "108. Select the correct mirror image of the given figure when the mirror is placed at the right side.",
        },
        { id: "t2", type: "text", text: "Question Figure" },
        { id: "t3", type: "text", text: "Answer Figures" },
        { id: "q", type: "figure", bbox: [0.08, 0.12, 0.2, 0.28] },
        { id: "a", type: "figure", bbox: [0.08, 0.55, 0.12, 0.16] },
        { id: "b", type: "figure", bbox: [0.28, 0.55, 0.12, 0.16] },
        { id: "c", type: "figure", bbox: [0.48, 0.55, 0.12, 0.16] },
        { id: "d", type: "figure", bbox: [0.68, 0.55, 0.12, 0.16] },
      ]),
      0,
    );
    const question = questions[0];
    expect(question?.stem).toBe(
      "Select the correct mirror image of the given figure when the mirror is placed at the right side.",
    );
    expect(question?.figures.filter((figure) => figure.role === "question_figure")).toHaveLength(1);
    const optionFigures =
      question?.figures.filter((figure) => figure.role === "option_figure") ?? [];
    expect(optionFigures.map((figure) => figure.caption)).toEqual(["A", "B", "C", "D"]);
    expect(question?.options.map((option) => option.key)).toEqual(["A", "B", "C", "D"]);
    expect(question?.answer_keys).toEqual([]);
  });

  test("a figure on the right column stays with that question", () => {
    const questions = [
      normalizeQuestion(
        {
          number: "95",
          type: "mcq",
          stem: "Electric Iron was invented by ____ and he was from",
          options: [
            { key: "A", text: "H.W. Seeley, USA" },
            { key: "B", text: "William Siemens, Germany" },
          ],
        },
        0,
      ),
      normalizeQuestion(
        {
          number: "108",
          type: "mcq",
          stem: "Select the correct mirror image of the given figure when the mirror is placed at the right side.",
        },
        0,
      ),
    ];
    const placed = attachFigures(
      questions,
      [
        { id: "q", type: "figure", bbox: [0.62, 0.22, 0.12, 0.16] },
        { id: "a", type: "figure", bbox: [0.55, 0.42, 0.08, 0.1] },
        { id: "b", type: "figure", bbox: [0.66, 0.42, 0.08, 0.1] },
        { id: "c", type: "figure", bbox: [0.77, 0.42, 0.08, 0.1] },
        { id: "d", type: "figure", bbox: [0.88, 0.42, 0.08, 0.1] },
      ],
      { reader_id: "openocr", reader_version: "openocr-layout-1" },
      [
        { text: "95. Electric Iron", bbox: [0.05, 0.08, 0.4, 0.02] },
        { text: "108. Select the correct mirror image", bbox: [0.55, 0.18, 0.4, 0.02] },
      ],
    );
    expect(placed[0]?.figures).toHaveLength(0);
    expect(placed[1]?.figures.filter((figure) => figure.role === "option_figure")).toHaveLength(4);
    expect(placed[1]?.stem).toContain("mirror image");
  });

  test("small figures on a full page keep the question diamond apart from the answer row", () => {
    const questions = questionsFromBlocks(
      result([
        {
          id: "t1",
          type: "text",
          text: "108. Select the correct mirror image of the given figure when the mirror is placed at the right side.",
        },
        { id: "q", type: "figure", bbox: [0.5825, 0.1514, 0.0285, 0.0229] },
        { id: "a", type: "figure", bbox: [0.5825, 0.1871, 0.0285, 0.0221] },
        { id: "b", type: "figure", bbox: [0.6238, 0.1864, 0.0285, 0.0229] },
        { id: "c", type: "figure", bbox: [0.665, 0.1857, 0.0295, 0.0229] },
        { id: "d", type: "figure", bbox: [0.7063, 0.185, 0.0305, 0.0229] },
      ]),
      0,
    );
    const question = questions[0];
    expect(question?.figures.filter((figure) => figure.role === "question_figure")).toHaveLength(1);
    expect(question?.figures.filter((figure) => figure.role === "option_figure")).toHaveLength(4);
    expect(question?.stem).toContain("mirror image");
    expect(question?.stem).not.toMatch(/we'll add a figure/i);
  });

  test("a series of three figures plus a blank stays on the question, not the choices", () => {
    const questions = questionsFromBlocks(
      result([
        {
          id: "t1",
          type: "text",
          text: "132. Select the option figure that will replace the interrogation mark in the following series.",
        },
        { id: "t2", type: "text", text: "Question Figures" },
        { id: "t3", type: "text", text: "Answer Figures" },
        { id: "q1", type: "figure", bbox: [0.08, 0.18, 0.12, 0.16] },
        { id: "q2", type: "figure", bbox: [0.24, 0.18, 0.12, 0.16] },
        { id: "q3", type: "figure", bbox: [0.4, 0.18, 0.12, 0.16] },
        { id: "blank", type: "figure", bbox: [0.56, 0.18, 0.12, 0.16] },
        { id: "a", type: "figure", bbox: [0.08, 0.48, 0.12, 0.16] },
        { id: "b", type: "figure", bbox: [0.24, 0.48, 0.12, 0.16] },
        { id: "c", type: "figure", bbox: [0.4, 0.48, 0.12, 0.16] },
        { id: "d", type: "figure", bbox: [0.56, 0.48, 0.12, 0.16] },
      ]),
      0,
    );
    const question = questions[0];
    const series = question?.figures.filter((figure) => figure.role === "question_figure") ?? [];
    const choices = question?.figures.filter((figure) => figure.role === "option_figure") ?? [];
    expect(series.map((figure) => figure.bbox?.[0])).toEqual([0.08, 0.24, 0.4, 0.56]);
    expect(choices.map((figure) => figure.caption)).toEqual(["A", "B", "C", "D"]);
    expect(choices.every((figure) => (figure.bbox?.[1] ?? 0) > 0.4)).toBe(true);
    expect(question?.options.map((option) => option.key)).toEqual(["A", "B", "C", "D"]);
  });

  test("a missing option letter is still given a figure slot", () => {
    const questions = questionsFromBlocks(
      result([
        {
          id: "t1",
          type: "text",
          text: "108. Select the correct mirror image of the given figure when the mirror is placed at the right side. (a) (b) (d)",
        },
        { id: "q", type: "figure", bbox: [0.08, 0.12, 0.2, 0.2] },
        { id: "a", type: "figure", bbox: [0.08, 0.55, 0.12, 0.16] },
        { id: "b", type: "figure", bbox: [0.28, 0.55, 0.12, 0.16] },
        { id: "c", type: "figure", bbox: [0.48, 0.55, 0.12, 0.16] },
        { id: "d", type: "figure", bbox: [0.68, 0.55, 0.12, 0.16] },
      ]),
      0,
    );
    expect(questions[0]?.options.map((option) => option.key)).toEqual(["A", "B", "C", "D"]);
  });
});
