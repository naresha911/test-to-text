import type { Question } from "@/lib/question-schema";

/** A page Read pages can consider. Read means a successful OCR was saved. */
export type PageReadTarget = {
  id: string;
  ocr_status: string;
  dataUrl?: string;
};

export type ReadPlan<T extends PageReadTarget> = {
  /** Unread pages that have an image and should be sent to OCR. */
  toRead: T[];
  /** Already-read pages in the candidate set. They are not sent to OCR. */
  skippedRead: T[];
  /** Unread candidates with no image. */
  missingImage: T[];
  /** True when nothing was selected, so every page was a candidate. */
  usedAllUnread: boolean;
};

export function isPageRead(page: PageReadTarget): boolean {
  return page.ocr_status === "done";
}

/**
 * Choose which pages this Read pages click should OCR.
 * A selection limits the click to those pages. An empty selection means every unread page.
 * Pages already marked read are never included.
 */
export function planPageRead<T extends PageReadTarget>(
  pages: readonly T[],
  selectedIds: ReadonlySet<string>,
): ReadPlan<T> {
  const usedAllUnread = selectedIds.size === 0;
  const candidates = usedAllUnread ? pages : pages.filter((page) => selectedIds.has(page.id));

  const toRead: T[] = [];
  const skippedRead: T[] = [];
  const missingImage: T[] = [];

  for (const page of candidates) {
    if (isPageRead(page)) {
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
