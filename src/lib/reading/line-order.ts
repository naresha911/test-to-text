import type { TextLineBox } from "@/lib/reader/parse-blocks";

const NUMBER_HEAD = /^\(?(\d{1,3})\s*[.)](?:\s+\S|\s*$)/;

/**
 * Reading order for one page.
 * A real second column of questions is read after the first column.
 * Choices printed side by side on one row are read left to right.
 * A question number sitting alone in the margin is joined to the stem beside it.
 */
export function orderedPageText(lines: readonly TextLineBox[]): string {
  const usable = lines.filter((line) => line.text.trim() && line.bbox[2] > 0 && line.bbox[3] > 0);
  if (!usable.length) return "";
  return splitPageColumns(usable)
    .map((column) => rowsToText(column))
    .filter(Boolean)
    .join("\n");
}

function splitPageColumns(lines: TextLineBox[]): TextLineBox[][] {
  const heads = lines.filter((line) => NUMBER_HEAD.test(line.text.trim()));
  const columns = clusterColumns(heads);
  if (columns.length < 2) return [lines];
  const mid = columnMid(columns[0] ?? [], columns[1] ?? []);
  const left: TextLineBox[] = [];
  const right: TextLineBox[] = [];
  for (const line of lines) {
    const center = line.bbox[0] + line.bbox[2] / 2;
    if (center < mid) left.push(line);
    else right.push(line);
  }
  return [left, right];
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

function columnMid(left: TextLineBox[], right: TextLineBox[]): number {
  const leftEdge = Math.max(...left.map((line) => line.bbox[0] + line.bbox[2]), 0);
  const rightEdge = Math.min(...right.map((line) => line.bbox[0]), 1);
  return Math.min(1, Math.max(0, (leftEdge + rightEdge) / 2));
}

function rowsToText(lines: TextLineBox[]): string {
  return groupRows(lines).map(joinRow).filter(Boolean).join("\n");
}

function groupRows(lines: TextLineBox[]): TextLineBox[][] {
  const sorted = [...lines].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  const rows: TextLineBox[][] = [];
  for (const line of sorted) {
    const row = rows[rows.length - 1];
    if (!row || !sameRow(row, line)) rows.push([line]);
    else row.push(line);
  }
  for (const row of rows) row.sort((a, b) => a.bbox[0] - b.bbox[0] || a.bbox[1] - b.bbox[1]);
  return rows;
}

function sameRow(row: TextLineBox[], line: TextLineBox): boolean {
  const top = Math.min(...row.map((item) => item.bbox[1]));
  const bottom = Math.max(...row.map((item) => item.bbox[1] + item.bbox[3]));
  const height = Math.max(bottom - top, line.bbox[3], 0.01);
  const center = line.bbox[1] + line.bbox[3] / 2;
  return center >= top - height * 0.25 && center <= bottom + height * 0.25;
}

function joinRow(row: TextLineBox[]): string {
  const parts = row.map((line) => line.text.trim()).filter(Boolean);
  const numberOnly = parts[0]?.match(/^\(?(\d{1,3})\s*[.)]?\s*$/);
  if (numberOnly && parts.length > 1) {
    return `${numberOnly[1]}. ${parts.slice(1).join(" ")}`.replace(/\s+/g, " ").trim();
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
