/**
 * File name for one page image.
 * The page id is part of the name so a later upload cannot overwrite a page
 * that is still in the paper. Numbering files by how many pages exist does
 * that after a page is deleted, because the remaining rows keep their old names.
 */
export function pageImageFilePath(documentId: string, pageId: string): string {
  return `${documentId}/page-${pageId}.jpg`;
}

export type PageFileRow = {
  id: string;
  page_index: number;
  file_path: string;
};

/**
 * Pages that no longer have their own photo.
 * After a delete, the next upload used to reuse `page-N.jpg`. The last page
 * to use that name still has the pixels. Every earlier page pointing at the
 * same file lost its image.
 */
export function pagesWithLostImage(pages: readonly PageFileRow[]): PageFileRow[] {
  const byPath = new Map<string, PageFileRow[]>();
  for (const page of pages) {
    const group = byPath.get(page.file_path) ?? [];
    group.push(page);
    byPath.set(page.file_path, group);
  }

  const lost: PageFileRow[] = [];
  for (const group of byPath.values()) {
    if (group.length < 2) continue;
    const keeper = group.reduce((best, page) => (page.page_index > best.page_index ? page : best));
    for (const page of group) {
      if (page.id !== keeper.id) lost.push(page);
    }
  }
  return lost;
}
