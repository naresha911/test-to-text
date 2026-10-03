import { normalizeQuestion, type Question, type QuestionType } from "@/lib/question-schema";
import { withoutTrailingDirections } from "@/lib/reading/direction-boundary";
import { auditQuestion } from "@/lib/reading/read-audit";
import type { ContentMode } from "@/lib/reading/mode";

/** How the words of one cropped question are arranged. Equations is read from the image. */
export const CROP_LAYOUTS = [
  "parentheses",
  "letters",
  "true_false",
  "assertion_reason",
  "fill_blank",
  "match",
  "jumble",
  "plain",
  "equations",
] as const;

export type CropLayout = (typeof CROP_LAYOUTS)[number];

export type TextCropLayout = Exclude<CropLayout, "equations">;

export const CROP_LAYOUT_OPTIONS: ReadonlyArray<{
  id: CropLayout;
  label: string;
  hint: string;
}> = [
  {
    id: "parentheses",
    label: "Choices in parentheses",
    hint: "(a) (b) (c) (d), on one line or on their own lines.",
  },
  {
    id: "letters",
    label: "Letter choices",
    hint: "A. or A) in front of each choice.",
  },
  {
    id: "true_false",
    label: "True or false",
    hint: "A statement, with True and False as the choices when they are printed.",
  },
  {
    id: "assertion_reason",
    label: "Assertion and reason",
    hint: "An assertion, a reason, then the choices.",
  },
  {
    id: "fill_blank",
    label: "Fill in the blank",
    hint: "The sentence is the question. Underscores become blanks.",
  },
  {
    id: "match",
    label: "Match the following",
    hint: "Two columns on the same line, separated by a wide gap.",
  },
  {
    id: "jumble",
    label: "Sentence jumble",
    hint: "Slash-separated words, then the choices.",
  },
  {
    id: "plain",
    label: "No choices",
    hint: "The whole crop is the question. Choices are left in the text.",
  },
  {
    id: "equations",
    label: "Equations",
    hint: "A vision model reads this crop, including fractions, powers, and roots.",
  },
];

const PAREN_OPTIONS = /\(([A-Ha-h])\)\s*/g;
const LETTER_OPTIONS = /(?:^|\s)([A-Ha-h])[.)]\s+/g;
const LEADING_NUMBER = /^\s*\(?(\d{1,3})\s*[.)]\s+/;
const ASSERTION_REASON =
  /assertion\s*(?:\([A-Za-z]\))?\s*[:\-.]?\s*([\s\S]*?)\s+reason\s*(?:\([A-Za-z]\))?\s*[:\-.]?\s*([\s\S]*)/i;

type OptionDraft = { key: string; text: string };

/**
 * Group one crop's OCR text with the layout the user picked.
 * Equations are not handled here; that layout sends the image to the vision reader.
 */
export function structureCropText(
  text: string,
  layout: TextCropLayout,
  page: number,
  number: string | null,
): Question | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const headed = takeNumber(trimmed, number);
  const question = build(layout, headed.body, headed.number, page);
  if (!question.stem.trim()) return null;
  return question;
}

/** When a vision read returns several questions, keep the one that looks like this crop. */
export function oneCropQuestion(questions: readonly Question[], number: string | null): Question | null {
  const usable = questions.filter((question) => question.stem.trim());
  if (!usable.length) return null;
  const wanted = number?.trim();
  if (wanted) {
    const match = usable.find((question) => question.number?.trim() === wanted);
    if (match) return match;
  }
  return usable.reduce((best, item) => {
    if (item.options.length !== best.options.length) {
      return item.options.length > best.options.length ? item : best;
    }
    return item.stem.length > best.stem.length ? item : best;
  });
}

/**
 * Write a crop reading onto the question the user already has.
 * The id, page, printed crop, marks, and catalog fields stay.
 * The previous hint and approval described the old wording, so they are cleared.
 */
export function applyCropReading(
  current: Question,
  reading: Question,
  mode: ContentMode,
): Question {
  const graphics = mode === "graphics";
  const next: Question = {
    ...current,
    number: reading.number?.trim() || current.number,
    type: reading.type,
    stem: reading.stem,
    instructions: reading.instructions ?? null,
    passage: reading.passage ?? null,
    assertion: reading.assertion ?? null,
    reason: reading.reason ?? null,
    options: graphics
      ? reading.options
      : reading.options.map((option) => ({ ...option, image_path: null })),
    blanks: reading.blanks,
    match_pairs: reading.match_pairs,
    answer_keys: reading.answer_keys,
    answer_text: reading.answer_text ?? null,
    answer_boolean: reading.answer_boolean ?? null,
    figures: graphics ? reading.figures : [],
    sub_questions:
      reading.type !== "comprehension"
        ? []
        : reading.sub_questions.length
          ? reading.sub_questions
          : current.sub_questions,
    confidence: reading.confidence ?? current.confidence ?? null,
    reader_id: reading.reader_id ?? current.reader_id,
    reader_version: reading.reader_version ?? current.reader_version,
    approved: false,
    approval_status: null,
    hint: null,
    explanation: null,
  };
  if (!next.source_block) return next;
  return {
    ...next,
    source_block: {
      ...next.source_block,
      flags: auditQuestion(next),
    },
  };
}

