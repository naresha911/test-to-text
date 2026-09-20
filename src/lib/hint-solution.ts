import type { Question } from "@/lib/question-schema";

export type HintSolutionResult = {
  hint: string | null;
  explanation: string | null;
  answer_keys: string[];
  answer_text: string | null;
  answer_boolean: boolean | null;
  options: { key: string; text: string; is_correct: boolean | null }[];
  blanks: string[];
  match_pairs: { left: string; right: string }[];
};

/** Merge AI output into a question without clobbering reviewer-owned stem/options text. */
export function applyHintSolution(
  question: Question,
  result: HintSolutionResult,
  force: boolean,
): Question {
  const fill = <T,>(current: T, next: T, empty: (v: T) => boolean): T =>
    force || empty(current) ? next : current;

  const nextOptions =
    result.options.length === question.options.length
      ? question.options.map((option, index) => {
          const generated = result.options[index]!;
          return {
            ...option,
            is_correct: fill(option.is_correct ?? null, generated.is_correct, (v) => v == null),
          };
        })
      : question.options;

  return {
    ...question,
    hint: fill(question.hint ?? null, result.hint, (v) => !v?.trim()),
    explanation: fill(question.explanation ?? null, result.explanation, (v) => !v?.trim()),
    answer_keys: fill(question.answer_keys, result.answer_keys, (v) => !v.length),
    answer_text: fill(question.answer_text ?? null, result.answer_text, (v) => !v?.trim()),
    answer_boolean: fill(question.answer_boolean ?? null, result.answer_boolean, (v) => v == null),
    blanks:
      question.blanks.length && result.blanks.length
        ? question.blanks.map((blank, index) =>
            fill(blank, result.blanks[index] ?? "", (v) => !v.trim()),
          )
        : fill(question.blanks, result.blanks, (v) => !v.length || v.every((b) => !b.trim())),
    match_pairs:
      question.match_pairs.length && result.match_pairs.length
        ? question.match_pairs.map((pair, index) => ({
            left: pair.left,
            right: fill(pair.right, result.match_pairs[index]?.right ?? "", (v) => !v.trim()),
          }))
        : question.match_pairs,
    options: nextOptions,
  };
}
