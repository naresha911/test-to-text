import { describe, expect, test } from "bun:test";

import { pageImageFilePath, pagesWithLostImage } from "@/lib/page-image-path";

describe("pageImageFilePath", () => {
  test("two pages never share a file, even when one was removed", () => {
    const documentId = "doc";
    const kept = pageImageFilePath(documentId, "page-kept");
    const added = pageImageFilePath(documentId, "page-added");

    expect(added).not.toBe(kept);
    expect(added.endsWith(".jpg")).toBe(true);
  });

  test("an older page that shares a file has lost its photo", () => {
    const shared = "doc/page-7.jpg";
    const lost = pagesWithLostImage([
      { id: "older", page_index: 5, file_path: shared },
      { id: "newer", page_index: 6, file_path: shared },
      { id: "other", page_index: 0, file_path: "doc/page-1.jpg" },
    ]);

    expect(lost.map((page) => page.id)).toEqual(["older"]);
  });
});