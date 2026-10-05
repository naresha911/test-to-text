import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { MockGenerationState } from "@/lib/document-types";
import { summarizeGeneration } from "@/lib/generation/progress";

/** Live progress of an AI mock generation job. Presentational only. */
export function GenerationProgress({
  generation,
  total,
  generating,
}: {
  generation: MockGenerationState | null;
  total: number;
  generating: boolean;
}) {
  const summary = summarizeGeneration(generation, total);
  if (summary.total <= 0) return null;

  const headline = generating
    ? `Generating question ${summary.currentNumber} of ${summary.total}…`
    : summary.done >= summary.total
      ? `${summary.total} question${summary.total === 1 ? "" : "s"} ready`
      : `${summary.done} of ${summary.total} questions ready — generation paused`;

  return (
    <div className="rounded-xl border border-border bg-card p-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {generating ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
        <span className="font-medium">{headline}</span>
        <span className="ml-auto text-muted-foreground">{summary.percent}%</span>
      </div>

      <Progress
        className="mt-3"
        value={summary.percent}
        aria-label="AI question generation progress"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">{summary.done} ready</Badge>
        {summary.needsReview > 0 ? (
          <Badge variant="secondary">{summary.needsReview} to review</Badge>
        ) : null}
        {summary.failed > 0 ? <Badge variant="destructive">{summary.failed} failed</Badge> : null}
        {summary.pending > 0 ? <Badge variant="secondary">{summary.pending} pending</Badge> : null}
      </div>

      {generation?.last_error ? (
        <p className="mt-2 text-xs text-destructive">{generation.last_error}</p>
      ) : null}
    </div>
  );
}
