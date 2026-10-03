import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Question } from "@/lib/question-schema";
import { CROP_LAYOUT_OPTIONS, type CropLayout } from "@/lib/reading/crop-layout";
import type { ContentMode } from "@/lib/reading/mode";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  cropUrl: string;
  contentMode: ContentMode;
  onRun: (layout: CropLayout) => Promise<Question>;
  onReplace: (reading: Question) => void;
  preview: (reading: Question) => ReactNode;
};

export function QuestionCropDialog({
  open,
  onOpenChange,
  label,
  cropUrl,
  contentMode,
  onRun,
  onReplace,
  preview,
}: Props) {
  const [layout, setLayout] = useState<CropLayout>("parentheses");
  const [reading, setReading] = useState<Question | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = CROP_LAYOUT_OPTIONS.find((item) => item.id === layout) ?? CROP_LAYOUT_OPTIONS[0]!;

  useEffect(() => {
    if (!open) return;
    setReading(null);
    setError(null);
  }, [open, label]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setReading(await onRun(layout));
    } catch (caught) {
      setReading(null);
      setError(caught instanceof Error ? caught.message : "Could not read this crop.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Read {label}</DialogTitle>
          <DialogDescription>
            This is the printed question. Choose how it is arranged, then run OCR on this crop
            alone.
          </DialogDescription>
        </DialogHeader>

        <img
          src={cropUrl}
          alt={`Printed ${label} from the paper`}
          className="max-h-80 w-auto max-w-full rounded border border-border bg-secondary/40 object-contain"
        />

        <div className="space-y-1.5">
          <Label htmlFor="crop-layout">Layout</Label>
          <select
            id="crop-layout"
            value={layout}
            disabled={busy}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            onChange={(event) => {
              setLayout(event.target.value as CropLayout);
              setReading(null);
              setError(null);
            }}
          >
            {CROP_LAYOUT_OPTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <p className="text-sm text-muted-foreground">{selected.hint}</p>
          {contentMode === "graphics" && layout !== "equations" ? (
            <p className="text-sm text-muted-foreground">
              Graphics also looks for a diagram inside this crop.
            </p>
          ) : null}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {reading ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Identified question</p>
            {preview(reading)}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void run()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Run OCR
          </Button>
          <Button type="button" disabled={!reading || busy} onClick={() => reading && onReplace(reading)}>
            Replace question
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
