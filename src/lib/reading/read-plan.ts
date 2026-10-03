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
   * Selected pages in this set are read again even when they were read before.
   * An empty selection still means unread pages only. A page in this set that
   * is not selected is left out.
   */
  forceIds?: ReadonlySet<string>;
};

export function isPageRead(page: PageReadTarget): boolean {
  return page.ocr_status === "done";
}

/**
 * Choose which pages this Read pages click should OCR.
 * A selection limits the click to those pages. An empty selection means every unread page.
 * Pages already marked read are skipped, unless that page is selected and listed in `forceIds`.
 * A forced read replaces the questions already stored for that page.
 */
export function planPageRead<T extends PageReadTarget>(
  pages: readonly T[],
  selectedIds: ReadonlySet<string>,
  options?: ReadPlanOptions,
): ReadPlan<T> {
  const usedAllUnread = selectedIds.size === 0;
  const candidates = usedAllUnread ? pages : pages.filter((page) => selectedIds.has(page.id));

  const toRead: T[] = [];
  const skippedRead: T[] = [];
  const missingImage: T[] = [];

  for (const page of candidates) {
    const forced = !usedAllUnread && (options?.forceIds?.has(page.id) ?? false);
    if (isPageRead(page) && !forced) {
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
 * Replace questions stored for one page with a fresh read.
 * Questions on other pages, and questions with no page, stay.
 */
export function replacePageQuestions(
  questions: readonly Question[],
  incoming: readonly Question[],
  pageIndex: number,
): Question[] {
  const kept = questions.filter((question) => question.page !== pageIndex);
  return [...kept, ...incoming];
}

function shiftPage(page: number | null | undefined, removedIndex: number): number | null {
  if (page == null || page < removedIndex) return page ?? null;
  if (page === removedIndex) return null;
  return page - 1;
}

/**
 * Close the gap in later page numbers after a page image is removed.
 * Questions that were read from that page stay, with no page image attached.
 */
export function reindexQuestionsAfterPageRemoval(
  questions: readonly Question[],
  removedIndex: number,
): Question[] {
  return questions.map((question) => ({
    ...question,
    page: shiftPage(question.page, removedIndex),
    figures: question.figures.map((figure) => ({
      ...figure,
      page: shiftPage(figure.page, removedIndex),
    })),
    sub_questions: reindexQuestionsAfterPageRemoval(question.sub_questions, removedIndex),
  }));
}
