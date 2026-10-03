import { PageImageToolbar, type PageReadActivity } from "@/components/questions/PageImageToolbar";
import type { ContentMode } from "@/lib/reading/mode";

export type PageImage = {
  id: string;
  pageIndex: number;
  dataUrl?: string | undefined;
  read: boolean;
  contentMode: ContentMode;
  activity: PageReadActivity;
};

type Props = {
  page: PageImage;
  onContentModeChange: (id: string, mode: ContentMode) => void;
  onRead: (id: string) => void;
  onRemove: (id: string) => void;
};

export function PageImageCard({ page, onContentModeChange, onRead, onRemove }: Props) {
  const pageNumber = page.pageIndex + 1;

  return (
    <article className="space-y-1.5" data-page-number={pageNumber}>
      <PageImageToolbar
        pageNumber={pageNumber}
        contentMode={page.contentMode}
        read={page.read}
        activity={page.activity}
        onContentModeChange={(mode) => onContentModeChange(page.id, mode)}
        onRead={() => onRead(page.id)}
        onRemove={() => onRemove(page.id)}
      />
      {page.dataUrl ? (
        <img
          src={page.dataUrl}
          alt={`Original uploaded question paper page ${pageNumber}`}
          draggable={false}
          className="block h-auto max-w-none rounded border border-border bg-background object-contain select-none"
          style={{ width: "100%" }}
        />
      ) : (
        <div className="flex h-40 items-center justify-center rounded border border-dashed border-border text-sm text-muted-foreground">
          Page {pageNumber} image unavailable
        </div>
      )}
    </article>
  );
}
