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
  filePath: string;
  contentMode: ContentMode;
  read: boolean;
  activity: PageReadActivity;
  onContentModeChange: (mode: ContentMode) => void;
  onRead: () => void;
  onRemove: () => void;
};

export function PageImageToolbar({
  pageNumber,
  filePath,
  contentMode,
  read,
  activity,
  onContentModeChange,
  onRead,
  onRemove,
}: Props) {
  const busy = activity !== "idle";

  return (
    <header
      data-page-toolbar=""
      className="flex cursor-auto items-center gap-2 px-0.5 text-xs"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="shrink-0 font-medium text-foreground">Page {pageNumber}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={filePath}>
        {filePath}
      </span>
      <div
        className="flex shrink-0 items-center"
        role="group"
        aria-label={`What page ${pageNumber} contains`}
      >
        {MODES.map(([mode, label, hint], index) => (
          <button
            key={mode}
            type="button"
            title={hint}
            aria-pressed={contentMode === mode}
            disabled={busy}
            onClick={() => onContentModeChange(mode)}
            className={cn(
              "px-1.5 py-0.5 disabled:opacity-50",
              index === 0 && "border-r border-border",
              contentMode === mode
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <span className={cn("shrink-0", read ? "text-foreground" : "text-muted-foreground")}>
        {read ? "Read" : "Not read"}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onRead}
        className="inline-flex shrink-0 items-center gap-1 px-1 py-0.5 font-medium text-primary disabled:text-muted-foreground"
      >
        {activity === "reading" ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : null}
        {activity === "reading" ? "Reading…" : activity === "queued" ? "Queued" : "Read page"}
      </button>
      <button
        type="button"
        disabled={activity === "reading"}
        aria-label={`Remove page ${pageNumber} from the viewer`}
        onClick={onRemove}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </header>
  );
}
