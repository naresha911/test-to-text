import { Hand, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { PageImageCard, type PageImage } from "@/components/questions/PageImageCard";
import { Button } from "@/components/ui/button";
import type { ContentMode } from "@/lib/reading/mode";
import { cn } from "@/lib/utils";

export type { PageImage };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

type Props = {
  pages: PageImage[];
  onContentModeChange: (id: string, mode: ContentMode) => void;
  onRead: (id: string) => void;
  onRemove: (id: string) => void;
  /** 1-based page nearest the top of the viewport, or null when there are no pages. */
  onVisiblePageChange?: ((pageNumber: number | null) => void) | undefined;
  className?: string | undefined;
};

export type PageImageViewerHandle = {
  /** Scroll a 1-based page to the top of the image pane. */
  scrollToPage: (pageNumber: number) => boolean;
};

export const PageImageViewer = memo(
  forwardRef<PageImageViewerHandle, Props>(function PageImageViewer(
{
  pages,
  onContentModeChange,
  onRead,
  onRemove,
  onVisiblePageChange,
  className,
},
ref,
) {
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
  const lastVisible = useRef<number | null>(null);

  const reportVisible = useCallback(() => {
    if (!onVisiblePageChange) return;
    const viewport = viewportRef.current;
    const cards = viewport?.querySelectorAll<HTMLElement>("[data-page-number]");
    if (!viewport || !cards?.length) {
      if (lastVisible.current !== null) {
        lastVisible.current = null;
        onVisiblePageChange(null);
      }
      return;
    }
    const viewTop = viewport.getBoundingClientRect().top;
    let bestPage = 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    cards.forEach((card) => {
      const page = Number(card.dataset.pageNumber);
      if (!Number.isFinite(page)) return;
      const distance = Math.abs(card.getBoundingClientRect().top - viewTop);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPage = page;
      }
    });
    if (lastVisible.current === bestPage) return;
    lastVisible.current = bestPage;
    onVisiblePageChange(bestPage);
  }, [onVisiblePageChange]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage(pageNumber: number) {
        const viewport = viewportRef.current;
        const card = viewport?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
        if (!viewport || !card) return false;
        const top =
          card.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
        viewport.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
        return true;
      },
    }),
    [],
  );

  useEffect(() => {
    reportVisible();
  }, [pages, reportVisible]);

  const clampZoom = useCallback((value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)), []);

  const zoomIn = () => setZoom((current) => clampZoom(Number((current + ZOOM_STEP).toFixed(2))));
  const zoomOut = () => setZoom((current) => clampZoom(Number((current - ZOOM_STEP).toFixed(2))));
  const fit = () => {
    setZoom(1);
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panMode || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest("[data-page-toolbar]")) return;
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
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
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
          "flex h-full min-h-0 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        <p>Page images appear here after you add them.</p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden", className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-secondary/40 px-2 py-1.5">
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
          "min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain bg-secondary/20",
          panMode ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
        onScroll={reportVisible}
        role="region"
        aria-label="Scrollable page images"
      >
        <div className="space-y-4 p-3" style={{ width: `${zoom * 100}%` }}>
          {pages.map((page) => (
            <PageImageCard
              key={page.id}
              page={page}
              onContentModeChange={onContentModeChange}
              onRead={onRead}
              onRemove={onRemove}
            />
          ))}
        </div>
      </div>
    </div>
  );
}),
);
