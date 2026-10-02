import { describe, expect, test } from "bun:test";

import { cleanPage } from "@/lib/reading/clean-page";
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
});
