import { useCallback, useEffect, useRef, useState } from "react";

import type { Question } from "@/lib/question-schema";

/** Text stays local until blur or this delay. Structural edits publish immediately. */
export const DRAFT_DEBOUNCE_MS = 280;

const IMMEDIATE = new Set<keyof Question>([
  "figures",
  "number",
  "page",
  "type",
  "sub_questions",
  "source_block",
]);

export function noteDirtyKeys(previous: Question, next: Question, dirty: Set<keyof Question>): void {
  const seen = new Set<keyof Question>();
  for (const key of Object.keys(next) as (keyof Question)[]) {
    seen.add(key);
    if (key === "id") continue;
    if (!Object.is(previous[key], next[key])) dirty.add(key);
  }
  for (const key of Object.keys(previous) as (keyof Question)[]) {
    if (seen.has(key) || key === "id") continue;
    dirty.add(key);
  }
}

/** Copy locally edited fields onto the latest saved question, leaving other fields alone. */
export function overlayDirty(
  latest: Question,
  local: Question,
  dirty: ReadonlySet<keyof Question>,
): Question {
  let next = latest;
  for (const key of dirty) {
    if (!Object.is(latest[key], local[key])) next = { ...next, [key]: local[key] };
  }
  return next;
}

export function mergeIncoming(
  incoming: Question,
  local: Question,
  dirty: ReadonlySet<keyof Question>,
): Question {
  if (dirty.size === 0) return incoming;
  return overlayDirty(incoming, local, dirty);
}

export function shouldFlushNow(dirty: ReadonlySet<keyof Question>): boolean {
  for (const key of dirty) {
    if (IMMEDIATE.has(key)) return true;
  }
  return false;
}

/** True when this question or one of its sub-questions is in the set. */
export function questionFamilyBusy(question: Question, ids: Set<string> | undefined): boolean {
  if (!ids || ids.size === 0) return false;
  if (ids.has(question.id)) return true;
  return question.sub_questions.some((sub) => questionFamilyBusy(sub, ids));
}

/**
 * Question text is edited here. The parent list updates on blur or after a short pause,
 * so one keystroke does not re-render every other card.
 */
export function useQuestionDraft(
  question: Question,
  onChange: ((next: Question) => void) | undefined,
) {
  const [draft, setDraft] = useState(question);
  const draftRef = useRef(question);
  const latestRef = useRef(question);
  const dirtyRef = useRef(new Set<keyof Question>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  latestRef.current = question;

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const dirty = dirtyRef.current;
    if (dirty.size === 0 || !onChangeRef.current) return;
    const next = overlayDirty(latestRef.current, draftRef.current, dirty);
    dirty.clear();
    if (next !== latestRef.current) onChangeRef.current(next);
  }, []);

  const update = useCallback(
    (next: Question) => {
      noteDirtyKeys(draftRef.current, next, dirtyRef.current);
      draftRef.current = next;
      setDraft(next);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (shouldFlushNow(dirtyRef.current)) flush();
      else timerRef.current = setTimeout(flush, DRAFT_DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(() => {
    const merged = mergeIncoming(question, draftRef.current, dirtyRef.current);
    if (merged === draftRef.current) return;
    draftRef.current = merged;
    setDraft(merged);
  }, [question]);

  useEffect(() => () => flush(), [flush]);

  return { draft, draftRef, update, flush };
}
