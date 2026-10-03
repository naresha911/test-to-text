import { structureOcrText } from "@/lib/ocr-structure";
import { normalizeQuestion, type Figure, type Question } from "@/lib/question-schema";

import type { RawReaderResult, ReaderBlock } from "@/lib/reader/types";

const LAYOUT_LABEL = /\b(?:question figure|answer figures)\b/gi;

export type TextLineBox = {
  text: string;
  bbox: [number, number, number, number];
};

function blockText(block: ReaderBlock): string {
  const latex = block.latex?.trim();
  if (block.type === "formula" && latex) {
    return latex.startsWith("$") ? latex : `$${latex}$`;
  }
  const text = block.text?.trim() || latex || "";
  if (block.type === "formula" && text && !text.startsWith("$")) return `$${text}$`;
  return text;
}

function rowsOf(figures: ReaderBlock[]): ReaderBlock[][] {
  const sorted = figures
    .filter((figure) => figure.bbox)
    .sort(
      (a, b) => (a.bbox?.[1] ?? 0) - (b.bbox?.[1] ?? 0) || (a.bbox?.[0] ?? 0) - (b.bbox?.[0] ?? 0),
    );
  const groups: ReaderBlock[][] = [];
  for (const figure of sorted) {
    const y = figure.bbox?.[1] ?? 0;
    const height = figure.bbox?.[3] ?? 0.05;
    const last = groups[groups.length - 1];
    const lastBox = last?.[0]?.bbox;
    const lastBottom = (lastBox?.[1] ?? y) + (lastBox?.[3] ?? 0);
    // A new row starts when there is a real gap under the previous figure.
    // Comparing the tops alone merges a question diamond with the answer row on a full page.
    if (!last || y > lastBottom + Math.max(0.008, height * 0.35)) groups.push([figure]);
    else last.push(figure);
  }
  for (const row of groups) row.sort((a, b) => (a.bbox?.[0] ?? 0) - (b.bbox?.[0] ?? 0));
  return groups;
}

function splitFigures(figures: ReaderBlock[]): { question: ReaderBlock[]; options: ReaderBlock[] } {
  const grouped = rowsOf(figures);
  if (!grouped.length) return { question: [], options: [] };
  if (grouped.length === 1) {
    const only = grouped[0] ?? [];
    if (only.length >= 4) return { question: [], options: only };
    return { question: only, options: [] };
  }
  let optionIndex = 0;
  let most = 0;
  // Answer figures sit under the series. A 3-figure series plus its blank box
  // has the same count as four choices, so a tie belongs to the lower row.
  // A longer row still wins: one question figure above four choices stays the question.
  grouped.forEach((row, index) => {
    if (row.length >= most) {
      most = row.length;
      optionIndex = index;
    }
  });
  if (most < 2) return { question: figures, options: [] };
  return {
    question: grouped.filter((_, index) => index !== optionIndex).flat(),
    options: grouped[optionIndex] ?? [],
  };
}

function toFigure(block: ReaderBlock, role: Figure["role"], caption: string | null): Figure {
  return {
    description: role === "option_figure" ? "Answer figure" : "Question figure",
    caption,
    bbox: block.bbox ?? null,
    role: role ?? null,
    page: null,
  };
}

function cleanStem(stem: string): string {
  const cleaned = stem.replace(LAYOUT_LABEL, " ").replace(/\s+/g, " ").trim();
  return cleaned.length ? cleaned : stem.trim();
}

/** Attach figure boxes to questions. Printed wording is kept; layout labels are not treated as the question. */
export function attachFigures(
  questions: Question[],
  blocks: ReaderBlock[],
  reader?: { reader_id: string; reader_version: string },
  lines?: TextLineBox[],
): Question[] {
  const figures = blocks.filter((block) => block.type === "figure" || block.type === "table");
  const stamped = questions.map((question) =>
    reader
      ? { ...question, reader_id: reader.reader_id, reader_version: reader.reader_version }
      : question,
  );
  if (
    !figures.length ||
    stamped.some((question) => question.figures.some((figure) => figure.bbox))
  ) {
    return stamped;
  }

  if (lines?.length && stamped.length > 1) {
    const groups = figuresByQuestion(stamped, figures, lines);
    return stamped.map((question) => {
      const owned = groups.get(questionKey(question.number)) ?? [];
      return owned.length ? decorateQuestion(question, owned) : question;
    });
  }

  const target = stamped[0];
  if (!target) return stamped;
  return [decorateQuestion(target, figures), ...stamped.slice(1)];
}

