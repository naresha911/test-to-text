/**
 * Offline fallback structuring for plain-text OCR engines (OCR.space, Optiic).
 *
 * When no language model is available to organise the OCR text (no key, or no credits),
 * this splits the page text into questions using the printed numbering and option letters.
 * It is deliberately conservative: it never invents content, only groups what OCR returned.
 */

import { normalizeQuestion, type Question, type QuestionType } from "@/lib/question-schema";
import {
  directionRange,
  isDirectionStart,
  splitGluedDirections,
  withoutTrailingDirections,
} from "@/lib/reading/direction-boundary";

type Draft = {
  number: string | null;
  section: string | null;
  instructions: string | null;
  lines: string[];
};

const NUMBER_ONLY = /^\(?(\d{1,3})\s*[.)]?$/;
const NUMBER_START = /^\(?(\d{1,3})\s*[.)]\s+(.*)$/;
const SECTION = /^section\s+([A-Z0-9]+)\b/i;
const OPTION_SPLIT = /\(([A-Ha-h])\)\s*/g;
const OPTION_LINE = /^\(([A-Ha-h])\)\s+\S/;

function parseOptions(text: string): { stem: string; options: { key: string; text: string }[] } {
  const source = withoutTrailingDirections(text);
  const matches = [...source.matchAll(OPTION_SPLIT)];
  if (matches.length < 2) return { stem: source.trim(), options: [] };

  const first = matches[0]!.index ?? 0;
  const stem = source.slice(0, first).trim();
  const options: { key: string; text: string }[] = [];
  const used = new Set<string>();

  matches.forEach((match, i) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? source.length) : source.length;
    const body = source.slice(start, end).trim().replace(/[.;,]$/, "");
    if (!body) return;
    options.push({ key: unusedOptionKey(match[1]!.toUpperCase(), used), text: body });
  });

  return { stem, options };
}

/** OCR often reads a later choice, usually (d), as another (a). Keep the printed order. */
function unusedOptionKey(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  for (let code = 65; code <= 72; code += 1) {
    const key = String.fromCharCode(code);
    if (!used.has(key)) {
      used.add(key);
      return key;
    }
  }
  return preferred;
}

function classify(stem: string, options: { key: string; text: string }[]): QuestionType {
  const lower = stem.toLowerCase();
  const optionWords = options.map((o) => o.text.trim().toLowerCase());

  if (optionWords.length === 2 && optionWords.includes("true") && optionWords.includes("false")) {
    return "true_false";
  }
  if (/true or false|state whether/.test(lower) && !options.length) return "true_false";
  if (/assertion/.test(lower) && /reason/.test(lower)) return "assertion_reason";
  if (/match the following|match column/.test(lower)) return "match_the_following";
  if (options.length > 1) return "mcq";
  if (/_{2,}|fill in the blank/.test(lower)) return "fill_blank";
  if (/draw|figure|diagram|shown below/.test(lower)) return "diagram";
  if (/calculate|find the value|evaluate|solve/.test(lower)) return "numerical";
  if (stem.length > 180) return "long_answer";
  return "short_answer";
}