function build(layout: TextCropLayout, body: string, number: string | null, page: number): Question {
  if (layout === "letters") return fromOptions(body, number, page, LETTER_OPTIONS, null);
  if (layout === "true_false") return fromOptions(body, number, page, PAREN_OPTIONS, "true_false");
  if (layout === "assertion_reason") return fromAssertion(body, number, page);
  if (layout === "fill_blank") return fromBlank(body, number, page);
  if (layout === "match") return fromMatch(body, number, page);
  if (layout === "jumble") return fromJumble(body, number, page);
  if (layout === "plain") return fromPlain(body, number, page);
  return fromOptions(body, number, page, PAREN_OPTIONS, null);
}

function fromOptions(
  body: string,
  number: string | null,
  page: number,
  pattern: RegExp,
  forced: QuestionType | null,
): Question {
  const { stem, options } = splitOptions(body, pattern);
  const text = stem || body.trim();
  return draft(page, {
    number,
    type: forced ?? classify(text, options),
    stem: text,
    options,
  });
}

function fromAssertion(body: string, number: string | null, page: number): Question {
  const match = body.match(ASSERTION_REASON);
  if (!match) {
    const { stem, options } = splitOptions(body, PAREN_OPTIONS);
    return draft(page, {
      number,
      type: "assertion_reason",
      stem: stem || body.trim(),
      options,
    });
  }
  const assertion = match[1]!.trim();
  const { stem: reason, options } = splitOptions(match[2]!.trim(), PAREN_OPTIONS);
  return draft(page, {
    number,
    type: "assertion_reason",
    stem: assertion,
    assertion,
    reason: reason || null,
    options,
  });
}

function fromBlank(body: string, number: string | null, page: number): Question {
  const stem = body.replace(/_{2,}/g, "____").replace(/\s+/g, " ").trim();
  const marks = stem.match(/____/g)?.length ?? 0;
  return draft(page, {
    number,
    type: "fill_blank",
    stem,
    blanks: Array.from({ length: Math.max(1, marks) }, () => ""),
  });
}

function fromMatch(body: string, number: string | null, page: number): Question {
  const pairs: { left: string; right: string }[] = [];
  const intro: string[] = [];
  for (const line of body.split("\n")) {
    const pair = pairLine(line);
    if (pair) pairs.push(pair);
    else if (line.trim()) intro.push(line.trim());
  }
  const stem = intro.join(" ").replace(/\s+/g, " ").trim() || "Match the following.";
  return draft(page, {
    number,
    type: "match_the_following",
    stem,
    match_pairs: pairs,
  });
}

function fromJumble(body: string, number: string | null, page: number): Question {
  const { stem, options } = splitOptions(body, PAREN_OPTIONS);
  const text = (stem || body).replace(/[ \t]+/g, " ").trim();
  return draft(page, {
    number,
    type: options.length > 1 ? "mcq" : "short_answer",
    stem: text,
    options,
  });
}

function fromPlain(body: string, number: string | null, page: number): Question {
  const stem = body.replace(/\s+/g, " ").trim();
  return draft(page, {
    number,
    type: classify(stem, []),
    stem,
  });
}

function pairLine(line: string): { left: string; right: string } | null {
  const parts = line
    .split(/\t+|\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  return { left: parts[0]!, right: parts[1]! };
}

function splitOptions(text: string, pattern: RegExp): { stem: string; options: OptionDraft[] } {
  const source = withoutTrailingDirections(text);
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const matches = [...source.matchAll(regex)];
  if (matches.length < 2) return { stem: source.trim(), options: [] };

  const first = matches[0]!.index ?? 0;
  const stem = source.slice(0, first).trim();
  const options: OptionDraft[] = [];
  const used = new Set<string>();
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1]!.index ?? source.length) : source.length;
    const optionText = source.slice(start, end).trim().replace(/[.;,]$/, "");
    if (!optionText) return;
    options.push({ key: unusedOptionKey(match[1]!.toUpperCase(), used), text: optionText });
  });
  return { stem, options };
}

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

function classify(stem: string, options: OptionDraft[]): QuestionType {
  const lower = stem.toLowerCase();
  const optionWords = options.map((option) => option.text.trim().toLowerCase());
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

function takeNumber(text: string, fallback: string | null): { number: string | null; body: string } {
  const match = text.match(LEADING_NUMBER);
  if (!match) return { number: fallback, body: text.trim() };
  return { number: match[1]!, body: text.slice(match[0].length).trim() };
}

function draft(
  page: number,
  input: {
    number: string | null;
    type: QuestionType;
    stem: string;
    options?: OptionDraft[];
    blanks?: string[];
    match_pairs?: { left: string; right: string }[];
    assertion?: string | null;
    reason?: string | null;
  },
): Question {
  return normalizeQuestion(
    {
      number: input.number,
      type: input.type,
      stem: input.stem,
      options: input.options ?? [],
      blanks: input.blanks ?? [],
      match_pairs: input.match_pairs ?? [],
      assertion: input.assertion ?? null,
      reason: input.reason ?? null,
      confidence: 0.5,
    },
    page,
  );
}
