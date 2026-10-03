import { Loader2, X } from "lucide-react";

import type { ContentMode } from "@/lib/reading/mode";
import { cn } from "@/lib/utils";

const MODES = [
  ["text", "Text", "Words only. Diagrams are not cropped."],
  ["graphics", "Graphics", "Words, plus diagram crops."],
] as const satisfies ReadonlyArray<readonly [ContentMode, string, string]>;

export type PageReadActivity = "idle" | "queued" | "reading";

type Props = {
  pageNumber: number;
  contentMode: ContentMode;
  read: boolean;
  activity: PageReadActivity;
  onContentModeChange: (mode: ContentMode) => void;
  onRead: () => void;
  onRemove: () => void;
};

export function PageImageToolbar({
  pageNumber,
  contentMode,
  read,
  activity,
  onContentModeChange,
  onRead,
  onRemove,
}: Props) {
  const busy = activity !== "idle";
  const status = activity === "reading" ? "Reading" : activity === "queued" ? "Queued" : read ? "Read" : "Not read";

  return (
    <header
      data-page-toolbar=""
      className="cursor-auto rounded-md border border-border bg-card px-2 py-1.5 text-xs"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-medium text-foreground">Page {pageNumber}</span>
        <span
          className={cn(
            "shrink-0 rounded-full border border-border px-1.5 py-0.5",
            activity === "reading" || read
              ? "text-foreground"
              : "text-muted-foreground",
          )}
        >
          {activity === "reading" ? (
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden="true" />
          ) : null}
          {status}
        </span>
        <button
          type="button"
          disabled={activity === "reading"}
          aria-label={`Remove page ${pageNumber} from the viewer`}
          onClick={onRemove}
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div
          className="inline-flex overflow-hidden rounded-md border border-border"
          role="group"
          aria-label={`What page ${pageNumber} contains`}
        >
          {MODES.map(([mode, label, hint]) => (
            <button
              key={mode}
              type="button"
              title={hint}
              aria-pressed={contentMode === mode}
              disabled={busy}
              onClick={() => onContentModeChange(mode)}
              className={cn(
                "px-2 py-1 disabled:opacity-50",
                contentMode === mode
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onRead}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-medium text-primary hover:bg-secondary disabled:text-muted-foreground"
        >
          {activity === "reading" ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : null}
          {activity === "reading" ? "Reading…" : activity === "queued" ? "Queued" : "Read page"}
        </button>
      </div>
    </header>
  );
}
