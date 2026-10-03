/** Recover stacked fractions from OCR word boxes, and detect a transcript that lost them. */

export type PlacedWord = {
  text: string;
  /** [x, y, width, height] normalised to the page, 0..1. */
  bbox: [number, number, number, number];
};

type BBox = [number, number, number, number];

type Token = {
  text: string;
  bbox: BBox;
};

const INTEGER = /^\d{1,5}$/;

function centerX(box: BBox): number {
  return box[0] + box[2] / 2;
}

function centerY(box: BBox): number {
  return box[1] + box[3] / 2;
}

function union(a: BBox, b: BBox): BBox {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const right = Math.max(a[0] + a[2], b[0] + b[2]);
  const bottom = Math.max(a[1] + a[3], b[1] + b[3]);
  return [x, y, right - x, bottom - y];
}

/** Centers line up. A wide option value must not count as aligned with a narrow digit beside it. */
function alignedX(upper: BBox, lower: BBox): boolean {
  const dx = Math.abs(centerX(upper) - centerX(lower));
  const tolerance = Math.max(Math.min(upper[2], lower[2]) * 0.8, 0.012);
  return dx <= tolerance;
}

/** Denominator sits on the fraction, not on the next printed line. */
function stackedUnder(upper: BBox, lower: BBox): boolean {
  const gap = lower[1] - (upper[1] + upper[3]);
  const height = Math.min(upper[3], lower[3]);
  const dy = centerY(lower) - centerY(upper);
  return (
    alignedX(upper, lower) &&
    gap >= -lower[3] * 0.6 &&
    gap <= height * 0.8 &&
    dy >= height * 0.35 &&
    dy <= height * 2.2
  );
}