function isJumble(line: string): boolean {
  return (line.match(/\//g) ?? []).length >= 2;
}

function endsSentence(line: string): boolean {
  return /[.?!]["']?$/.test(line);
}

/** A stem that follows a finished choice row. A wrapped choice continues in lowercase. */
function startsNewStem(line: string, current: Draft): boolean {
  const trimmed = line.trim();
  if (/^\([A-Ha-h]\)/.test(trimmed)) return false;
  const optionMarks = current.lines.join(" ").match(/\([A-Ha-h]\)/g)?.length ?? 0;
  if (optionMarks < 2) return false;
  if (!/^[A-Z_]/.test(trimmed) && !/_{2,}/.test(trimmed)) return false;
  return trimmed.length >= 12 || /_{2,}|\?/.test(trimmed);
}

/**
 * Sentence-rearrangement pages print the number in the margin. OCR often drops it,
 * leaving a slash-separated stem and (a)–(d) under a directions line.
 */
function groupUnnumberedChoices(rawLines: string[]): Draft[] {
  const drafts: Draft[] = [];
  const preamble: string[] = [];
  let current: Draft | null = null;
  let phase: "before" | "stem" | "options" = "before";

  const begin = (line: string) => {
    current = {
      number: String(drafts.length + 1),
      section: null,
      instructions: null,
      lines: [line],
    };
    drafts.push(current);
    phase = OPTION_LINE.test(line) ? "options" : "stem";
  };

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index]!;
    const next = rawLines[index + 1] ?? "";

    if (OPTION_LINE.test(line)) {
      if (!current || phase === "before") begin(line);
      else current.lines.push(line);
      phase = "options";
      continue;
    }

    if (phase === "stem" && current) {
      current.lines.push(line);
      continue;
    }

    if (phase === "options" && current) {
      const previous = current.lines[current.lines.length - 1] ?? "";
      if (!endsSentence(previous) && !isJumble(line) && !startsNewStem(line, current)) {
        current.lines.push(line);
        continue;
      }
      begin(line);
      continue;
    }

    if (OPTION_LINE.test(next) || isJumble(line)) {
      begin(line);
      continue;
    }

    preamble.push(line);
  }

  const instructions = preamble.join(" ").replace(/\s+/g, " ").trim() || null;
  const kept = drafts.filter((draft) => draft.lines.filter((line) => OPTION_LINE.test(line)).length >= 2);
  if (instructions) {
    for (const draft of kept) draft.instructions = instructions;
  }
  kept.forEach((draft, index) => {
    draft.number = String(index + 1);
  });
  return kept;
}

/** Put a line break before a question number that OCR left mid-line, as in a two-column page. */
function separateQuestionNumbers(pageText: string): string {
  return splitGluedDirections(
    pageText
      .replace(/\r\n/g, "\n")
      .replace(/([^\n])[ \t]+(\d{1,3})\s*[.)]\s+(?=[A-Za-z"'(])/g, "$1\n$2. "),
  );
}

/** Group raw OCR text into questions without using a language model. */
export function structureOcrText(pageText: string, page: number): Question[] {
  const rawLines = separateQuestionNumbers(pageText)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const drafts: Draft[] = [];
  const pendingNumbers: string[] = [];
  let section: string | null = null;
  let sectionInstructions: string | null = null;
  let directionInstructions: string | null = null;
  let directionSpan: { start: number; end: number } | null = null;
  let directionMode = false;
  let directionBuffer: string[] = [];
  let current: Draft | null = null;

  const flushDirections = () => {
    if (!directionBuffer.length) return;
    const text = directionBuffer.join(" ").replace(/\s+/g, " ").trim();
    directionBuffer = [];
    if (!text) return;
    directionInstructions = text;
    directionSpan = directionRange(text);
    directionMode = true;
  };

  const instructionsFor = (number: string | null): string | null => {
    const parsed = Number(number);
    if (directionMode && directionSpan && Number.isFinite(parsed)) {
      // OCR can read a later number before an earlier one. Stay in direction
      // mode and decide from the printed range on each question.
      if (parsed < directionSpan.start || parsed > directionSpan.end) return sectionInstructions;
    }
    return directionMode ? directionInstructions : sectionInstructions;
  };

  for (const line of rawLines) {
    if (isDirectionStart(line)) {
      current = null;
      directionBuffer = [line];
      continue;
    }

    const sectionMatch = line.match(SECTION);
    const numberOnly = line.match(NUMBER_ONLY);
    const numbered = line.match(NUMBER_START);
    if (directionBuffer.length && !sectionMatch && !numberOnly && !numbered) {
      directionBuffer.push(line);
      continue;
    }
    if (directionBuffer.length) flushDirections();

    if (sectionMatch) {
      section = sectionMatch[1]!.toUpperCase();
      sectionInstructions = line;
      directionMode = false;
      directionSpan = null;
      current = null;
      continue;
    }

    if (numberOnly) {
      pendingNumbers.push(numberOnly[1]!);
      current = null;
      continue;
    }

    if (numbered) {
      current = {
        number: numbered[1]!,
        section,
        instructions: instructionsFor(numbered[1]!),
        lines: [numbered[2]!],
      };
      drafts.push(current);
      continue;
    }

    // Optiic sometimes prints bare numbers first and the bodies afterwards.
    if (!current && pendingNumbers.length) {
      const number = pendingNumbers.shift()!;
      current = { number, section, instructions: instructionsFor(number), lines: [line] };
      drafts.push(current);
      continue;
    }

    if (current) {
      if (startsNewStem(line, current)) {
        current = {
          number: null,
          section,
          instructions: instructionsFor(null),
          lines: [line],
        };
        drafts.push(current);
        continue;
      }
      current.lines.push(line);
      continue;
    }

    // Leading text before any question: treat as paper-level instructions.
    // After the first question, an unmatched line is a stray stem fragment, not
    // a direction, so it must not become the instructions for later questions.
    if (!drafts.length) {
      sectionInstructions = sectionInstructions ? `${sectionInstructions} ${line}` : line;
    }
  }

  const grouped = drafts.length ? drafts : groupUnnumberedChoices(rawLines);

  return grouped
    .map((draft) => {
      const joined = draft.lines.join(" ").replace(/\s+/g, " ").trim();
      if (!joined) return null;
      const { stem, options } = parseOptions(joined);
      const type = classify(stem || joined, options);
      return normalizeQuestion(
        {
          number: draft.number,
          type,
          stem: (stem || joined).replace(/_{2,}/g, "____"),
          section: draft.section,
          instructions: draft.instructions,
          options,
          blanks: type === "fill_blank" ? [""] : [],
          confidence: 0.5,
        },
        page,
      );
    })
    .filter((q): q is Question => !!q && q.stem.length > 0);
}
