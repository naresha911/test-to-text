import type { Question, ReadFlag } from "@/lib/question-schema";
import { mathTranscriptIsSmashed } from "@/lib/reading/math-text";

export const READ_FLAG_LABELS: Record<ReadFlag, string> = {
  options_in_stem: "choices in the question",
  missing_options: "missing choices",
  broken_math: "broken math",
  suspicious_currency: "suspicious rupee",
  partial_stem: "incomplete text",
  number_gap: "missing number",
};

const MCQ_PROMPT = /which of the following|choose the correct|select the (?:right|correct)/i;
const OPTION_MARKER = /\([A-Ha-h]\)|(?:^|\s)[A-Ha-h][.)]\s+\S/g;
const MONEY_WORD =
  /\b(?:cost|price|priced|rupee|rupees|bought|sold|costs|pays|paid|spend|spent)\b/i;

/** Structural problems on one question. This does not call a model and does not rewrite text. */
export function auditQuestion(question: Question): ReadFlag[] {
  const flags: ReadFlag[] = [];
  const stem = question.stem ?? "";
  const optionText = question.options.map((option) => option.text).join("\n");
  const combined = [stem, optionText].filter(Boolean).join("\n");
  const mathText = [
    stem,
    ...question.options.map((option) => `(${option.key}) ${option.text}`),
  ].join("\n");

  if (markerCount(stem) >= 2) flags.push("options_in_stem");
  if (missingOptions(question, stem)) flags.push("missing_options");
  if (mathTranscriptIsSmashed(mathText) || unclosedMath(combined)) flags.push("broken_math");
  if (suspiciousCurrency(combined)) flags.push("suspicious_currency");
  if (partialStem(question)) flags.push("partial_stem");
  return flags;
}

/** Attach per-question flags, including a hole in the printed question numbers. */
export function auditQuestions(questions: Question[]): Question[] {
  const flagsById = new Map<string, ReadFlag[]>();
  for (const question of questions) flagsById.set(question.id, auditQuestion(question));

  const numbered = questions
    .map((question) => ({ question, number: integerNumber(question.number) }))
    .filter((item): item is { question: Question; number: number } => item.number != null)
    .sort((a, b) => a.number - b.number);
  for (let index = 1; index < numbered.length; index += 1) {
    const previous = numbered[index - 1]!.number;
    const current = numbered[index]!.number;
    if (current - previous <= 1) continue;
    const flags = flagsById.get(numbered[index]!.question.id);
    if (flags && !flags.includes("number_gap")) flags.push("number_gap");
  }

  return questions.map((question) => ({
    ...question,
    source_block: {
      bbox: question.source_block?.bbox ?? null,
      image_path: question.source_block?.image_path ?? null,
      flags: flagsById.get(question.id) ?? [],
      passes: question.source_block?.passes ?? 1,
    },
  }));
}

/**
 * Keep a second reading only when the flags that triggered it are gone and
 * most of the first read's real words are still present.
 */
export function acceptRepair(
  before: Question,
  after: Question,
  triggered: readonly ReadFlag[],
): boolean {
  const remaining = new Set(auditQuestion(after));
  for (const flag of triggered) {
    if (flag === "number_gap") continue;
    if (remaining.has(flag)) return false;
  }
  const required = contentWords(questionText(before));
  if (!required.length) return true;
  const available = contentWords(questionText(after));
  let kept = 0;
  for (const word of required) {
    const index = available.indexOf(word);
    if (index < 0) continue;
    available.splice(index, 1);
    kept += 1;
  }
  return kept / required.length >= 0.8;
}

export function questionText(question: Question): string {
  return [question.stem, ...question.options.map((option) => option.text)].join(" ");
}

function missingOptions(question: Question, stem: string): boolean {
  const filled = question.options.filter((option) => option.text.trim()).length;
  if (filled >= 2) return false;
  const declaredMcq = question.type === "mcq" || question.type === "multi_select";
  const prompt = MCQ_PROMPT.test(stem);
  const markers = markerCount(stem) >= 2;
  const exempt =
    (question.type === "short_answer" ||
      question.type === "numerical" ||
      question.type === "long_answer") &&
    !declaredMcq &&
    !prompt &&
    !markers;
  if (exempt) return false;
  return declaredMcq || prompt || markers;
}

function markerCount(text: string): number {
  return [...text.matchAll(OPTION_MARKER)].length;
}

function unclosedMath(text: string): boolean {
  const singles = text.replace(/\$\$/g, "");
  return (singles.match(/\$/g) ?? []).length % 2 === 1;
}

/** Flag a rupee sign that OCR turned into 7, 7s, or R5. Does not change the text. */
function suspiciousCurrency(text: string): boolean {
  if (!MONEY_WORD.test(text)) return false;
  if (/\b(?:7s|R5)\b/.test(text)) return true;
  if (/(?:^|[^\d])7\s+\d{2,}(?:\.\d+)?\b/.test(text)) return true;
  if (/(?:^|[^\d])7\.\d{2}\b/.test(text)) return true;
  return false;
}

function partialStem(question: Question): boolean {
  if (!question.number?.trim()) return false;
  const stem = question.stem.trim();
  if (/[A-Za-z]-$/.test(stem)) return true;
  if (stem.length >= 8) return false;
  if (/[.?!]$/.test(stem)) return false;
  if (/^[\d\s.+\-×xX÷=/?()]+$/.test(stem) && stem.length >= 3) return false;
  return true;
}

function contentWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
}

function integerNumber(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,3}$/.test(value.trim())) return null;
  return Number(value.trim());
}
