import { describe, expect, test } from "bun:test";

import { detectSkill } from "@/lib/generation/skill-detect";
import {
  buildFromSourceUserPrompt,
  finalizeMockQuestion,
  printedInstructionText,
} from "@/lib/mock-paper";
import { isPrintedDirection } from "@/lib/question-context";
import { emptyQuestion } from "@/lib/question-schema";

const ANTONYM_INSTRUCTION =
  "DIRECTIONS (71-75): Choose the word which is OPPOSITE in meaning to the given word.";

function wordOptions() {
  return [
    { key: "A", text: "Exhaust", is_correct: null },
    { key: "B", text: "Strengthen", is_correct: null },
    { key: "C", text: "Weaken", is_correct: null },
    { key: "D", text: "Arouse", is_correct: null },
  ];
}

describe("printed instruction quotes", () => {
  test("drops the DIRECTIONS header and range", () => {
    expect(printedInstructionText(ANTONYM_INSTRUCTION)).toBe(
      "Choose the word which is OPPOSITE in meaning to the given word.",
    );
  });

  test("drops a leading question-number range without a header", () => {
    expect(printedInstructionText("(Q. Nos. 21-25): Choose the opposite word.")).toBe(
      "Choose the opposite word.",
    );
  });

  test("keeps ordinary parentheses content", () => {
    expect(printedInstructionText("(Choose the best option) Fill in the blank.")).toBe(
      "(Choose the best option) Fill in the blank.",
    );
  });

  test("passes plain instructions through untouched and nulls empty input", () => {
    expect(printedInstructionText("Choose the opposite word")).toBe("Choose the opposite word");
    expect(printedInstructionText(null)).toBeNull();
    expect(printedInstructionText("   ")).toBeNull();
  });

  test("tells a printed direction from a question stem", () => {
    expect(isPrintedDirection("Choose the word which is OPPOSITE in meaning.")).toBe(true);
    expect(isPrintedDirection("Who is the Governor of Maharashtra?")).toBe(false);
    expect(isPrintedDirection("The light of Sun takes how much time to reach to Farth")).toBe(
      false,
    );
    expect(isPrintedDirection(null)).toBe(false);
  });
});

describe("from-source prompt honors printed instructions", () => {
  test("quotes the cleaned printed instruction as a must-follow block", () => {
    const prompt = buildFromSourceUserPrompt({
      sourceQuestion: emptyQuestion({
        number: "71",
        type: "mcq",
        stem: "DEBILITATE",
        instructions: ANTONYM_INSTRUCTION,
        options: wordOptions(),
      }),
      index: 0,
      total: 5,
      strategy: "write_new",
    });

    expect(prompt).toContain("SOURCE PRINTED INSTRUCTION (must follow for this question):");
    expect(prompt).toContain("Choose the word which is OPPOSITE in meaning to the given word.");
    expect(prompt).not.toContain("(71-75):");
  });

  test("skips the block when the source has no instruction", () => {
    const prompt = buildFromSourceUserPrompt({
      sourceQuestion: emptyQuestion({
        number: "1",
        type: "mcq",
        stem: "A number series 2, 4, 6, 8 …",
        options: wordOptions(),
      }),
      index: 0,
      total: 1,
      strategy: "write_new",
    });
    expect(prompt).not.toContain("SOURCE PRINTED INSTRUCTION");
  });

  test("asks the model to draw the question and each option figure as SVG", () => {
    const prompt = buildFromSourceUserPrompt({
      sourceQuestion: emptyQuestion({
        number: "5",
        type: "diagram",
        stem: "(a)",
        options: wordOptions(),
      }),
      index: 0,
      total: 1,
      strategy: "write_new",
    });
    expect(prompt).toContain("DRAWING FIGURES");
    expect(prompt).toContain('option\'s "svg" field');
  });

  test("rewrite still requires a newly drawn figure, never the source", () => {
    const prompt = buildFromSourceUserPrompt({
      sourceQuestion: emptyQuestion({
        number: "5",
        type: "diagram",
        stem: "(a)",
        figures: [{ description: "A square with a mirror line to its right." }],
      }),
      index: 0,
      total: 1,
      strategy: "rewrite",
      hasImages: true,
    });
    expect(prompt).toContain("Draw a NEW figure");
    expect(prompt).not.toContain("Keep the same kind of figure");
    expect(prompt).toContain("copyright breach");
  });

  test("write_new asks for a different arrangement of the source figure", () => {
    const prompt = buildFromSourceUserPrompt({
      sourceQuestion: emptyQuestion({
        number: "5",
        type: "diagram",
        stem: "(a)",
        figures: [{ description: "A square with a mirror line to its right." }],
      }),
      index: 0,
      total: 1,
      strategy: "write_new",
      hasImages: true,
    });
    expect(prompt).toContain("Invent a NEW figure");
    expect(prompt).toContain("different arrangement");
  });
});

