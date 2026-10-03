import { describe, expect, test } from "bun:test";

import { normalizeQuestion, emptyQuestion, type Question } from "@/lib/question-schema";
import type { TextLineBox } from "@/lib/reader/parse-blocks";

import { segmentQuestionBlocks } from "@/lib/reading/question-blocks";
import { acceptRepair, auditQuestion, auditQuestions } from "@/lib/reading/read-audit";
import { repairFlaggedQuestions } from "@/lib/reading/repair-pass";

function line(text: string, x: number, y: number, width = 0.7, height = 0.03): TextLineBox {
  return { text, bbox: [x, y, width, height] };
}

function mcq(stem: string, options: string[]): Question {
  return emptyQuestion({
    number: "1",
    type: "mcq",
    stem,
    options: options.map((text, index) => ({
      key: String.fromCharCode(65 + index),
      text,
      is_correct: null,
    })),
  });
}

describe("question blocks", () => {
  test("cuts a single column from one question number to the next", () => {
    const blocks = segmentQuestionBlocks([
      line("1. Alpha question about cats", 0.1, 0.1),
      line("about the mat", 0.1, 0.16),
      line("2. Beta question about dogs", 0.1, 0.4),
    ]);

    expect(blocks.map((block) => block.number)).toEqual(["1", "2"]);
    expect(blocks[0]?.lines.map((item) => item.text)).toEqual([
      "1. Alpha question about cats",
      "about the mat",
    ]);
    expect(blocks[0]?.bbox[2]).toBeGreaterThan(0.9);
    expect(blocks[1]?.bbox[1]).toBeGreaterThan(blocks[0]!.bbox[1]);
  });

  test("reads two columns from top to bottom", () => {
    const blocks = segmentQuestionBlocks([
      line("1. Left one", 0.05, 0.1, 0.35),
      line("2. Left two", 0.05, 0.3, 0.35),
      line("3. Right one", 0.55, 0.1, 0.35),
      line("4. Right two", 0.55, 0.3, 0.35),
    ]);

    expect(blocks.map((block) => block.number)).toEqual(["1", "2", "3", "4"]);
    expect(blocks[0]!.bbox[0]).toBeLessThan(0.2);
    expect(blocks[2]!.bbox[0]).toBeGreaterThan(0.4);
    expect(blocks[0]!.bbox[1]).toBeLessThan(blocks[1]!.bbox[1]);
  });

  test("splits a question number that was merged into the previous block", () => {
    const blocks = segmentQuestionBlocks([
      line("1. First question about cats", 0.1, 0.1, 0.8),
      line("2. Second question starts here", 0.1, 0.25, 0.8),
      line("and continues 3. Third question was merged", 0.1, 0.32, 0.8),
      line("4. Fourth question is here", 0.1, 0.5, 0.8),
    ]);

    expect(blocks.map((block) => block.number)).toEqual(["1", "2", "3", "4"]);
    expect(blocks[2]?.lines[0]?.text).toBe("3. Third question was merged");
    expect(blocks[1]?.lines.some((item) => item.text.includes("3."))).toBe(false);
  });
});

