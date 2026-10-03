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
 * A forced read adds the new questions. Questions already recognized stay until the user deletes them.
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
 * Add a fresh read beside questions already on the paper.
 * Nothing already recognized is removed. The user deletes a question with its delete button.
 */
export function addReadQuestions(
  questions: readonly Question[],
  incoming: readonly Question[],
): Question[] {
  return [...questions, ...incoming];
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
