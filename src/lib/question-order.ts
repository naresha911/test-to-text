import type { Question } from "@/lib/question-schema";

/** Parse a printed number like "12", "12a", "Q. 3" into a sortable integer. */
export function parseQuestionOrder(number: string | null | undefined): number {
  if (!number) return Number.POSITIVE_INFINITY;
  const match = number.trim().match(/(\d+)/);
  return match ? Number.parseInt(match[1]!, 10) : Number.POSITIVE_INFINITY;
}

export function sortQuestions(list: Question[]): Question[] {
  return [...list].sort((a, b) => {
    const na = parseQuestionOrder(a.number);
    const nb = parseQuestionOrder(b.number);
    if (na !== nb) return na - nb;
    const label = (a.number ?? "").localeCompare(b.number ?? "", undefined, { numeric: true });
    if (label !== 0) return label;
    const page = (a.page ?? 0) - (b.page ?? 0);
    if (page !== 0) return page;
    return (a.confidence ?? 0) - (b.confidence ?? 0);
  });
}