describe("read checks", () => {
  test("a normal short answer and a normal multiple choice stay quiet", () => {
    const shortAnswer = emptyQuestion({
      number: "2",
      type: "short_answer",
      stem: "Define osmosis in one sentence.",
    });
    const choice = mcq("The cat sat on the mat.", ["chair", "mat", "tree", "sky"]);
    const numerical = emptyQuestion({
      number: "3",
      type: "numerical",
      stem: "Find x.",
    });
    const priceLine = emptyQuestion({
      number: "7",
      type: "short_answer",
      stem: "7. The cost of living rose last year.",
    });

    expect(auditQuestion(shortAnswer)).toEqual([]);
    expect(auditQuestion(choice)).toEqual([]);
    expect(auditQuestion(numerical)).toEqual([]);
    expect(auditQuestion(priceLine)).toEqual([]);
  });

  test("flags choices left in the stem and a multiple choice with no choices", () => {
    const stuck = emptyQuestion({
      number: "1",
      type: "short_answer",
      stem: "Pick one (a) cat (b) dog (c) rat (d) bat",
    });
    const missing = emptyQuestion({
      number: "1",
      type: "mcq",
      stem: "Which of the following is a mammal?",
      options: [],
    });

    expect(auditQuestion(stuck)).toEqual(["options_in_stem", "missing_options"]);
    expect(auditQuestion(missing)).toEqual(["missing_options"]);
  });

  test("flags smashed math, an unclosed equation, a suspicious rupee, and a cut-off stem", () => {
    const smashed = mcq("Which of the following numbers are in the ascending order:", [
      "3,5,05",
      "3,0.5, 5",
      "0.5, 3'5",
      "3, 0.5,3",
    ]);
    const openMath = emptyQuestion({
      number: "1",
      type: "short_answer",
      stem: "The value of the expression is $x+1 for this part.",
    });
    const rupee = emptyQuestion({
      number: "1",
      type: "short_answer",
      stem: "The cost of the pen is 7 250 after tax.",
    });
    const cutOff = emptyQuestion({
      number: "5",
      type: "short_answer",
      stem: "The ca",
    });

    expect(auditQuestion(smashed)).toContain("broken_math");
    expect(auditQuestion(openMath)).toEqual(["broken_math"]);
    expect(auditQuestion(rupee)).toEqual(["suspicious_currency"]);
    expect(rupee.stem).toBe("The cost of the pen is 7 250 after tax.");
    expect(auditQuestion(cutOff)).toEqual(["partial_stem"]);
  });

  test("flags a hole in the question numbers without calling it a broken choice", () => {
    const audited = auditQuestions([
      emptyQuestion({
        id: "a",
        number: "1",
        type: "short_answer",
        stem: "Define osmosis in one full sentence.",
      }),
      emptyQuestion({
        id: "b",
        number: "2",
        type: "short_answer",
        stem: "Name the process plants use.",
      }),
      emptyQuestion({
        id: "c",
        number: "4",
        type: "short_answer",
        stem: "State the unit of force in words.",
      }),
    ]);

    expect(audited.find((question) => question.number === "4")?.source_block?.flags).toEqual([
      "number_gap",
    ]);
    expect(audited.find((question) => question.number === "1")?.source_block?.flags).toEqual([]);
  });

  test("keeps a repair that clears the flag and still has the first read's words", () => {
    const before = emptyQuestion({
      number: "1",
      type: "short_answer",
      stem: "The cost of the book is 7 500 today",
    });
    const after = emptyQuestion({
      number: "1",
      type: "short_answer",
      stem: "The cost of the book is 500 today",
    });

    expect(acceptRepair(before, after, ["suspicious_currency"])).toBe(true);
  });

  test("rejects a smoother sentence that drops the first read's words", () => {
    const before = emptyQuestion({
      number: "1",
      type: "short_answer",
      stem: "The cat sat on the mat beside the door",
    });
    const after = emptyQuestion({
      number: "1",
      type: "short_answer",
      stem: "A feline rested nearby in the room",
    });

    expect(acceptRepair(before, after, ["partial_stem"])).toBe(false);
  });
});

