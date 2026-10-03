import type { Question } from "@/lib/question-schema";

/** A page Read pages can consider. Read means a successful OCR was saved. */
export type PageReadTarget = {
  id: string;
  ocr_status: string;
  dataUrl?: string;
};

export type ReadPlan<T extends PageReadTarget> = {
  /** Pages that have an image and should be sent to OCR. */
  toRead: T[];
  /** Already-read pages in the candidate set. They are not sent to OCR. */
  skippedRead: T[];
  /** Candidates with no image. */
  missingImage: T[];
  /** True when nothing was selected, so every page was a candidate. */
  usedAllUnread: boolean;
};

export type ReadPlanOptions = {
  /**
   * Read selected pages again even when they were read before.
   * An empty selection still means unread pages only.
   */
  force?: boolean;
};

export function isPageRead(page: PageReadTarget): boolean {
  return page.ocr_status === "done";
}

/**
 * Choose which pages this Read pages click should OCR.
 * A selection limits the click to those pages. An empty selection means every unread page.
 * Pages already marked read are skipped, unless Force read is on and those pages are selected.
 * A forced read replaces that page's previous questions when the new read finds questions.
 */
export function planPageRead<T extends PageReadTarget>(
  pages: readonly T[],
  selectedIds: ReadonlySet<string>,
  options?: ReadPlanOptions,
): ReadPlan<T> {
  const force = options?.force === true;
  const usedAllUnread = selectedIds.size === 0;
  const candidates = usedAllUnread ? pages : pages.filter((page) => selectedIds.has(page.id));

  const toRead: T[] = [];
  const skippedRead: T[] = [];
  const missingImage: T[] = [];

  for (const page of candidates) {
    if (isPageRead(page) && !(force && !usedAllUnread)) {
      skippedRead.push(page);
      continue;
    }
    if (!page.dataUrl) {
      missingImage.push(page);
      continue;
    }
    toRead.push(page);
  }

  return { toRead, skippedRead, missingImage, usedAllUnread };
}

/**
 * Swap in a fresh read of one page. Questions from other pages, and manual
 * questions with no page, stay. A retry then replaces instead of duplicating.
 */
export function replaceQuestionsForPage(
  questions: readonly Question[],
  pageIndex: number,
  incoming: readonly Question[],
): Question[] {
  return [...questions.filter((question) => question.page !== pageIndex), ...incoming];
}

function shiftPage(page: number | null | undefined, removedIndex: number): number | null {
  if (page == null || page < removedIndex) return page ?? null;
  if (page === removedIndex) return null;
  return page - 1;
}

/**
 * Drop questions that were read from the removed page, and close the gap in
 * later page numbers. A question with no page was typed by hand and stays.
 */
export function reindexQuestionsAfterPageRemoval(
  questions: readonly Question[],
  removedIndex: number,
): Question[] {
  return questions.flatMap((question) => {
    if (question.page === removedIndex) return [];
    return [
      {
        ...question,
        page: shiftPage(question.page, removedIndex),
        figures: question.figures.map((figure) => ({
          ...figure,
          page: shiftPage(figure.page, removedIndex),
        })),
        sub_questions: reindexQuestionsAfterPageRemoval(question.sub_questions, removedIndex),
      },
    ];
  });
}
