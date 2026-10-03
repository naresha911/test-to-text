import { describe, expect, test } from "bun:test";

import { emptyQuestion } from "@/lib/question-schema";
import {
  applyCropReading,
  oneCropQuestion,
  structureCropText,
} from "@/lib/reading/crop-layout";

describe("structureCropText", () => {
  test("splits choices in parentheses and keeps the question number", () => {
    const question = structureCropText(
      "3. Which is a mammal? (a) lizard (b) whale (c) snake (d) frog",
      "parentheses",
      0,
      null,
    );

    expect(question?.number).toBe("3");
    expect(question?.type).toBe("mcq");
    expect(question?.stem).toBe("Which is a mammal?");
    expect(question?.options.map((option) => option.text)).toEqual([
      "lizard",
      "whale",
      "snake",
      "frog",
    ]);
  });

  test("splits letter choices written as A. or A)", () => {
    const dotted = structureCropText(
      "What is the capital of France?\nA. Paris\nB. London\nC. Berlin\nD. Madrid",
      "letters",
      0,
      "8",
    );
    const paren = structureCropText("Find the value A) 10 B) 20 C) 30", "letters", 0, "2");

    expect(dotted?.number).toBe("8");
    expect(dotted?.options.map((option) => `${option.key}:${option.text}`)).toEqual([
      "A:Paris",
      "B:London",
      "C:Berlin",
      "D:Madrid",
    ]);
    expect(paren?.stem).toBe("Find the value");
    expect(paren?.options.map((option) => option.text)).toEqual(["10", "20", "30"]);
  });

  test("a single letter marker stays in the question", () => {
    const question = structureCropText("See note A. The capital is Paris.", "letters", 0, "1");

    expect(question?.options).toEqual([]);
    expect(question?.stem).toContain("A.");
  });

  test("true or false keeps the printed choices and the type", () => {
    const question = structureCropText(
      "4. The earth is flat.\n(a) True\n(b) False",
      "true_false",
      1,
      null,
    );

    expect(question?.type).toBe("true_false");
    expect(question?.stem).toBe("The earth is flat.");
    expect(question?.options.map((option) => option.text)).toEqual(["True", "False"]);
    expect(question?.page).toBe(1);
  });

  test("assertion and reason are split from the choices", () => {
    const question = structureCropText(
      [
        "Assertion (A): All squares are rectangles.",
        "Reason (R): All rectangles have four sides.",
        "(a) Both are true",
        "(b) Assertion is true",
      ].join("\n"),
      "assertion_reason",
      0,
      "5",
    );

    expect(question?.type).toBe("assertion_reason");
    expect(question?.assertion).toBe("All squares are rectangles.");
    expect(question?.reason).toBe("All rectangles have four sides.");
    expect(question?.options).toHaveLength(2);
  });

  test("underscores become blanks", () => {
    const question = structureCropText(
      "The process of ______ is called photosynthesis.",
      "fill_blank",
      0,
      "6",
    );

    expect(question?.type).toBe("fill_blank");
    expect(question?.stem).toContain("____");
    expect(question?.blanks).toEqual([""]);
  });

  test("a wide gap becomes a match pair", () => {
    const question = structureCropText(
      "Match the following\nDelhi    India\nParis    France",
      "match",
      0,
      "7",
    );

    expect(question?.type).toBe("match_the_following");
    expect(question?.stem).toBe("Match the following");
    expect(question?.match_pairs).toEqual([
      { left: "Delhi", right: "India" },
      { left: "Paris", right: "France" },
    ]);
  });

  test("a jumble keeps the slashes and the choices", () => {
    const question = structureCropText(
      "the / cat / mat / on\n(a) the cat on mat\n(b) cat the on mat",
      "jumble",
      0,
      "1",
    );

    expect(question?.type).toBe("mcq");
    expect(question?.stem).toContain("/");
    expect(question?.options).toHaveLength(2);
  });

  test("no-choices leaves option markers in the question text", () => {
    const question = structureCropText("Which animal? (a) cat (b) dog", "plain", 0, "9");

    expect(question?.options).toEqual([]);
    expect(question?.stem).toContain("(a) cat");
    expect(question?.type).toBe("short_answer");
  });
});

