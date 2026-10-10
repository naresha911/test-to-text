import { CheckCircle2, ChevronDown, Loader2, MoveDiagonal, Trash2, XCircle } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  AI_GENERATION_KIND_LABELS,
  clearAiGenerationLog,
  getAiGenerationLog,
  type AiGenerationKind,
  type AiGenerationRecord,
} from "@/lib/ai-generation-log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GenerationRunEntry, GenerationStatus } from "@/hooks/useSolutionGeneration";
import { cn } from "@/lib/utils";

type GenerationDialogSize = { width: number; height: number };

const MIN_DIALOG_WIDTH = 360;
const MIN_DIALOG_HEIGHT = 280;
/** Distance kept between the dialog and the viewport edges when clamping. */
const VIEWPORT_MARGIN = 24;
const DEFAULT_DIALOG_SIZE: GenerationDialogSize = { width: 576, height: 480 };

/**
 * TanStack Start compiles app and server-fn code into separate module
 * instances, so anchor the remembered dialog size on `globalThis` (same
 * pattern as the AI generation log store) to share one value across them.
 * In-memory only — a full page reload resets to the default size.
 */
const globalScope = globalThis as unknown as {
  __generationDialogSize?: { size: GenerationDialogSize | null };
};

function getStoredDialogSize(): GenerationDialogSize | null {
  const size = globalScope.__generationDialogSize?.size;
  if (!size || typeof size.width !== "number" || typeof size.height !== "number") {
    return null;
  }
  // Copy so the rendered size never aliases the shared store object.
  return { width: size.width, height: size.height };
}

function setStoredDialogSize(size: GenerationDialogSize): void {
  globalScope.__generationDialogSize = { size: { width: size.width, height: size.height } };
}

/**
 * Clamps a size to the viewport. The upper bounds are widened to at least the
 * minimums so a tiny viewport (`innerWidth < MIN_DIALOG_WIDTH + VIEWPORT_MARGIN`,
 * e.g. a narrow devtools pane) can never invert the range and produce a zero or
 * negative size.
 */
function clampDialogSize(width: number, height: number): GenerationDialogSize {
  if (typeof window === "undefined") {
    return { width, height };
  }
  const maxWidth = Math.max(MIN_DIALOG_WIDTH, window.innerWidth - VIEWPORT_MARGIN);
  const maxHeight = Math.max(MIN_DIALOG_HEIGHT, window.innerHeight - VIEWPORT_MARGIN);
  return {
    width: Math.min(Math.max(width, MIN_DIALOG_WIDTH), maxWidth),
    height: Math.min(Math.max(height, MIN_DIALOG_HEIGHT), maxHeight),
  };
}

function getDefaultDialogSize(): GenerationDialogSize {
  if (typeof window === "undefined") {
    return DEFAULT_DIALOG_SIZE;
  }
  return clampDialogSize(
    DEFAULT_DIALOG_SIZE.width,
    Math.round(Math.min(560, window.innerHeight * 0.7)),
  );
}

const STATUS_LABEL: Record<GenerationRunEntry["status"], string> = {
  queued: "Queued",
  generating: "Generating",
  success: "Done",
  failed: "Failed",
  skipped: "Skipped",
  superseded: "Superseded",
};

function SolutionStatusBadge({ status }: { status: GenerationRunEntry["status"] }) {
  if (status === "generating") {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Generating
      </Badge>
    );
  }
  return (
    <Badge
      variant={
        status === "success"
          ? "default"
          : status === "failed"
            ? "destructive"
            : status === "queued"
              ? "secondary"
              : "outline"
      }
      className={cn(status === "superseded" && "text-muted-foreground")}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function RecordStatusBadge({ status }: { status: AiGenerationRecord["status"] }) {
  if (status === "running") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-600">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Running
      </Badge>
    );
  }
  return (
    <Badge variant={status === "success" ? "default" : "destructive"}>
      {status === "success" ? "Success" : "Failed"}
    </Badge>
  );
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

const PRE_CLASS =
  "max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed";

function RecordDetail({ record }: { record: AiGenerationRecord }) {
  return (
    <div className="space-y-2 border-t border-border px-2 py-2">
      <div>
        <p className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Input
        </p>
        <pre className={PRE_CLASS}>{record.input || "—"}</pre>
      </div>
      <div>
        <p className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Output
        </p>
        <pre className={cn(PRE_CLASS, record.status === "failed" && "text-destructive")}>
          {record.status === "failed" && record.error ? record.error : record.output || "—"}
        </pre>
      </div>
    </div>
  );
}