describe("repair loop", () => {
  test("re-reads a failing crop with the other engine and keeps the cleared text", async () => {
    let crops = 0;
    const question = emptyQuestion({
      number: "1",
      type: "mcq",
      stem: "Which of the following is a mammal",
      options: [],
    });
    const result = await repairFlaggedQuestions([question], {
      lines: [line("1. Which of the following is a mammal", 0.05, 0.1, 0.8)],
      source: "local",
      imageDataUrl: "data:image/jpeg;base64,aa",
      page: 0,
      ocrSpaceKey: "key",
      cropRegion: async (_image, _bbox, options) => {
        crops += 1;
        expect(options.scale).toBe(2);
        return "data:image/jpeg;base64,bb";
      },
      readOcrSpaceText: async () =>
        "1. Which of the following is a mammal\n(a) dog\n(b) cat\n(c) bird\n(d) fish",
    });

    expect(crops).toBe(1);
    expect(result[0]?.options.map((option) => option.text)).toEqual(["dog", "cat", "bird", "fish"]);
    expect(result[0]?.source_block?.flags).not.toContain("missing_options");
    expect(result[0]?.source_block?.passes).toBe(2);
    expect(result[0]?.id).toBe(question.id);
  });

  test("keeps the first read when the new sentence drops its words", async () => {
    let crops = 0;
    const question = emptyQuestion({
      number: "1",
      type: "mcq",
      stem: "Which of the following is a mammal",
      options: [],
    });
    const result = await repairFlaggedQuestions([question], {
      lines: [line("1. Which of the following is a mammal", 0.05, 0.1, 0.8)],
      source: "local",
      imageDataUrl: "data:image/jpeg;base64,aa",
      page: 0,
      ocrSpaceKey: "key",
      cropRegion: async () => {
        crops += 1;
        return "data:image/jpeg;base64,bb";
      },
      readOcrSpaceText: async () => "1. A smooth sentence about animals in general terms",
    });

    expect(crops).toBe(2);
    expect(result[0]?.stem).toBe("Which of the following is a mammal");
    expect(result[0]?.options).toEqual([]);
    expect(result[0]?.source_block?.passes).toBe(3);
    expect(result[0]?.source_block?.flags).toContain("missing_options");
  });

  test("a missing number is not sent back to OCR", async () => {
    let crops = 0;
    const result = await repairFlaggedQuestions(
      [
        emptyQuestion({
          id: "a",
          number: "1",
          type: "short_answer",
          stem: "Define osmosis in one full sentence.",
        }),
        emptyQuestion({
          id: "b",
          number: "4",
          type: "short_answer",
          stem: "State the unit of force in words.",
        }),
      ],
      {
        lines: [
          line("1. Define osmosis in one full sentence.", 0.1, 0.1),
          line("4. State the unit of force in words.", 0.1, 0.4),
        ],
        source: "local",
        imageDataUrl: "data:image/jpeg;base64,aa",
        page: 0,
        ocrSpaceKey: "key",
        cropRegion: async () => {
          crops += 1;
          return "data:image/jpeg;base64,bb";
        },
      },
    );

    expect(crops).toBe(0);
    expect(result.find((question) => question.number === "4")?.source_block?.flags).toContain(
      "number_gap",
    );
  });

  test("uses the vision reader on the second pass only when math is still broken", async () => {
    let textReads = 0;
    let imageReads = 0;
    const question = mcq("Which of the following numbers are in the ascending order:", [
      "3,5,05",
      "3,0.5, 5",
      "0.5, 3'5",
      "3, 0.5,3",
    ]);
    const result = await repairFlaggedQuestions([question], {
      lines: [
        line("1. Which of the following numbers are in the ascending order:", 0.05, 0.1, 0.8),
      ],
      source: "local",
      imageDataUrl: "data:image/jpeg;base64,aa",
      page: 0,
      ocrSpaceKey: "key",
      cropRegion: async () => "data:image/jpeg;base64,bb",
      readOcrSpaceText: async () => {
        textReads += 1;
        return [
          "1. Which of the following numbers are in the ascending order:",
          "(a) 3,5,05",
          "(b) 3,0.5, 5",
          "(c) 0.5, 3'5",
          "(d) 3, 0.5,3",
        ].join("\n");
      },
      digitisePage: async () => {
        imageReads += 1;
        return [
          emptyQuestion({
            number: "1",
            type: "mcq",
            stem: "Which of the following numbers are in the ascending order:",
            options: [
              { key: "A", text: "$\\frac{2}{3}$", is_correct: null },
              { key: "B", text: "$0.5$", is_correct: null },
              { key: "C", text: "$\\frac{4}{5}$", is_correct: null },
              { key: "D", text: "$\\frac{3}{5}$", is_correct: null },
            ],
          }),
        ];
      },
    });

    expect(textReads).toBe(1);
    expect(imageReads).toBe(1);
    expect(result[0]?.options[0]?.text).toContain("\\frac{2}{3}");
    expect(result[0]?.source_block?.flags).not.toContain("broken_math");
    expect(result[0]?.source_block?.passes).toBe(3);
  });

  test("does not re-read when the other engine is unavailable", async () => {
    let crops = 0;
    const question = emptyQuestion({
      number: "1",
      type: "mcq",
      stem: "Which of the following is a mammal",
      options: [],
    });
    const result = await repairFlaggedQuestions([question], {
      lines: [line("1. Which of the following is a mammal", 0.05, 0.1, 0.8)],
      source: "local",
      imageDataUrl: "data:image/jpeg;base64,aa",
      page: 0,
      cropRegion: async () => {
        crops += 1;
        return "data:image/jpeg;base64,bb";
      },
      digitisePage: async () => {
        throw new Error("vision should not run");
      },
    });

    expect(crops).toBe(0);
    expect(result[0]?.stem).toBe(question.stem);
    expect(result[0]?.source_block?.passes).toBe(1);
    expect(result[0]?.source_block?.bbox).not.toBeNull();
  });
});

describe("leftover question boxes", () => {
  test("a question whose number missed its block still receives the leftover box", async () => {
    const first = emptyQuestion({
      number: "1",
      type: "short_answer",
      stem: "Alpha question about cats today",
    });
    const second = emptyQuestion({
      number: "9",
      type: "short_answer",
      stem: "Beta question about dogs today",
    });
    const result = await repairFlaggedQuestions([first, second], {
      lines: [
        line("1. Alpha question about cats today", 0.1, 0.1),
        line("2. Beta question about dogs today", 0.1, 0.4),
      ],
      source: "local",
      imageDataUrl: "data:image/jpeg;base64,aa",
      page: 0,
    });

    expect(result.map((question) => question.number)).toEqual(["1", "9"]);
    expect(result[0]?.source_block?.bbox).not.toBeNull();
    expect(result[1]?.source_block?.bbox).not.toBeNull();
    expect(result[0]!.source_block!.bbox![1]).toBeLessThan(result[1]!.source_block!.bbox![1]);
  });
});

describe("source block storage", () => {
  test("normalizeQuestion keeps the printed crop and its flags", () => {
    const question = normalizeQuestion(
      {
        number: "4",
        type: "mcq",
        stem: "Which of the following is a mammal",
        options: [],
        source_block: {
          bbox: [0.1, 0.2, 0.7, 0.2],
          image_path: "doc/p1-q1-block.jpg",
          flags: ["missing_options", "not-a-flag"],
          passes: 2,
        },
      },
      0,
    );

    expect(question.source_block).toEqual({
      bbox: [0.1, 0.2, 0.7, 0.2],
      image_path: "doc/p1-q1-block.jpg",
      flags: ["missing_options"],
      passes: 2,
    });
  });
});
