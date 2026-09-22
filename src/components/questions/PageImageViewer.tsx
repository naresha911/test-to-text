import { Hand, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

export type PageImage = {
  id: string;
  pageIndex: number;
  dataUrl?: string | undefined;
};

type Props = {
  pages: PageImage[];
  className?: string | undefined;
};

export function PageImageViewer({ pages, className }: Props) {
  const [zoom, setZoom] = useState(1);
  const [panMode, setPanMode] = useState(true);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const clampZoom = useCallback((value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)), []);

  const zoomIn = () => setZoom((current) => clampZoom(Number((current + ZOOM_STEP).toFixed(2))));
  const zoomOut = () => setZoom((current) => clampZoom(Number((current - ZOOM_STEP).toFixed(2))));
  const fit = () => {
    setZoom(1);
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panMode || event.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport || drag.pointerId !== event.pointerId) return;
    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    viewport.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((current) => clampZoom(Number((current + delta).toFixed(2))));
  };

  if (!pages.length) {
    return (
      <div
        className={cn(
          "flex h-full min-h-[240px] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        <p>Page images appear here after you add them.</p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-secondary/40 px-2 py-1.5">
        <span className="mr-auto text-xs font-medium text-muted-foreground">Page image</span>
        <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={zoomOut} aria-label="Zoom out">
          <ZoomOut className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={zoomIn} aria-label="Zoom in">
          <ZoomIn className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={panMode ? "default" : "outline"}
          className="h-8"
          aria-pressed={panMode}
          onClick={() => setPanMode((current) => !current)}
        >
          <Hand className="h-4 w-4" aria-hidden="true" />
          Pan
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={fit} aria-label="Fit page">
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
          Fit
        </Button>
      </div>

      <div
        ref={viewportRef}
        className={cn(
          "min-h-0 flex-1 overflow-auto bg-secondary/20",
          panMode ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
        role="region"
        aria-label="Scrollable page images"
      >
        <div className="space-y-4 p-3">
          {pages.map((page) => (
            <figure key={page.id} className="space-y-1">
              <figcaption className="text-xs text-muted-foreground">Page {page.pageIndex + 1}</figcaption>
              {page.dataUrl ? (
                <img
                  src={page.dataUrl}
                  alt={`Original uploaded question paper page ${page.pageIndex + 1}`}
                  className="block max-w-none rounded border border-border bg-background object-contain select-none"
                  style={{ width: `${zoom * 100}%` }}
                  draggable={false}
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded border border-dashed border-border text-sm text-muted-foreground">
                  Page {page.pageIndex + 1} image unavailable
                </div>
              )}
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
