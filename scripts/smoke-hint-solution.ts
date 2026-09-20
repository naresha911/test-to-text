/**
 * Smoke tests for hint/solution context + merge helpers (no network).
 * Run: npx --yes tsx scripts/smoke-hint-solution.ts
 */
import { applyHintSolution } from "../src/lib/hint-solution";
import {
  buildQuestionPromptPayload,
  needsHintOrSolution,
  targetsForHintSolution,
} from "../src/lib/question-context";
import { emptyQuestion, updateQuestionById } from "../src/lib/question-schema";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const mcq = emptyQuestion({
  id: "mcq-1",
  type: "mcq",
  stem: "What is $2+2$?",
  options: [
    { key: "A", text: "3", is_correct: null },
    { key: "B", text: "4", is_correct: null },
  ],
});

const payload = buildQuestionPromptPayload(mcq, {
  audience: { subject: "Maths", exam: "Class 6" },
});
assert(payload.includes("What is $2+2$?"), "MCQ stem in payload");
assert(payload.includes("A. 3"), "MCQ options in payload");
assert(payload.includes("Subject: Maths"), "audience subject in payload");

const comprehension = emptyQuestion({
  id: "comp-1",
  type: "comprehension",
  stem: "Read the passage",
  passage: "The river Nile is long.",
  sub_questions: [
    emptyQuestion({
      id: "sub-1",
      type: "mcq",
      stem: "Which river is mentioned?",
      options: [{ key: "A", text: "Nile", is_correct: null }],
    }),
    emptyQuestion({
      id: "sub-2",
      type: "short_answer",
      stem: "Name one fact.",
      hint: "already",
      explanation: "already solved",
    }),
  ],
});

const targets = targetsForHintSolution(comprehension);
assert(targets.length === 2, "comprehension yields sub targets");
assert(targets[0]?.parentPassage === "The river Nile is long.", "passage passed to sub");
const subPayload = buildQuestionPromptPayload(targets[0]!.question, {
  parentPassage: targets[0]!.parentPassage,
});
assert(subPayload.includes("Shared passage"), "passage labelled");
assert(subPayload.includes("The river Nile is long."), "passage text present");

assert(needsHintOrSolution(comprehension) === true, "needs generation when a sub is missing");
assert(needsHintOrSolution(comprehension.sub_questions[1]!) === false, "complete sub needs nothing");

const assertion = emptyQuestion({
  id: "ar-1",
  type: "assertion_reason",
  assertion: "Ice floats on water.",
  reason: "Ice is denser than water.",
  options: [{ key: "A", text: "Both true, R explains A", is_correct: null }],
});
const arPayload = buildQuestionPromptPayload(assertion);
assert(arPayload.includes("Assertion:"), "assertion block");
assert(arPayload.includes("Reason:"), "reason block");

const merged = applyHintSolution(
  mcq,
  {
    hint: "Think about addition.",
    explanation: "$$2+2=4$$. Final answer: B",
    answer_keys: ["B"],
    answer_text: null,
    answer_boolean: null,
    options: [
      { key: "A", text: "SHOULD_NOT_OVERWRITE", is_correct: false },
      { key: "B", text: "SHOULD_NOT_OVERWRITE", is_correct: true },
    ],
    blanks: [],
    match_pairs: [],
  },
  false,
);
assert(merged.hint === "Think about addition.", "hint applied");
assert(merged.explanation?.includes("Final answer"), "explanation applied");
assert(merged.options[0]?.text === "3", "option text not overwritten");
assert(merged.options[1]?.is_correct === true, "correctness filled");
assert(merged.answer_keys[0] === "B", "answer key filled");

const withPrinted = applyHintSolution(
  { ...mcq, explanation: "Printed solution", hint: "Printed hint" },
  {
    hint: "AI hint",
    explanation: "AI solution",
    answer_keys: ["A"],
    answer_text: null,
    answer_boolean: null,
    options: mcq.options.map((o) => ({ ...o, is_correct: null })),
    blanks: [],
    match_pairs: [],
  },
  false,
);
assert(withPrinted.hint === "Printed hint", "does not overwrite existing hint");
assert(withPrinted.explanation === "Printed solution", "does not overwrite existing solution");

const forced = applyHintSolution(
  { ...mcq, explanation: "Printed solution", hint: "Printed hint" },
  {
    hint: "AI hint",
    explanation: "AI solution",
    answer_keys: [],
    answer_text: null,
    answer_boolean: null,
    options: [],
    blanks: [],
    match_pairs: [],
  },
  true,
);
assert(forced.hint === "AI hint", "force overwrites hint");
assert(forced.explanation === "AI solution", "force overwrites solution");

const tree = updateQuestionById([comprehension], "sub-1", (q) => ({
  ...q,
  hint: "nested hint",
}));
assert(tree[0]?.sub_questions[0]?.hint === "nested hint", "nested update works");

console.log("smoke-hint-solution: all checks passed");
