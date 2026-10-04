import { solveChecked } from "@/lib/generation/checked/registry";

/** Solve a checked question locally. Null means the exam-chat path should run. */
export function localCheckedSolution(question: {
  math_spec?: Record<string, unknown> | null;
  stem?: string | null;
}): { hint: string; explanation: string; answerText: string } | null {
  const spec = question.math_spec;
  if (!spec) return null;
  const answerText = solveChecked(spec);
  if (!answerText) return null;
  const stated = `The answer is ${answerText}.`;
  const stem = question.stem?.trim();
  return {
    hint: stated,
    explanation: stem ? `${stem} ${stated}` : stated,
    answerText,
  };
}
