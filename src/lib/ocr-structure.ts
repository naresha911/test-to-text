/**
 * Offline fallback structuring for plain-text OCR engines (Optiic, Google Cloud Vision).
 *
 * When no language model is available to organise the OCR text (no key, or no credits),
 * this splits the page text into questions using the printed numbering and option letters.
 * It is deliberately conservative: it never invents content, only groups what OCR returned.
 */

import { normalizeQuestion, type Question, type QuestionType } from "@/lib/question-schema";

type Draft = {
  number: string | null;
  section: string | null;
  instructions: string | null;
  lines: string[];
};

const NUMBER_ONLY = /^\(?(\d{1,3})[.)]?$/;
const NUMBER_START = /^\(?(\d{1,3})[.)]\s+(.*)$/;
const SECTION = /^section\s+([A-Z0-9]+)\b/i;
const OPTION_SPLIT = /\(([A-Ha-h])\)\s*/g;

function parseOptions(text: string): { stem: string; options: { key: string; text: string }[] } {
  const matches = [...text.matchAll(OPTION_SPLIT)];
  if (matches.length < 2) return { stem: text.trim(), options: [] };

  const first = matches[0]!.index ?? 0;
  const stem = text.slice(0, first).trim();
  const options: { key: string; text: string }[] = [];

  matches.forEach((match, i) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? text.length) : text.length;
    const body = text.slice(start, end).trim().replace(/[.;,]$/, "");
    options.push({ key: match[1]!.toUpperCase(), text: body });
  });

  return { stem, options };
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

/** Group raw OCR text into questions without using a language model. */
export function structureOcrText(pageText: string, page: number): Question[] {
  const rawLines = pageText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const drafts: Draft[] = [];
  const pendingNumbers: string[] = [];
  let section: string | null = null;
  let instructions: string | null = null;
  let current: Draft | null = null;

  for (const line of rawLines) {
    const sectionMatch = line.match(SECTION);
    if (sectionMatch) {
      section = sectionMatch[1]!.toUpperCase();
      instructions = line;
      current = null;
      continue;
    }

    const numberOnly = line.match(NUMBER_ONLY);
    if (numberOnly) {
      pendingNumbers.push(numberOnly[1]!);
      current = null;
      continue;
    }

    const numbered = line.match(NUMBER_START);
    if (numbered) {
      current = { number: numbered[1]!, section, instructions, lines: [numbered[2]!] };
      drafts.push(current);
      continue;
    }

    // Optiic sometimes prints bare numbers first and the bodies afterwards.
    if (!current && pendingNumbers.length) {
      current = { number: pendingNumbers.shift()!, section, instructions, lines: [line] };
      drafts.push(current);
      continue;
    }

    if (current) {
      current.lines.push(line);
      continue;
    }

    // Leading text before any question: treat as paper-level instructions.
    instructions = instructions ? `${instructions} ${line}` : line;
  }

  return drafts
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
