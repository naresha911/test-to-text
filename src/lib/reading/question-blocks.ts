import type { TextLineBox } from "@/lib/reader/parse-blocks";

export type QuestionBlock = {
  number: string;
  bbox: [number, number, number, number];
  lines: TextLineBox[];
};

type Box = [number, number, number, number];

const NUMBER_HEAD = /^\(?(\d{1,3})\s*[.)]\s+\S/;
/** A question number that OCR left on the same line as the previous question. */
const SWALLOWED = /^(.*?[^\d\s])\s+(\d{1,3})\s*[.)]\s+([A-Za-z"'(].*)$/;

/** Cut line boxes into question regions. Two x-clusters are read as two columns. */
export function segmentQuestionBlocks(lines: readonly TextLineBox[]): QuestionBlock[] {
  const usable = lines.filter((line) => line.text.trim() && line.bbox);
  const heads = usable.filter((line) => NUMBER_HEAD.test(line.text.trim()));
  if (!heads.length) return [];

  const columns = clusterColumns(heads);
  const boundsList = columnBoundList(columns);
  const blocks: QuestionBlock[] = [];
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const column = columns[columnIndex]!;
    const ordered = [...column].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
    const bounds = boundsList[columnIndex] ?? { left: 0, right: 1 };
    for (let index = 0; index < ordered.length; index += 1) {
      const head = ordered[index]!;
      const next = ordered[index + 1];
      const number = head.text.trim().match(NUMBER_HEAD)?.[1];
      if (!number) continue;
      const top = head.bbox[1];
      const bottom = next ? next.bbox[1] : columnBottom(usable, bounds, top);
      const bbox = normalBox(bounds.left, top, bounds.right - bounds.left, bottom - top);
      const blockLines = usable
        .filter((line) => lineInside(line, bbox))
        .sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
      if (!blockLines.includes(head)) blockLines.unshift(head);
      blocks.push({ number, bbox, lines: blockLines });
    }
  }
  return splitSwallowed(blocks);
}

function clusterColumns(heads: TextLineBox[]): TextLineBox[][] {
  const sorted = [...heads].sort((a, b) => a.bbox[0] - b.bbox[0]);
  if (sorted.length < 4) return [sorted];
  let bestGap = 0;
  let bestAt = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index]!.bbox[0] - sorted[index - 1]!.bbox[0];
    if (gap > bestGap) {
      bestGap = gap;
      bestAt = index;
    }
  }
  if (bestGap >= 0.18 && bestAt >= 2 && sorted.length - bestAt >= 2) {
    return [sorted.slice(0, bestAt), sorted.slice(bestAt)];
  }
  return [sorted];
}

function columnBoundList(columns: TextLineBox[][]): { left: number; right: number }[] {
  if (columns.length < 2) return [{ left: 0, right: 1 }];
  const left = columns[0] ?? [];
  const right = columns[1] ?? [];
  const leftEdge = Math.max(...left.map((line) => line.bbox[0] + line.bbox[2]), 0);
  const rightEdge = Math.min(...right.map((line) => line.bbox[0]), 1);
  const mid = clamp01((leftEdge + rightEdge) / 2);
  return [
    { left: 0, right: Math.max(mid, 0.2) },
    { left: Math.min(mid, 0.8), right: 1 },
  ];
}

function columnBottom(
  lines: readonly TextLineBox[],
  bounds: { left: number; right: number },
  top: number,
): number {
  let bottom = top + 0.08;
  for (const line of lines) {
    const center = line.bbox[0] + line.bbox[2] / 2;
    if (center < bounds.left || center >= bounds.right) continue;
    if (line.bbox[1] + 0.001 < top) continue;
    bottom = Math.max(bottom, line.bbox[1] + line.bbox[3]);
  }
  return Math.min(1, bottom + 0.015);
}

function lineInside(line: TextLineBox, bbox: Box): boolean {
  const centerX = line.bbox[0] + line.bbox[2] / 2;
  const centerY = line.bbox[1] + line.bbox[3] / 2;
  return (
    centerX >= bbox[0] - 0.001 &&
    centerX < bbox[0] + bbox[2] + 0.001 &&
    centerY >= bbox[1] - 0.001 &&
    centerY < bbox[1] + bbox[3] + 0.001
  );
}

function splitSwallowed(blocks: QuestionBlock[]): QuestionBlock[] {
  const result: QuestionBlock[] = [];
  for (const block of blocks) result.push(...splitOne(block));
  return result;
}

function splitOne(block: QuestionBlock): QuestionBlock[] {
  const splitAt = block.lines.findIndex((line, index) => {
    const match = line.text.trim().match(SWALLOWED);
    if (!match) return false;
    if (index === 0 && match[2] === block.number) return false;
    return true;
  });
  if (splitAt < 0) return [block];

  const line = block.lines[splitAt]!;
  const match = line.text.trim().match(SWALLOWED);
  if (!match) return [block];
  const prefix = match[1]!.trim();
  const number = match[2]!;
  const rest = match[3]!.trim();
  const beforeLines = block.lines.slice(0, splitAt);
  if (prefix) beforeLines.push({ ...line, text: prefix });
  const afterLines = [{ ...line, text: `${number}. ${rest}` }, ...block.lines.slice(splitAt + 1)];
  const splitY = line.bbox[1];
  const before = {
    number: block.number,
    bbox: normalBox(block.bbox[0], block.bbox[1], block.bbox[2], splitY - block.bbox[1]),
    lines: beforeLines,
  };
  const after = {
    number,
    bbox: normalBox(block.bbox[0], splitY, block.bbox[2], block.bbox[1] + block.bbox[3] - splitY),
    lines: afterLines,
  };
  return [before, ...splitOne(after)];
}

function normalBox(x: number, y: number, width: number, height: number): Box {
  const left = clamp01(x);
  const top = clamp01(y);
  return [
    round(left),
    round(top),
    round(clamp01(Math.min(width, 1 - left))),
    round(Math.max(0.01, clamp01(Math.min(height, 1 - top)))),
  ];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