describe("oneCropQuestion", () => {
  test("prefers the reading that has the printed number", () => {
    const chosen = oneCropQuestion(
      [
        emptyQuestion({ number: "1", stem: "A long unrelated question about rivers." }),
        emptyQuestion({ number: "4", stem: "The cropped question.", options: [] }),
      ],
      "4",
    );

    expect(chosen?.number).toBe("4");
  });

  test("without a matching number, keeps the reading with more choices", () => {
    const chosen = oneCropQuestion(
      [
        emptyQuestion({ number: "1", stem: "Only the stem is here and it is fairly long." }),
        emptyQuestion({
          number: "2",
          stem: "Shorter.",
          options: [
            { key: "A", text: "one", is_correct: null },
            { key: "B", text: "two", is_correct: null },
          ],
        }),
      ],
      null,
    );

    expect(chosen?.number).toBe("2");
  });
});

describe("applyCropReading", () => {
  test("replaces the wording and keeps the identity, crop, and marks", () => {
    const current = emptyQuestion({
      id: "keep-me",
      number: "4",
      type: "short_answer",
      stem: "Old stem",
      marks: 2,
      page: 3,
      subject_id: 9,
      year: 2024,
      approved: true,
      hint: "Old hint",
      explanation: "Old explanation",
      source_block: {
        bbox: [0.1, 0.2, 0.5, 0.2],
        image_path: "doc/p1-q4-block.jpg",
        flags: ["missing_options"],
        passes: 1,
      },
    });
    const reading = emptyQuestion({
      id: "discard-me",
      number: "4",
      type: "mcq",
      stem: "Which is a mammal?",
      marks: 99,
      page: 0,
      options: [
        { key: "A", text: "whale", is_correct: null },
        { key: "B", text: "lizard", is_correct: null },
      ],
      figures: [
        {
          description: "A whale",
          bbox: [0.1, 0.1, 0.2, 0.2],
          image_path: "doc/new-fig.jpg",
        },
      ],
    });

    const text = applyCropReading(current, reading, "text");
    const graphics = applyCropReading(current, reading, "graphics");

    expect(text.id).toBe("keep-me");
    expect(text.page).toBe(3);
    expect(text.marks).toBe(2);
    expect(text.subject_id).toBe(9);
    expect(text.year).toBe(2024);
    expect(text.stem).toBe("Which is a mammal?");
    expect(text.type).toBe("mcq");
    expect(text.options.map((option) => option.text)).toEqual(["whale", "lizard"]);
    expect(text.figures).toEqual([]);
    expect(text.approved).toBe(false);
    expect(text.hint).toBeNull();
    expect(text.explanation).toBeNull();
    expect(text.source_block?.image_path).toBe("doc/p1-q4-block.jpg");
    expect(text.source_block?.bbox).toEqual([0.1, 0.2, 0.5, 0.2]);
    expect(graphics.figures[0]?.image_path).toBe("doc/new-fig.jpg");
  });

  test("a comprehension keeps its sub-questions when the new reading has none", () => {
    const current = emptyQuestion({
      type: "comprehension",
      stem: "Read the passage.",
      sub_questions: [emptyQuestion({ number: "1", stem: "What happened next in the story?" })],
    });
    const reading = emptyQuestion({ type: "comprehension", stem: "Read the printed passage." });
    const mcq = emptyQuestion({ type: "mcq", stem: "Which is a mammal?" });

    expect(applyCropReading(current, reading, "text").sub_questions).toHaveLength(1);
    expect(applyCropReading(current, mcq, "text").sub_questions).toEqual([]);
  });
});
