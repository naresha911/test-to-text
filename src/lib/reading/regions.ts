import type { ReaderBlock } from "@/lib/reader/types";

/** PP-DocLayout labels that are diagrams. Text, titles, headers, and captions are not. */
const FIGURE_LABELS = new Set(["image", "chart", "figure"]);
const TABLE_LABELS = new Set(["table"]);

export type LayoutDetection = {
  label: string;
  score: number;
  /** [x1, y1, x2, y2] in pixels of the page image. */
  box: [number, number, number, number];
};

/** Keep diagram and table regions. Drop printed text and page furniture. */
export function toGraphicBlocks(
  detections: LayoutDetection[],
  size: { width: number; height: number },
): ReaderBlock[] {
  const width = size.width || 1;
  const height = size.height || 1;
  const blocks: ReaderBlock[] = [];

  for (const detection of detections) {
    const label = detection.label.trim().toLowerCase().replace(/\s+/g, "_");
    const type = FIGURE_LABELS.has(label) ? "figure" : TABLE_LABELS.has(label) ? "table" : null;
    if (!type) continue;
    const [x1, y1, x2, y2] = detection.box;
    const left = clamp01(Math.min(x1, x2) / width);
    const top = clamp01(Math.min(y1, y2) / height);
    const boxWidth = clamp01(Math.abs(x2 - x1) / width);
    const boxHeight = clamp01(Math.abs(y2 - y1) / height);
    if (boxWidth <= 0 || boxHeight <= 0) continue;
    blocks.push({
      id: `fig-${blocks.length + 1}`,
      type,
      text: null,
      latex: null,
      bbox: [
        round(left),
        round(top),
        round(Math.min(boxWidth, 1 - left)),
        round(Math.min(boxHeight, 1 - top)),
      ],
      confidence: detection.score,
    });
  }

  return blocks;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
