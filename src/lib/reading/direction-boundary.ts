/**
 * A printed directions header introduces the next questions.
 * It is not another sentence of the choice above it.
 */

const HEADER = String.raw`(?:DIRECTIONS?|INSTRUCTIONS?)`;
const HEADER_SHAPE = String.raw`${HEADER}\s*(?:\(\s*[^)\n]{0,48}\)|for questions\b)`;

/** At the start of a line, or glued on after earlier text such as option (d). */
const DIRECTION_CUT = new RegExp(
  String.raw`(?:^|\n)\s*${HEADER}\b|\b(?:${HEADER_SHAPE})`,
  "i",
);

const CHOICE_MARKER = /\([A-Ha-h]\)|(?:^|\s)[A-Ha-h][.)]\s+/;
const RANGE = /(\d{1,3})\s*(?:[-–—]|to)\s*(\d{1,3})/i;

export function isDirectionStart(line: string): boolean {
  return new RegExp(String.raw`^${HEADER}\b`, "i").test(line.trim());
}

/** Printed range on a directions line, such as (21-25) or "21 to 25". */
export function directionRange(text: string): { start: number; end: number } | null {
  const match = text.match(RANGE);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return null;
  return { start, end };
}

/**
 * Remove a directions header and everything after it.
 * An empty string means the whole text was the header.
 */
export function cutDirectionTail(text: string): string {
  const match = text.match(DIRECTION_CUT);
  if (!match || match.index == null) return text;
  if (match.index <= 0) return "";
  return text.slice(0, match.index).replace(/[.;,\s]+$/, "");
}

/**
 * Keep a directions mention in the stem. Cut only once choices have started,
 * so a later header cannot become part of the last choice or the next question.
 */
export function withoutTrailingDirections(text: string): string {
  const marker = text.search(CHOICE_MARKER);
  if (marker < 0) return cutDirectionTail(text);
  return `${text.slice(0, marker)}${cutDirectionTail(text.slice(marker))}`.trim();
}

/** Put a line break before a directions header that OCR left on the previous line. */
export function splitGluedDirections(text: string): string {
  return text.replace(
    new RegExp(String.raw`([^\n])[ \t]+(${HEADER_SHAPE})`, "gi"),
    "$1\n$2",
  );
}