describe("synonym/antonym detection", () => {
  test("instruction phrasing keeps a full-sentence stem out of general knowledge", () => {
    const skill = detectSkill({
      stem: "Choose the word which is OPPOSITE in meaning to the word given below.",
      instructions: null,
      type: "mcq",
      figureCount: 0,
      optionImageCount: 0,
      optionTexts: ["Exhaust", "Strengthen", "Weaken", "Arouse"],
      passage: null,
    });
    expect(skill).toBe("synonym_antonym");
  });

  test("bare word with several options stays synonym_antonym", () => {
    const skill = detectSkill({
      stem: "DEBILITATE",
      instructions: null,
      type: "mcq",
      optionTexts: ["Exhaust", "Strengthen", "Weaken", "Arouse"],
    });
    expect(skill).toBe("synonym_antonym");
  });
});

describe("finalize mock question", () => {
  test("copies the cleaned source instruction when the model omits one", () => {
    const question = finalizeMockQuestion(
      {
        number: "1",
        type: "mcq",
        stem: "Which word is OPPOSITE in meaning to the given word?",
        options: wordOptions(),
        answer_keys: ["B"],
      },
      { number: "1", sourceInstructions: ANTONYM_INSTRUCTION },
    );
    expect(question.instructions).toBe(
      "Choose the word which is OPPOSITE in meaning to the given word.",
    );
  });

  test("does not copy a source stem mistaken for an instruction", () => {
    const question = finalizeMockQuestion(
      {
        number: "1",
        type: "mcq",
        stem: "Which person currently serves as the Governor of Uttar Pradesh?",
        options: wordOptions(),
        answer_keys: ["A"],
      },
      {
        number: "1",
        sourceInstructions: "The light of Sun takes how much time to reach to Farth",
      },
    );
    expect(question.instructions).toBeNull();
  });

  test("keeps an instruction returned by the model", () => {
    const question = finalizeMockQuestion(
      {
        number: "1",
        type: "mcq",
        stem: "What is 12% of 400?",
        options: wordOptions(),
        answer_keys: ["A"],
        instructions: "The question is already self-contained.",
      },
      { number: "1", sourceInstructions: ANTONYM_INSTRUCTION },
    );
    expect(question.instructions).toBe("The question is already self-contained.");
  });

  test("moves figure descriptions captioned per option onto those options", () => {
    const question = finalizeMockQuestion(
      {
        number: "2",
        type: "mcq",
        stem: "Which figure comes next in the series?",
        options: [
          { key: "A", text: "", is_correct: true },
          { key: "B", text: "", is_correct: null },
          { key: "C", text: "", is_correct: null },
          { key: "D", text: "", is_correct: null },
        ],
        figures: [
          { description: "Question figure: three dots rotating clockwise.", caption: null },
          { description: "Series completed with four dots.", caption: "A" },
          { description: "Series rotated 90 degrees.", caption: "Option B" },
          { description: "Same figure crossed out.", caption: "Letter C" },
          { description: "Series reversed.", caption: "D" },
          { description: "Scratch drawing.", caption: "Series sketch" },
        ],
        answer_keys: ["A"],
      },
      { number: "2" },
    );

    const optionA = question.options.find((option) => option.key === "A");
    expect(optionA?.image_description).toBe("Series completed with four dots.");
    const captions = new Map(question.figures.map((figure) => [figure.caption, figure.role]));
    expect(captions.get("A")).toBe("option_figure");
    expect(captions.get("Option B")).toBe("option_figure");
    expect(captions.get("D")).toBe("option_figure");
    expect(captions.get("Letter C")).toBeNull();
    expect(captions.get("Series sketch")).toBeNull();
    expect(captions.get(null)).toBeNull();
  });

  test("does not overwrite a text option with a coincidental caption match", () => {
    const question = finalizeMockQuestion(
      {
        number: "3",
        type: "mcq",
        stem: "Find the odd one out.",
        options: [
          { key: "A", text: "Triangle", is_correct: null },
          { key: "B", text: "Square", is_correct: null },
          { key: "C", text: "Circle", is_correct: null },
          { key: "D", text: "Pentagon", is_correct: null },
        ],
        figures: [{ description: "A doodle labelled B from page 2.", caption: "B" }],
        answer_keys: ["C"],
      },
      { number: "3" },
    );
    const captions = new Map(question.figures.map((figure) => [figure.caption, figure.role]));
    const optionB = question.options.find((option) => option.key === "B");
    expect(optionB?.text).toBe("Square");
    expect(optionB?.image_description ?? null).toBeNull();
    expect(captions.get("B")).toBeNull();
  });
});
