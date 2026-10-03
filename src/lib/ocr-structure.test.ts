import { describe, expect, test } from "bun:test";

import { cleanPage } from "@/lib/reading/clean-page";
import { structureOcrText } from "@/lib/ocr-structure";

const rearrangement = `DIRECTIONS (1-5): Rearrange the following in a sequence to
form meaningful sentences and choose the correct option:
he/the books/held on to/passionately
(a) He passionately held on to the books.
(b) He held on to the books passionately.
(c) He held on to passionately the books.
(a) The books held on to he passionately.
is not/wheat/native to/and barley/isn't either/India
(a) Wheat native to and barley is not isn't either India.
(b) Wheat and barley is not native to India isn't either.
(c) Wheat is not native to India and barley isn't either.
(a) Wheat and barley is not native to isn't either India.
the police/indiscriminately/sprayed/on the protestors/tear
gas
(a) The police indiscriminately sprayed tear gas on the
protestors.
(b) On the protestors the police sprayed tear gas
indiscriminately.
(c) The police sprayed on the protestors tear gas
indiscriminately.
(d) The police sprayed tear gas indiscriminately on the
protestors.
against/advised/me/English/opting/for/many/people
(a) Many people advised me against opting for English.
(b) Many people against opting for English advised me.
(c) For opting English many people advised me against.
(d) For English many people advised me against opung.`;

describe("structureOcrText", () => {
  test("builds rearrangement questions when the margin numbers were not read", () => {
    const questions = structureOcrText(rearrangement, 0);

    expect(questions.map((question) => question.number)).toEqual(["1", "2", "3", "4"]);
    expect(questions.every((question) => question.type === "mcq")).toBe(true);
    expect(questions[0]?.stem).toBe("he/the books/held on to/passionately");
    expect(questions[0]?.options.map((option) => option.key)).toEqual(["A", "B", "C", "D"]);
    expect(questions[0]?.options[3]?.text).toBe("The books held on to he passionately");
    expect(questions[0]?.instructions).toContain("DIRECTIONS (1-5)");
    expect(questions[2]?.stem).toBe(
      "the police/indiscriminately/sprayed/on the protestors/tear gas",
    );
    expect(questions[2]?.options[0]?.text).toContain("protestors");
    expect(questions[2]?.options[1]?.text).toContain("indiscriminately");
    expect(questions[3]?.options).toHaveLength(4);
  });

  test("a directions header stays with the questions it introduces", () => {
    const questions = structureOcrText(
      [
        "Section A",
        "20. Living in a fool's paradise",
        "(a) To believe wrongly that your situation is good",
        "(b) To be fooled by someone",
        "(c) To live in luxuriously after fooling someone",
        "(d) To live in a world of imagination",
        "DIRECTIONS (21-25): Choose the word which best expresses",
        "the meaning of the given words.",
        "21. Timid",
        "(a) bold",
        "(b) shy",
        "(c) angry",
        "(d) proud",
        "25. Huge",
        "(a) tiny",
        "(b) vast",
        "(c) slow",
        "(d) kind",
        "26. Next",
        "(a) one",
        "(b) two",
        "(c) three",
        "(d) four",
      ].join("\n"),
      11,
    );

    const question20 = questions.find((question) => question.number === "20");
    const question21 = questions.find((question) => question.number === "21");
    const question25 = questions.find((question) => question.number === "25");
    const question26 = questions.find((question) => question.number === "26");

    expect(question20?.options.map((option) => option.text)).toEqual([
      "To believe wrongly that your situation is good",
      "To be fooled by someone",
      "To live in luxuriously after fooling someone",
      "To live in a world of imagination",
    ]);
    expect(question20?.instructions).toBe("Section A");
    expect(question21?.stem).toBe("Timid");
    expect(question21?.instructions).toContain("DIRECTIONS (21-25)");
    expect(question21?.instructions).toContain("the meaning of the given words.");
    expect(question25?.instructions).toBe(question21?.instructions);
    expect(question26?.instructions).toBe("Section A");
    expect(question26?.stem).toBe("Next");
  });

  test("a later question number does not strip directions from an earlier number read afterwards", () => {
    const questions = structureOcrText(
      [
        "Section A",
        "DIRECTIONS (21-25): Choose the word which best expresses",
        "the meaning of the given words.",
        "26. Next",
        "(a) one",
        "(b) two",
        "22. Bold",
        "(a) brave",
        "(b) shy",
        "21. Timid",
        "(a) bold",
        "(b) shy",
      ].join("\n"),
      11,
    );

    const question21 = questions.find((question) => question.number === "21");
    const question22 = questions.find((question) => question.number === "22");
    const question26 = questions.find((question) => question.number === "26");

    expect(question26?.instructions).toBe("Section A");
    expect(question21?.instructions).toContain("DIRECTIONS (21-25)");
    expect(question22?.instructions).toBe(question21?.instructions);
    expect(question21?.stem).toBe("Timid");
    expect(question22?.stem).toBe("Bold");
  });

  test("a directions header glued onto the last option is not part of that option", () => {
    const questions = structureOcrText(
      "20. Living in a fool's paradise (a) good (b) fooled (c) luxury (d) To live in a world of imagination DIRECTIONS (21-25): Choose the word. 21. Timid (a) bold (b) shy",
      11,
    );

    const question20 = questions.find((question) => question.number === "20");
    const question21 = questions.find((question) => question.number === "21");
    expect(question20?.options[3]?.text).toBe("To live in a world of imagination");
    expect(question20?.instructions ?? "").not.toContain("DIRECTIONS");
    expect(question21?.stem).toBe("Timid");
    expect(question21?.instructions).toContain("DIRECTIONS (21-25)");
    expect(question21?.options.map((option) => option.text)).toEqual(["bold", "shy"]);
  });

  test("a stem after a choice row starts the next question when its number was missed", () => {
    const questions = structureOcrText(
      [
        "86. ______ is the smallest bone in the human body.",
        "(a) Rib cage (b) Scapula",
        "(c) Stapes (d) Coxal bone",
        "The world's largest lake is ______.",
        "(a) Baikal Lake (b) Lake Victoria",
        "(c) Dead Sea (d) Caspian Sea",
      ].join("\n"),
      40,
    );

    expect(questions.map((question) => question.number)).toEqual(["86", null]);
    expect(questions[0]?.options.map((option) => option.text)).toEqual([
      "Rib cage",
      "Scapula",
      "Stapes",
      "Coxal bone",
    ]);
    expect(questions[1]?.stem).toBe("The world's largest lake is ____.");
    expect(questions[1]?.options.map((option) => option.key)).toEqual(["A", "B", "C", "D"]);
    expect(questions[1]?.options.map((option) => option.text)).toEqual([
      "Baikal Lake",
      "Lake Victoria",
      "Dead Sea",
      "Caspian Sea",
    ]);
  });

  test("still splits a numbered question", () => {
    const questions = structureOcrText(
      "1. The cat sat on the mat.\n(a) chair (b) mat (c) tree (d) sky",
      0,
    );
    expect(questions[0]?.stem).toBe("The cat sat on the mat.");
    expect(questions[0]?.options.map((option) => option.key)).toEqual(["A", "B", "C", "D"]);
  });

  test("text mode keeps an unnumbered choice question", () => {
    const questions = cleanPage({
      pageText: rearrangement,
      page: 0,
      mode: "text",
      lines: [],
      regions: [],
      reader: { reader_id: "openocr", reader_version: "test" },
    });
    expect(questions).toHaveLength(4);
    expect(questions[0]?.figures).toEqual([]);
  });
});
