import { describe, expect, test } from "bun:test";

import {
  createSolutionQueue,
  foldGeneratedQuestions,
  generateForApprovedQuestion,
} from "@/lib/hint-solution-client";
import type { HintSolutionResult } from "@/lib/hint-solution";
import {
  buildSolutionUserPrompt,
  missingAnswerIds,
  needsHintOrSolution,
  questionHasAnswer,
  SOLUTION_SYSTEM_PROMPT,
} from "@/lib/question-context";
import { emptyQuestion } from "@/lib/question-schema";

function modelResult(partial: Partial<HintSolutionResult> = {}): HintSolutionResult {
  return {
    hint: "Add the ones.",
    explanation: "Two plus two is four.",
    answer_keys: [],
    answer_text: null,
    answer_boolean: null,
    options: [],
    blanks: [],
    match_pairs: [],
    ...partial,
  };
}

describe("question answers", () => {
  test("a multiple choice question needs a key or a correct option", () => {
    const bare = emptyQuestion({
      type: "mcq",
      options: [{ key: "A", text: "4", is_correct: null }],
    });
    expect(questionHasAnswer(bare)).toBe(false);
    expect(
      questionHasAnswer({
        ...bare,
        options: [{ key: "A", text: "4", is_correct: true }],
      }),
    ).toBe(true);
    expect(questionHasAnswer({ ...bare, answer_keys: ["A"] })).toBe(true);
  });

  test("other types use their own answer field", () => {
    expect(questionHasAnswer(emptyQuestion({ type: "true_false", answer_boolean: false }))).toBe(
      true,
    );
    expect(questionHasAnswer(emptyQuestion({ type: "numerical" }))).toBe(false);
    expect(questionHasAnswer(emptyQuestion({ type: "numerical", answer_text: "4" }))).toBe(true);
    expect(
      questionHasAnswer(
        emptyQuestion({
          type: "match_the_following",
          match_pairs: [{ left: "1", right: "" }],
        }),
      ),
    ).toBe(false);
  });

  test("a hint without a right answer still needs a solution pass", () => {
    const question = emptyQuestion({
      type: "mcq",
      stem: "2+2",
      hint: "Add",
      explanation: "Work it out",
      options: [{ key: "A", text: "4" }],
    });
    expect(needsHintOrSolution(question)).toBe(true);
    expect(missingAnswerIds(question)).toEqual([question.id]);
  });
});

describe("solution prompt", () => {
  test("the user message includes the question, options, passage, and exam", () => {
    const prompt = buildSolutionUserPrompt(
      emptyQuestion({
        type: "mcq",
        number: "3",
        stem: "What is 2 + 2?",
        options: [
          { key: "A", text: "4" },
          { key: "B", text: "5" },
        ],
      }),
      { parentPassage: "A short passage about numbers.", audience: { exam: "Class 6" } },
    );
    expect(prompt).toContain("Generate hint and solution");
    expect(prompt).toContain("What is 2 + 2?");
    expect(prompt).toContain("A. 4");
    expect(prompt).toContain("A short passage about numbers.");
    expect(prompt).toContain("Class 6");
    expect(SOLUTION_SYSTEM_PROMPT).toContain("Return ONLY JSON");
  });
});

describe("folding a solution", () => {
  test("leaves the question unapproved when the model finds no right answer", () => {
    const question = emptyQuestion({
      id: "q",
      type: "mcq",
      stem: "2+2",
      approved: true,
      options: [
        { key: "A", text: "4" },
        { key: "B", text: "5" },
      ],
    });
    const folded = foldGeneratedQuestions(
      [question],
      "q",
      [{ questionId: "q", result: modelResult() }],
      false,
      true,
    );
    expect(folded.answersFound).toBe(false);
    expect(folded.questions[0]?.approved).toBe(false);
    expect(folded.questions[0]?.hint).toBe("Add the ones.");
    expect(folded.missingIds).toEqual(["q"]);
  });

  test("approves only after a right answer is present", () => {
    const question = emptyQuestion({
      id: "q",
      type: "short_answer",
      stem: "Name the capital",
      approved: false,
    });
    const folded = foldGeneratedQuestions(
      [question],
      "q",
      [{ questionId: "q", result: modelResult({ answer_text: "Delhi" }) }],
      false,
      true,
    );
    expect(folded.answersFound).toBe(true);
    expect(folded.questions[0]?.approved).toBe(true);
    expect(folded.questions[0]?.answer_text).toBe("Delhi");
  });

  test("keeps a sibling edit made while the request was running", () => {
    const target = emptyQuestion({ id: "a", type: "numerical", stem: "2+2" });
    const sibling = emptyQuestion({ id: "b", stem: "edited while waiting" });
    const folded = foldGeneratedQuestions(
      [target, sibling],
      "a",
      [{ questionId: "a", result: modelResult({ answer_text: "4" }) }],
      false,
      true,
    );
    expect(folded.questions.map((question) => question.stem)).toEqual([
      "2+2",
      "edited while waiting",
    ]);
  });

  test("a passage set stays unapproved when one sub-question has no answer", () => {
    const parent = emptyQuestion({
      id: "p",
      type: "comprehension",
      passage: "Once",
      approved: true,
      sub_questions: [
        emptyQuestion({ id: "s1", type: "short_answer", stem: "Who?", answer_text: "Ana" }),
        emptyQuestion({ id: "s2", type: "short_answer", stem: "Why?" }),
      ],
    });
    const folded = foldGeneratedQuestions(
      [parent],
      "p",
      [{ questionId: "s2", result: modelResult() }],
      false,
      true,
    );
    expect(folded.answersFound).toBe(false);
    expect(folded.questions[0]?.approved).toBe(false);
    expect(folded.missingIds).toEqual(["s2"]);
  });
});

