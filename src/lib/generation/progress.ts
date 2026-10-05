import type { MockGenerationState } from "@/lib/document-types";

export type GenerationProgressSummary = {
  /** Planned question count. */
  total: number;
  /** Questions finished (completed or awaiting review). */
  done: number;
  /** A question is being generated right now. */
  running: boolean;
  /** 1-based number of the question being generated, clamped to total. */
  currentNumber: number;
  pending: number;
  needsReview: number;
  failed: number;
  /** Rounded 0..100 completion. */
  percent: number;
};

/**
 * Summarise a mock generation job for the progress panel.
 * Falls back to the persisted cursor when per-question items are not present yet.
 */
export function summarizeGeneration(
  generation: MockGenerationState | null | undefined,
  total: number,
): GenerationProgressSummary {
  const safeTotal = Math.max(0, Math.floor(total));
  const items = generation?.items ?? [];
  const cursor = generation?.cursor ?? 0;

  let completed = 0;
  let needsReview = 0;
  let failed = 0;
  let pending = 0;
  let running = false;
  for (const item of items) {
    if (item.status === "completed") completed += 1;
    else if (item.status === "needs_review") needsReview += 1;
    else if (item.status === "failed") failed += 1;
    else if (item.status === "pending") pending += 1;
    if (item.status === "running") running = true;
  }

  const done = items.length ? completed + needsReview : Math.min(cursor, safeTotal);
  const percent = safeTotal > 0 ? Math.min(100, Math.floor((done / safeTotal) * 100)) : 0;
  const currentNumber = safeTotal > 0 ? Math.min(cursor + 1, safeTotal) : 0;

  return {
    total: safeTotal,
    done,
    running: running || generation?.status === "in_progress",
    currentNumber,
    pending: items.length ? pending : Math.max(0, safeTotal - done),
    needsReview,
    failed,
    percent,
  };
}