function sameBaseline(a: BBox, b: BBox): boolean {
  return Math.abs(centerY(a) - centerY(b)) <= Math.max(a[3], b[3], 0.012) * 0.3;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (!sorted.length) return 0.02;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** A raised digit may sit beside other numerators. A digit in a sentence may not. */
function hasProseNeighbor(
  placed: readonly Token[],
  index: number,
  numerators: ReadonlySet<number>,
): boolean {
  const box = placed[index]!.bbox;
  let left: number | null = null;
  let right: number | null = null;
  let leftGap = Number.POSITIVE_INFINITY;
  let rightGap = Number.POSITIVE_INFINITY;
  for (let other = 0; other < placed.length; other += 1) {
    if (other === index) continue;
    const beside = placed[other]!.bbox;
    const vertical = Math.abs(centerY(box) - centerY(beside));
    if (vertical > Math.max(box[3], beside[3], 0.012) * 1.2) continue;
    const gapLeft = box[0] - (beside[0] + beside[2]);
    const gapRight = beside[0] - (box[0] + box[2]);
    if (gapLeft >= -0.008 && gapLeft < leftGap) {
      leftGap = gapLeft;
      left = other;
    }
    if (gapRight >= -0.008 && gapRight < rightGap) {
      rightGap = gapRight;
      right = other;
    }
  }
  for (const neighbor of [left, right]) {
    if (neighbor == null || numerators.has(neighbor)) continue;
    const gap = neighbor === left ? leftGap : rightGap;
    if (gap > 0.06) continue;
    if (sameBaseline(box, placed[neighbor]!.bbox)) return true;
  }
  return false;
}

function pairScore(upper: BBox, lower: BBox): number {
  const gap = Math.max(0, lower[1] - (upper[1] + upper[3]));
  const dx = Math.abs(centerX(upper) - centerX(lower));
  return gap + dx * 2;
}

/**
 * Rebuild reading order with stacked integer pairs written as `$\frac{a}{b}$`.
 * A whole number tight against the left of a pair becomes `$n\frac{a}{b}$`.
 * A digit that shares its baseline with a word is left alone, so question
 * numbers and ordinary lines are not turned into fractions.
 * Returns null when no stacked pair is present, so ordinary prose is left alone.
 */
export function inlineStackedFractions(words: readonly PlacedWord[]): string | null {
  const placed = words
    .map((word) => ({ text: word.text.trim(), bbox: word.bbox }))
    .filter((word) => word.text.length > 0);
  if (placed.length < 2) return null;

  const integers = placed
    .map((word, index) => ({ index, ...word }))
    .filter((word) => INTEGER.test(word.text));

  const candidates: { num: number; den: number; score: number }[] = [];
  for (const upper of integers) {
    for (const lower of integers) {
      if (upper.index === lower.index) continue;
      if (!stackedUnder(upper.bbox, lower.bbox)) continue;
      candidates.push({
        num: upper.index,
        den: lower.index,
        score: pairScore(upper.bbox, lower.bbox),
      });
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  const used = new Set<number>();
  const pairs: { num: number; den: number; whole: number | null }[] = [];
  for (const candidate of candidates) {
    if (used.has(candidate.num) || used.has(candidate.den)) continue;
    used.add(candidate.num);
    used.add(candidate.den);
    pairs.push({ num: candidate.num, den: candidate.den, whole: null });
  }
  const numerators = new Set(pairs.map((pair) => pair.num));
  let droppedNeighbor = true;
  while (droppedNeighbor) {
    droppedNeighbor = false;
    for (let index = pairs.length - 1; index >= 0; index -= 1) {
      if (!hasProseNeighbor(placed, pairs[index]!.num, numerators)) continue;
      const dropped = pairs.splice(index, 1)[0]!;
      used.delete(dropped.num);
      used.delete(dropped.den);
      numerators.delete(dropped.num);
      droppedNeighbor = true;
    }
  }
  if (!pairs.length) return null;

  for (const pair of pairs) {
    const stack = union(placed[pair.num]!.bbox, placed[pair.den]!.bbox);
    let whole: number | null = null;
    let closest = Number.POSITIVE_INFINITY;
    for (const candidate of integers) {
      if (used.has(candidate.index)) continue;
      const gap = stack[0] - (candidate.bbox[0] + candidate.bbox[2]);
      if (gap < -0.004 || gap > 0.03) continue;
      const mid = centerY(candidate.bbox);
      if (mid < stack[1] - 0.01 || mid > stack[1] + stack[3] + 0.01) continue;
      if (gap < closest) {
        closest = gap;
        whole = candidate.index;
      }
    }
    if (whole != null) {
      used.add(whole);
      pair.whole = whole;
    }
  }

  const tokens: Token[] = [];
  placed.forEach((word, index) => {
    if (!used.has(index)) tokens.push(word);
  });
  for (const pair of pairs) {
    const num = placed[pair.num]!;
    const den = placed[pair.den]!;
    const whole = pair.whole == null ? null : placed[pair.whole]!;
    const body = whole
      ? `$${whole.text}\\frac{${num.text}}{${den.text}}$`
      : `$\\frac{${num.text}}{${den.text}}$`;
    // Sit on the denominator's line, where the choice letters are, and keep a
    // normal word height so the fraction cannot glue two question lines together.
    const left = Math.min(num.bbox[0], den.bbox[0], whole?.bbox[0] ?? num.bbox[0]);
    const right = Math.max(
      num.bbox[0] + num.bbox[2],
      den.bbox[0] + den.bbox[2],
      whole ? whole.bbox[0] + whole.bbox[2] : 0,
    );
    const box: BBox = [left, den.bbox[1], Math.max(right - left, 0.01), den.bbox[3]];
    tokens.push({ text: body, bbox: box });
  }

  const band = Math.max(median(placed.map((word) => word.bbox[3])) * 0.85, 0.012);
  tokens.sort(
    (a, b) => centerY(a.bbox) - centerY(b.bbox) || a.bbox[0] - b.bbox[0] || tokenRank(a.text) - tokenRank(b.text),
  );
  const lines: Token[][] = [];
  for (const token of tokens) {
    const last = lines[lines.length - 1];
    if (!last) {
      lines.push([token]);
      continue;
    }
    const lastCenter = last.reduce((sum, item) => sum + centerY(item.bbox), 0) / last.length;
    if (Math.abs(centerY(token.bbox) - lastCenter) <= band) last.push(token);
    else lines.push([token]);
  }
  for (const line of lines) {
    line.sort((a, b) => a.bbox[0] - b.bbox[0] || tokenRank(a.text) - tokenRank(b.text));
  }
  return lines.map((line) => joinReadingLine(line.map((token) => token.text))).join("\n");
}

/** A number shares its box with the printed dot, so the digit has to come first. */
function tokenRank(text: string): number {
  if (/^\d/.test(text)) return 0;
  if (/^[.)]$/.test(text)) return 1;
  return 0;
}

/** "( a )" and "164 ." are one printed token. Keep the space between words. */
function joinReadingLine(parts: string[]): string {
  let line = "";
  for (const part of parts) {
    if (!line) {
      line = part;
      continue;
    }
    const tight = /[([]$/.test(line) || /^[.,:;?!)%\]]/.test(part);
    line += (tight ? "" : " ") + part;
  }
  return line;
}

function optionBodies(text: string): string[] {
  const matches = [...text.matchAll(/\(([A-Ha-h])\)\s*/g)];
  if (matches.length < 2) return [];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end =
      index + 1 < matches.length ? (matches[index + 1]!.index ?? text.length) : text.length;
    return text.slice(start, end).trim();
  });
}

/**
 * True when option text looks like a fraction bar was dropped (3,5 or 3'5),
 * or a mixed-number sum was flattened into a run of small integers.
 * A few recovered fractions do not hide other options that are still smashed.
 */
export function mathTranscriptIsSmashed(text: string): boolean {
  const messy = optionBodies(text).filter((body) => /\d\s*[,']\s*\d/.test(body));
  if (messy.length >= 2) return true;
  return text.split("\n").some((line) => {
    const ints = line.match(/\b\d{1,2}\b/g) ?? [];
    return ints.length >= 4 && /[+×xX÷=]/.test(line);
  });
}
