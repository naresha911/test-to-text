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