describe("generateForApprovedQuestion", () => {
  test("asks again when a hint exists but the right answer does not", async () => {
    let calls = 0;
    const question = emptyQuestion({
      id: "q",
      type: "mcq",
      stem: "2+2",
      hint: "Add",
      explanation: "Work it out",
      options: [{ key: "A", text: "4" }],
    });
    const result = await generateForApprovedQuestion({
      questions: [question],
      questionId: "q",
      runGenerate: async () => {
        calls += 1;
        return modelResult({
          answer_keys: ["A"],
          options: [{ key: "A", text: "4", is_correct: true }],
        });
      },
    });
    expect(calls).toBe(1);
    expect(result.error).toBeNull();
    expect(result.generated).toHaveLength(1);
  });

  test("sends a custom prompt for that question and the passage for each sub-question", async () => {
    const seen: Array<{ id: string; prompt?: string; passage: string | null }> = [];
    const parent = emptyQuestion({
      id: "p",
      type: "comprehension",
      passage: "Once upon a time",
      sub_questions: [
        emptyQuestion({
          id: "s1",
          type: "mcq",
          stem: "Who?",
          options: [{ key: "A", text: "Ana" }],
        }),
        emptyQuestion({ id: "s2", type: "short_answer", stem: "Why?" }),
      ],
    });
    await generateForApprovedQuestion({
      questions: [parent],
      questionId: "p",
      userPrompt: "ONLY FOR PARENT",
      promptFor: (id) => (id === "s2" ? "Custom why prompt" : undefined),
      runGenerate: async ({ data }) => {
        seen.push({
          id: data.question.id,
          ...(data.userPrompt ? { prompt: data.userPrompt } : {}),
          passage: data.parentPassage ?? null,
        });
        return data.question.id === "s2"
          ? modelResult({ answer_text: "Because" })
          : modelResult({
              answer_keys: ["A"],
              options: [{ key: "A", text: "Ana", is_correct: true }],
            });
      },
    });
    expect(seen).toEqual([
      { id: "s1", passage: "Once upon a time" },
      { id: "s2", prompt: "Custom why prompt", passage: "Once upon a time" },
    ]);
  });

  test("reports a model failure without dropping an earlier sub-question", async () => {
    const parent = emptyQuestion({
      id: "p",
      type: "comprehension",
      passage: "Text",
      sub_questions: [
        emptyQuestion({ id: "s1", type: "short_answer", stem: "One" }),
        emptyQuestion({ id: "s2", type: "short_answer", stem: "Two" }),
      ],
    });
    const result = await generateForApprovedQuestion({
      questions: [parent],
      questionId: "p",
      runGenerate: async ({ data }) => {
        if (data.question.id === "s2") throw new Error("rate limited");
        return modelResult({ answer_text: "First" });
      },
    });
    expect(result.error).toBe("rate limited");
    expect(result.generated.map((item) => item.questionId)).toEqual(["s1"]);
  });
});

describe("solution queue", () => {
  test("runs one request at a time, in the order they were approved", async () => {
    const queue = createSolutionQueue();
    const order: string[] = [];
    const first = queue(async () => {
      order.push("start-1");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("end-1");
    });
    const second = queue(async () => {
      order.push("start-2");
      order.push("end-2");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });
});