function questionKey(number: string | null | undefined): string {
  if (!number) return "";
  const digits = number.match(/\d{1,3}/)?.[0];
  return digits ? String(Number(digits)) : number;
}

function figuresByQuestion(
  questions: Question[],
  figures: ReaderBlock[],
  lines: TextLineBox[],
): Map<string, ReaderBlock[]> {
  const known = new Set(questions.map((question) => questionKey(question.number)));
  const anchors = lines.flatMap((line) => {
    const match = line.text.trim().match(/^(\d{1,3})\s*[.)]/);
    if (!match) return [];
    const number = String(Number(match[1]));
    if (!known.has(number)) return [];
    return [{ number, x: line.bbox[0] + line.bbox[2] / 2, y: line.bbox[1] }];
  });
  const groups = new Map<string, ReaderBlock[]>();
  for (const figure of figures) {
    const box = figure.bbox;
    if (!box || !anchors.length) continue;
    const centerX = box[0] + box[2] / 2;
    const centerY = box[1] + box[3] / 2;
    const column = anchors.filter((anchor) => anchor.x < 0.5 === centerX < 0.5);
    const pool = column.length ? column : anchors;
    const chosen = pool.filter((anchor) => anchor.y <= centerY + 0.04).sort((a, b) => b.y - a.y)[0];
    if (!chosen) continue;
    const list = groups.get(chosen.number) ?? [];
    list.push(figure);
    groups.set(chosen.number, list);
  }
  return groups;
}

function decorateQuestion(question: Question, figures: ReaderBlock[]): Question {
  const { question: questionFigures, options: optionFigures } = splitFigures(figures);
  const options = [...question.options];
  optionFigures.forEach((block, index) => {
    const key = String.fromCharCode(65 + index);
    if (!options.some((option) => option.key === key)) {
      options.push({ key, text: "", is_correct: null });
    }
  });
  const textsAreLabels = options.every((option) => option.text.trim().length <= 2);
  if (optionFigures.length >= 2 && textsAreLabels) {
    const byKey = new Map(options.map((option) => [option.key, option]));
    options.length = 0;
    optionFigures.forEach((_block, index) => {
      const key = String.fromCharCode(65 + index);
      options.push(byKey.get(key) ?? { key, text: "", is_correct: null });
    });
  }

  const nextFigures: Figure[] = [
    ...questionFigures.map((block) => toFigure(block, "question_figure", null)),
    ...optionFigures.map((block, index) =>
      toFigure(block, "option_figure", String.fromCharCode(65 + index)),
    ),
  ];

  return {
    ...question,
    stem: cleanStem(question.stem),
    type: nextFigures.length ? "diagram" : question.type,
    options,
    figures: nextFigures,
  };
}

/** Build questions from a normalized reader result without paraphrasing the source text. */
export function questionsFromBlocks(result: RawReaderResult, page: number): Question[] {
  const lines = result.blocks
    .filter((block) => block.type === "text" || block.type === "formula")
    .map(blockText)
    .filter(Boolean);
  const parsed = structureOcrText(lines.join("\n"), page);
  const questions = parsed.length
    ? parsed
    : lines.length
      ? [
          normalizeQuestion(
            { type: "unknown", stem: lines.join(" ").replace(/\s+/g, " ").trim() },
            page,
          ),
        ]
      : [];
  return attachFigures(questions, result.blocks, {
    reader_id: result.reader_id,
    reader_version: result.reader_version,
  });
}