function AiGenerationConsole() {
  const runGetLog = useServerFn(getAiGenerationLog);
  const runClearLog = useServerFn(clearAiGenerationLog);
  const [records, setRecords] = useState<AiGenerationRecord[]>([]);
  const [filter, setFilter] = useState<"all" | AiGenerationKind>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void runGetLog()
        .then((log) => {
          if (!cancelled) return;
          setRecords(log);
          setFetchError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          setFetchError(error instanceof Error ? error.message : String(error));
        });
    };
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runGetLog]);

  const kinds = [...new Set(records.map((record) => record.kind))];
  const visible = filter === "all" ? records : records.filter((record) => record.kind === filter);
  const newestFirst = [...visible].reverse();
  const running = records.filter((record) => record.status === "running").length;
  const failed = records.filter((record) => record.status === "failed").length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {records.length} call{records.length === 1 ? "" : "s"}
          {running > 0 ? ` · ${running} running` : ""}
          {failed > 0 ? ` · ${failed} failed` : ""}
          {" · "}updates every 1.5s
        </p>
        <select
          aria-label="Filter by generation kind"
          className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
          value={filter}
          onChange={(event) => setFilter(event.target.value as "all" | AiGenerationKind)}
        >
          <option value="all">All kinds</option>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {AI_GENERATION_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => {
            void runGetLog().then(
              (log) => {
                setRecords(log);
                setFetchError(null);
              },
              (error) => setFetchError(error instanceof Error ? error.message : String(error)),
            );
          }}
        >
          Refresh
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => {
            void runClearLog({ data: true }).then(
              () => {
                setRecords([]);
                setExpandedId(null);
                toast.success("AI generation log cleared.");
              },
              () => toast.error("Could not clear the AI generation log."),
            );
          }}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Clear
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
        <div className="p-2">
          {fetchError ? (
            <p className="px-1 py-2 text-xs text-destructive">Log fetch failed: {fetchError}</p>
          ) : null}
          {newestFirst.length === 0 && !fetchError ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              No AI generations recorded yet. Runs are kept in memory until the server restarts.
            </p>
          ) : null}
          {newestFirst.map((record) => (
            <div key={record.id} className="mb-1 overflow-hidden rounded-md border border-border">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1.5 text-left text-xs"
                onClick={() =>
                  setExpandedId((current) => (current === record.id ? null : record.id))
                }
                aria-expanded={expandedId === record.id}
              >
                <RecordStatusBadge status={record.status} />
                <Badge variant="secondary">{AI_GENERATION_KIND_LABELS[record.kind]}</Badge>
                <span className="font-medium">{record.label || record.provider}</span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {record.provider} · {record.model}
                </span>
                {record.durationMs != null ? (
                  <span className="tabular-nums text-muted-foreground">
                    {formatDuration(record.durationMs)}
                  </span>
                ) : null}
                {record.error && record.status === "failed" ? (
                  <span className="min-w-24 flex-1 truncate text-destructive" title={record.error}>
                    {record.error}
                  </span>
                ) : null}
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {formatClock(record.startedAt)}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground transition-transform",
                    expandedId === record.id && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </button>
              {expandedId === record.id ? <RecordDetail record={record} /> : null}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export function GenerationProgressControl({
  status,
  onClear,
}: {
  status: GenerationStatus;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<GenerationDialogSize>(() => {
    const initial = getStoredDialogSize() ?? getDefaultDialogSize();
    // Re-clamp on mount: the viewport may be smaller than when the size was stored.
    return clampDialogSize(initial.width, initial.height);
  });

  const resizeDrag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const updateSize = (width: number, height: number) => {
    const next = clampDialogSize(width, height);
    setSize(next);
    setStoredDialogSize(next);
  };

  // Shrinking the viewport (window resize, rotated device) must not leave the
  // dialog wider or taller than the window — re-clamp so the content and the
  // resize handle stay reachable. The remembered size is deliberately left
  // untouched, so growing the window back restores the dialog on the next open.
  useEffect(() => {
    const handleViewportResize = () => {
      setSize((current) => {
        const next = clampDialogSize(current.width, current.height);
        // Keep the same reference when nothing changed so resize storms (which
        // still fit) do not re-render the dialog.
        return next.width === current.width && next.height === current.height ? current : next;
      });
    };
    window.addEventListener("resize", handleViewportResize);
    return () => window.removeEventListener("resize", handleViewportResize);
  }, []);

  const total = status.pending + status.finished + status.failed;
  const settled = status.finished + status.failed;
  const percent = total > 0 ? Math.round((settled / total) * 100) : 100;

  const headline =
    status.state === "active"
      ? status.running
        ? `Q${status.running.number ?? "?"} generating`
        : "Starting generation…"
      : status.failed > 0
        ? `${status.finished} done · ${status.failed} failed`
        : status.finished > 0
          ? `${status.finished} done`
          : "AI log";

  const entries = [...status.entries].reverse();

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Only the primary button/contact should start a resize (otherwise e.g. a
    // right-click drag resizes the dialog).
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: size.width,
      startHeight: size.height,
    };
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current;
    // Ignore other pointers (multi-touch) and moves that arrive without an
    // active drag.
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateSize(
      drag.startWidth + (event.clientX - drag.startX),
      drag.startHeight + (event.clientY - drag.startY),
    );
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resizeDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // Safety net: if capture is lost without pointerup/pointercancel (element
  // detached, browser gesture takeover) clear the stale drag so a later hover
  // does not keep resizing.
  const handleResizeLostPointerCapture = () => {
    resizeDrag.current = null;
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    switch (event.key) {
      case "ArrowLeft":
        updateSize(size.width - step, size.height);
        break;
      case "ArrowRight":
        updateSize(size.width + step, size.height);
        break;
      case "ArrowUp":
        updateSize(size.width, size.height - step);
        break;
      case "ArrowDown":
        updateSize(size.width, size.height + step);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={status.state === "active" ? "default" : "outline"}
        className="h-7 px-2.5"
        onClick={() => setOpen(true)}
        title="Open AI generation console"
      >
        {status.state === "active" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : status.failed > 0 ? (
          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span className="tabular-nums">{headline}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex max-h-none max-w-none flex-col overflow-hidden"
          style={{ width: size.width, height: size.height }}
        >
          <DialogHeader>
            <DialogTitle>AI generation</DialogTitle>
            <DialogDescription>
              Every AI call the server makes — model, input prompt and raw output — plus the hint
              &amp; solution queue.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <Tabs defaultValue="queue" className="flex h-full min-h-0 flex-col">
              <TabsList className="self-start">
                <TabsTrigger value="queue">Queue</TabsTrigger>
                <TabsTrigger value="log">AI generation log</TabsTrigger>
              </TabsList>

              <TabsContent value="queue" className="flex min-h-0 flex-1 flex-col">
                {status.entries.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    No hint &amp; solution generations yet. Approve questions to queue them.
                  </p>
                ) : (
                  <section
                    className="flex h-full min-h-0 flex-col gap-2"
                    aria-label="Hint and solution queue"
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {settled} of {total}
                      </span>
                      <Progress
                        className="flex-1"
                        value={percent}
                        aria-label="AI generation progress"
                      />
                      <span className="tabular-nums">{percent}%</span>
                    </div>
                    <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
                      <div className="p-2">
                        {entries.map((entry) => (
                          <div
                            key={`${entry.questionId}-${entry.epoch}`}
                            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border py-1.5 text-xs last:border-b-0"
                          >
                            <SolutionStatusBadge status={entry.status} />
                            <span className="font-medium">Q{entry.number ?? "?"}</span>
                            {entry.targets > 1 ? (
                              <span className="tabular-nums text-muted-foreground">
                                {entry.completedTargets}/{entry.targets} targets
                              </span>
                            ) : null}
                            {entry.startedAt != null && entry.finishedAt != null ? (
                              <span className="tabular-nums text-muted-foreground">
                                {formatDuration(entry.finishedAt - entry.startedAt)}
                              </span>
                            ) : null}
                            {entry.force ? (
                              <span className="text-muted-foreground">forced</span>
                            ) : null}
                            {entry.error ? (
                              <span
                                className="min-w-40 flex-1 truncate text-destructive"
                                title={entry.error}
                              >
                                {entry.error}
                              </span>
                            ) : null}
                            <span className="ml-auto tabular-nums text-muted-foreground">
                              {formatClock(entry.queuedAt)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={onClear}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Clear queue
                      </Button>
                    </div>
                  </section>
                )}
              </TabsContent>

              <TabsContent value="log" className="flex min-h-0 flex-1 flex-col">
                <AiGenerationConsole />
              </TabsContent>
            </Tabs>
          </div>

          <div
            role="separator"
            aria-label="Resize dialog"
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onLostPointerCapture={handleResizeLostPointerCapture}
            onKeyDown={handleResizeKeyDown}
            className="absolute bottom-1 right-1 flex h-6 w-6 cursor-nwse-resize touch-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Drag to resize"
          >
            <MoveDiagonal className="h-4 w-4" aria-hidden="true" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
