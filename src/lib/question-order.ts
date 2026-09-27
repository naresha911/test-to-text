import type { Question } from "@/lib/question-schema";

/** Parse a printed number like "12", "12a", "Q. 3" into a sortable integer. */
export function parseQuestionOrder(number: string | null | undefined): number {
  if (!number) return Number.POSITIVE_INFINITY;
  const match = number.trim().match(/(\d+)/);
  return match ? Number.parseInt(match[1]!, 10) : Number.POSITIVE_INFINITY;
}

function compareQuestions(a: Question, b: Question): number {
  const na = parseQuestionOrder(a.number);
  const nb = parseQuestionOrder(b.number);
  if (na !== nb) return na - nb;
  const label = (a.number ?? "").localeCompare(b.number ?? "", undefined, { numeric: true });
  if (label !== 0) return label;
  const page = (a.page ?? 0) - (b.page ?? 0);
  if (page !== 0) return page;
  return (a.confidence ?? 0) - (b.confidence ?? 0);
}

/** Question cards and exports follow printed question numbers, including nested parts. */
export function sortQuestions(list: Question[]): Question[] {
  return [...list]
    .map((question) =>
      question.sub_questions.length
        ? { ...question, sub_questions: sortQuestions(question.sub_questions) }
        : question,
    )
    .sort(compareQuestions);
}

/** Next integer label after the highest printed question number, or "1" when none exist. */
export function suggestNextQuestionNumber(list: Question[]): string {
  let max = 0;
  for (const question of list) {
    const value = parseQuestionOrder(question.number);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return String(max + 1);
}

/** Keep mock/source pairs in the same order as the mock question numbers. */
export function sortMockPairs<T extends { mock_question_id: string }>(
  pairs: T[],
  questions: Question[],
): T[] {
  const rank = new Map<string, number>();
  sortQuestions(questions).forEach((question, index) => rank.set(question.id, index));
  return [...pairs].sort(
    (a, b) =>
      (rank.get(a.mock_question_id) ?? Number.POSITIVE_INFINITY) -
      (rank.get(b.mock_question_id) ?? Number.POSITIVE_INFINITY),
  );
}
