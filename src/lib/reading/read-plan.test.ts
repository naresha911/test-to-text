import { describe, expect, test } from "bun:test";

import { emptyQuestion } from "@/lib/question-schema";
import {
  planPageRead,
  reindexQuestionsAfterPageRemoval,
  replaceQuestionsForPage,
  type PageReadTarget,
} from "@/lib/reading/read-plan";

function page(
  id: string,
  ocr_status: string,
  options?: { image?: boolean },
): PageReadTarget & { page_index: number } {
  return {
    id,
    page_index: Number(id.replace("p", "")) - 1,
    ocr_status,
    ...(options?.image === false ? {} : { dataUrl: `data:image/png;base64,${id}` }),
  };
}

describe("planPageRead", () => {
  const pages = [
    page("p1", "done"),
    page("p2", "pending"),
    page("p3", "done"),
    page("p4", "pending"),
  ];

  test("an empty selection reads only unread pages", () => {
    const plan = planPageRead(pages, new Set());

    expect(plan.usedAllUnread).toBe(true);
    expect(plan.toRead.map((item) => item.id)).toEqual(["p2", "p4"]);
    expect(plan.skippedRead.map((item) => item.id)).toEqual(["p1", "p3"]);
    expect(plan.missingImage).toEqual([]);
  });

  test("a selection skips read pages and ignores unselected unread pages", () => {
    const plan = planPageRead(pages, new Set(["p1", "p2"]));

    expect(plan.usedAllUnread).toBe(false);
    expect(plan.toRead.map((item) => item.id)).toEqual(["p2"]);
    expect(plan.skippedRead.map((item) => item.id)).toEqual(["p1"]);
  });

  test("a selection of only read pages reads nothing", () => {
    const plan = planPageRead(pages, new Set(["p1", "p3"]));

    expect(plan.toRead).toEqual([]);
    expect(plan.skippedRead.map((item) => item.id)).toEqual(["p1", "p3"]);
    expect(plan.usedAllUnread).toBe(false);
  });

  test("an unread page with no image is not sent to OCR", () => {
    const plan = planPageRead(
      [page("p1", "pending", { image: false }), page("p2", "pending")],
      new Set(["p1"]),
    );

    expect(plan.toRead).toEqual([]);
    expect(plan.missingImage.map((item) => item.id)).toEqual(["p1"]);
  });

  test("force read includes selected pages that were already read", () => {
    const plan = planPageRead(pages, new Set(["p1", "p2"]), { force: true });

    expect(plan.usedAllUnread).toBe(false);
    expect(plan.toRead.map((item) => item.id)).toEqual(["p1", "p2"]);
    expect(plan.skippedRead).toEqual([]);
  });

  test("force read of only already-read pages still reads them", () => {
    const plan = planPageRead(pages, new Set(["p1", "p3"]), { force: true });

    expect(plan.toRead.map((item) => item.id)).toEqual(["p1", "p3"]);
    expect(plan.skippedRead).toEqual([]);
  });

  test("force read with nothing selected still skips pages that were already read", () => {
    const plan = planPageRead(pages, new Set(), { force: true });

    expect(plan.usedAllUnread).toBe(true);
    expect(plan.toRead.map((item) => item.id)).toEqual(["p2", "p4"]);
    expect(plan.skippedRead.map((item) => item.id)).toEqual(["p1", "p3"]);
  });

  test("a selected read page with no image is not sent to OCR", () => {
    const plan = planPageRead([page("p1", "done", { image: false })], new Set(["p1"]), {
      force: true,
    });

    expect(plan.toRead).toEqual([]);
    expect(plan.missingImage.map((item) => item.id)).toEqual(["p1"]);
  });
});

describe("replaceQuestionsForPage", () => {
  test("replaces one page and keeps other pages and manual questions", () => {
    const manual = emptyQuestion({ id: "manual", page: null, stem: "typed" });
    const old = emptyQuestion({ id: "old", page: 0, stem: "first read" });
    const other = emptyQuestion({ id: "other", page: 1, stem: "page two" });
    const incoming = emptyQuestion({ id: "new", page: 0, stem: "second read" });

    const next = replaceQuestionsForPage([manual, old, other], 0, [incoming]);

    expect(next.map((question) => question.id)).toEqual(["manual", "other", "new"]);
  });
});

describe("reindexQuestionsAfterPageRemoval", () => {
  test("drops the removed page and keeps a handwritten question", () => {
    const manual = emptyQuestion({ id: "manual", page: null, stem: "typed" });
    const removed = emptyQuestion({ id: "old", page: 0, number: "164", stem: "old read" });
    const later = emptyQuestion({ id: "later", page: 1, stem: "next page" });

    const next = reindexQuestionsAfterPageRemoval([manual, removed, later], 0);

    expect(next.map((question) => question.id)).toEqual(["manual", "later"]);
    expect(next[1]?.page).toBe(0);
  });
});
