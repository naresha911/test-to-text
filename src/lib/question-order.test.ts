import { describe, expect, test } from "bun:test";

import { sortMockPairs, sortQuestions, suggestNextQuestionNumber } from "@/lib/question-order";
import { createManualQuestion, emptyQuestion } from "@/lib/question-schema";

describe("question order", () => {
  test("cards sort by printed question number, not insertion order", () => {
    const questions = [
      emptyQuestion({ id: "c", number: "10" }),
      emptyQuestion({ id: "a", number: "2" }),
      emptyQuestion({ id: "b", number: "2a" }),
      emptyQuestion({ id: "d", number: null }),
    ];
    expect(sortQuestions(questions).map((question) => question.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("a new question number lands between its neighbors", () => {
    const existing = [
      emptyQuestion({ id: "1", number: "1" }),
      emptyQuestion({ id: "2", number: "2" }),
      emptyQuestion({ id: "4", number: "4" }),
    ];
    const created = createManualQuestion({ number: "3", type: "short_answer" });
    const ordered = sortQuestions([...existing, created]);
    expect(ordered.map((question) => question.number)).toEqual(["1", "2", "3", "4"]);
    expect(created.options).toEqual([]);
    expect(created.stem).toBe("");
  });

  test("the suggested number is one past the highest printed number", () => {
    expect(
      suggestNextQuestionNumber([
        emptyQuestion({ number: "4" }),
        emptyQuestion({ number: "12b" }),
      ]),
    ).toBe("13");
    expect(suggestNextQuestionNumber([])).toBe("1");
  });

  test("mock pairs follow the mock question numbers", () => {
    const questions = [
      emptyQuestion({ id: "m2", number: "2" }),
      emptyQuestion({ id: "m1", number: "1" }),
    ];
    const pairs = sortMockPairs(
      [
        { source_question_id: "s2", mock_question_id: "m2" },
        { source_question_id: null, mock_question_id: "m1" },
      ],
      questions,
    );
    expect(pairs.map((pair) => pair.mock_question_id)).toEqual(["m1", "m2"]);
  });
});
