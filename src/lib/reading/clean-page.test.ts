import { describe, expect, test } from "bun:test";

import { cleanPage } from "@/lib/reading/clean-page";
import { emptyQuestion } from "@/lib/question-schema";
import type { PlacedWord } from "@/lib/reading/math-text";
import { readExamPage } from "@/lib/reading/pipeline";
import { toGraphicBlocks } from "@/lib/reading/regions";
import type { ReaderBlock } from "@/lib/reader/types";

const reader = { reader_id: "openocr", reader_version: "test" };
const sentence = "1. The cat sat on the mat.\n(a) chair (b) mat (c) tree (d) sky";

describe("reading pipeline", () => {
  test("text mode keeps the printed question and does not call layout", async () => {
    let layoutCalls = 0;
    const result = await readExamPage(
      {
        imageDataUrl: "data:image/png;base64,aaaa",
        page: 0,
        mode: "text",
      },
      {
        readText: async () => ({
          text: sentence,
          lines: [],
          source: "test",
          imageDataUrl: "data:image/png;base64,aaaa",
        }),
        readLayout: async () => {
          layoutCalls += 1;
          return [
            {
              id: "fig-1",
              type: "figure",
              bbox: [0.1, 0.2, 0.3, 0.2],
            },
          ];
        },
      },
    );

    expect(layoutCalls).toBe(0);
    expect(result.questions[0]?.stem).toBe("The cat sat on the mat.");
    expect(result.questions[0]?.figures).toEqual([]);
    expect(result.questions[0]?.type).not.toBe("diagram");
  });

  test("graphics mode keeps a diagram region and drops a text region", () => {
    const regions = toGraphicBlocks(
      [
        { label: "text", score: 0.95, box: [8, 8, 180, 28] },
        { label: "image", score: 0.88, box: [20, 80, 160, 200] },
        { label: "figure_title", score: 0.7, box: [20, 204, 120, 220] },
      ],
      { width: 400, height: 300 },
    );
    expect(regions.map((region) => region.type)).toEqual(["figure"]);

    const questions = cleanPage({
      pageText: sentence,
      page: 0,
      mode: "graphics",
      lines: [],
      regions,
      reader,
    });
    expect(questions[0]?.figures).toHaveLength(1);
    expect(questions[0]?.figures[0]?.role).toBe("question_figure");
    expect(questions[0]?.type).toBe("diagram");
    expect(questions[0]?.stem).toBe("The cat sat on the mat.");
  });

  test("text mode ignores diagram regions that were passed in", () => {
    const regions: ReaderBlock[] = [{ id: "fig-1", type: "figure", bbox: [0.1, 0.4, 0.4, 0.3] }];
    const questions = cleanPage({
      pageText: sentence,
      page: 0,
      mode: "text",
      lines: [],
      regions,
      reader,
    });
    expect(questions[0]?.figures).toEqual([]);
    expect(questions[0]?.type).toBe("mcq");
  });

  test("word boxes rewrite a stacked fraction into the option", async () => {
    const words: PlacedWord[] = [
      { text: "164.", bbox: [0.05, 0.04, 0.04, 0.02] },
      { text: "Which", bbox: [0.1, 0.04, 0.05, 0.02] },
      { text: "numbers", bbox: [0.16, 0.04, 0.06, 0.02] },
      { text: "ascend.", bbox: [0.23, 0.04, 0.06, 0.02] },
      { text: "(a)", bbox: [0.05, 0.15, 0.03, 0.02] },
      { text: "2", bbox: [0.1, 0.145, 0.015, 0.016] },
      { text: "3", bbox: [0.1, 0.168, 0.015, 0.016] },
      { text: "(b)", bbox: [0.2, 0.15, 0.03, 0.02] },
      { text: "0.5", bbox: [0.25, 0.15, 0.03, 0.02] },
    ];
    const result = await readExamPage(
      { imageDataUrl: "data:image/png;base64,aaaa", page: 0, mode: "text" },
      {
        readText: async () => ({
          text: "ignored when word boxes recover a fraction",
          words,
          lines: [],
          source: "test",
          imageDataUrl: "data:image/png;base64,aaaa",
        }),
        readLayout: async () => [],
      },
    );

    expect(result.questions[0]?.options.map((option) => option.text)).toContain("$\\frac{2}{3}$");
  });

  test("a short vision reading does not replace a fuller numbered split", () => {
    const questions = cleanPage({
      pageText: [
        "162. Express the Roman numeral CDXLVI in Arabic numeral.",
        "(a) 546 (b) 446",
        "163. The difference between 467890 and the number obtained",
        "(a) 59996 (b) 69994",
      ].join("\n"),
      page: 0,
      mode: "text",
      lines: [],
      regions: [],
      reader,
      preferModel: true,
      modelQuestions: [
        {
          ...emptyQuestion(),
          number: "164",
          type: "long_answer",
          stem: "164 . Express the Roman numeral mixed with 162 163 The Which",
        },
      ],
    });

    expect(questions.map((question) => question.number)).toEqual(["162", "163"]);
  });

  test("smashed math is replaced by a reading of the page image", async () => {
    let imageReads = 0;
    const smashed = [
      "164. Which of the following numbers are in the ascending order:",
      "(a) 3,5,05",
      "(b) 3,0.5, 5",
      "(c) 0.5, 3'5",
      "(d) 3, 0.5,3",
    ].join("\n");
    const result = await readExamPage(
      {
        imageDataUrl: "data:image/png;base64,aaaa",
        page: 0,
        mode: "text",
        digitisePage: async () => {
          imageReads += 1;
          return [
            {
              ...emptyQuestion(),
              number: "164",
              type: "mcq",
              stem: "Which of the following numbers are in the ascending order:",
              options: [
                { key: "A", text: "$\\frac{2}{3}$, $\\frac{4}{5}$, $0.5$", is_correct: null },
                { key: "B", text: "$\\frac{2}{3}$, $0.5$, $\\frac{4}{5}$", is_correct: null },
              ],
            },
          ];
        },
      },
      {
        readText: async () => ({
          text: smashed,
          lines: [],
          source: "test",
          imageDataUrl: "data:image/png;base64,aaaa",
        }),
        readLayout: async () => [],
      },
    );

    expect(imageReads).toBe(1);
    expect(result.questions[0]?.options[0]?.text).toContain("\\frac{2}{3}");
  });

  test("plain text does not ask for a vision reading", async () => {
    let imageReads = 0;
    await readExamPage(
      {
        imageDataUrl: "data:image/png;base64,aaaa",
        page: 0,
        mode: "text",
        digitisePage: async () => {
          imageReads += 1;
          return [];
        },
      },
      {
        readText: async () => ({
          text: sentence,
          lines: [],
          source: "test",
          imageDataUrl: "data:image/png;base64,aaaa",
        }),
        readLayout: async () => [],
      },
    );

    expect(imageReads).toBe(0);
  });
});
