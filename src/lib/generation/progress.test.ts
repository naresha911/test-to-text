import { describe, expect, test } from "bun:test";

import type { MockGenerationState } from "@/lib/document-types";
import { emptyGenerationItem, type GenerationItem } from "@/lib/generation/job-types";
import { summarizeGeneration } from "@/lib/generation/progress";

function state(partial: Partial<MockGenerationState>): MockGenerationState {
  return {
    mode: "from_instructions",
    status: "in_progress",
    instructions: null,
    planned_count: 4,
    source_question_ids: [],
    cursor: 0,
    last_error: null,
    pairs: [],
    ...partial,
  };
}

function item(sequence: number, status: GenerationItem["status"]): GenerationItem {
  return { ...emptyGenerationItem({ jobId: "job", sequence }), status };
}

describe("summarizeGeneration", () => {
  test("falls back to the cursor when items are absent", () => {
    const summary = summarizeGeneration(state({ cursor: 2 }), 5);
    expect(summary.total).toBe(5);
    expect(summary.done).toBe(2);
    expect(summary.percent).toBe(40);
    expect(summary.currentNumber).toBe(3);
    expect(summary.pending).toBe(3);
  });

  test("counts item statuses", () => {
    const summary = summarizeGeneration(
      state({
        cursor: 2,
        items: [
          item(0, "completed"),
          item(1, "needs_review"),
          item(2, "pending"),
          item(3, "failed"),
        ],
      }),
      4,
    );
    expect(summary.done).toBe(2);
    expect(summary.needsReview).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.percent).toBe(50);
  });

  test("any running item marks the job running", () => {
    expect(summarizeGeneration(state({ status: "pending", items: [item(0, "running")] }), 3).running).toBe(
      true,
    );
  });

  test("a zero total never divides by zero", () => {
    const summary = summarizeGeneration(state({ cursor: 0 }), 0);
    expect(summary.percent).toBe(0);
    expect(summary.currentNumber).toBe(0);
  });

  test("a missing generation is all zeros", () => {
    const summary = summarizeGeneration(null, 0);
    expect(summary.total).toBe(0);
    expect(summary.done).toBe(0);
    expect(summary.percent).toBe(0);
  });

  test("currentNumber clamps to the total", () => {
    expect(summarizeGeneration(state({ cursor: 9 }), 4).currentNumber).toBe(4);
  });
});
