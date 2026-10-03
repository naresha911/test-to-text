import { describe, expect, test } from "bun:test";

import {
  mergeIncoming,
  noteDirtyKeys,
  overlayDirty,
  questionFamilyBusy,
} from "@/components/questions/use-question-draft";
import { emptyQuestion, updateQuestionById } from "@/lib/question-schema";

describe("question drafts", () => {
  test("a stem edit keeps a hint that arrived while typing", () => {
    const base = emptyQuestion({ id: "a", stem: "old", hint: null });
    const latest = { ...base, hint: "from the model" };
    const local = { ...base, stem: "typed" };
    const dirty = new Set<keyof typeof base>();
    noteDirtyKeys(base, local, dirty);
    const next = overlayDirty(latest, local, dirty);
    expect(next.stem).toBe("typed");
    expect(next.hint).toBe("from the model");
  });

  test("an incoming question replaces the draft when nothing is pending", () => {
    const local = emptyQuestion({ id: "a", stem: "local" });
    const incoming = { ...local, stem: "saved", hint: "ready" };
    expect(mergeIncoming(incoming, local, new Set()).hint).toBe("ready");
  });

  test("family busy includes sub-questions", () => {
    const child = emptyQuestion({ id: "child" });
    const parent = emptyQuestion({ id: "parent", sub_questions: [child] });
    expect(questionFamilyBusy(parent, new Set(["child"]))).toBe(true);
    expect(questionFamilyBusy(parent, new Set(["other"]))).toBe(false);
  });
});

describe("updateQuestionById", () => {
  test("does not clone comprehension questions that were not edited", () => {
    const other = emptyQuestion({
      id: "c",
      sub_questions: [emptyQuestion({ id: "c1" })],
    });
    const target = emptyQuestion({ id: "a", stem: "old" });
    const list = [other, target];
    const next = updateQuestionById(list, "a", (question) => ({ ...question, stem: "new" }));
    expect(next[0]).toBe(other);
    expect(next[1]?.stem).toBe("new");
    expect(next).not.toBe(list);
  });

  test("returns the same list when the id is absent", () => {
    const list = [emptyQuestion({ id: "a" })];
    expect(updateQuestionById(list, "missing", (question) => ({ ...question, stem: "x" }))).toBe(
      list,
    );
  });
});
