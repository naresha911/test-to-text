import { structureOcrText } from "@/lib/ocr-structure";
import { attachFigures, type TextLineBox } from "@/lib/reader/parse-blocks";
import type { ReaderBlock } from "@/lib/reader/types";
import type { Question } from "@/lib/question-schema";

import type { ContentMode } from "@/lib/reading/mode";

const FIGURE_PLAN =
  /we'?ll add a figure|we need bbox|need to define bbox|coordinate system|let's (?:try to )?approximate|x\s*=\s*0 is (?:the )?left edge/i;

export function usableStems(questions: Question[]): Question[] {
  return questions.filter(
    (question) => question.stem.trim().length >= 8 && !FIGURE_PLAN.test(question.stem),
  );
}

/** Drop every figure. Text mode uses this so a word page cannot grow diagram crops. */
export function stripFigures(questions: Question[]): Question[] {
  return questions.map((question) => ({
    ...question,
    figures: [],
    sub_questions: stripFigures(question.sub_questions),
  }));
}

/**
 * Turn a transcript into questions.
 * Readers do not call this, and this does not call an OCR API.
 */
export function cleanPage(input: {
  pageText: string;
  page: number;
  mode: ContentMode;
  lines: TextLineBox[];
  regions: ReaderBlock[];
  reader: { reader_id: string; reader_version: string };
  modelQuestions?: Question[] | null;
  /** When OCR math is smashed, a vision reading replaces the offline split. */
  preferModel?: boolean;
}): Question[] {
  let questions = structureOcrText(input.pageText, input.page);
  const modeled = input.modelQuestions?.length ? usableStems(input.modelQuestions) : [];
  const offlineCount = usableStems(questions).length;
  // A vision reading may repair fractions. It must not replace a fuller split
  // with a shorter one that dropped printed question numbers.
  if (
    modeled.length > 0 &&
    (offlineCount === 0 || (input.preferModel && modeled.length >= offlineCount))
  ) {
    questions = modeled;
  }
  questions = stripFigures(questions);

  if (input.mode === "graphics" && input.regions.length) {
    questions = attachFigures(questions, input.regions, input.reader, input.lines);
  } else {
    questions = questions.map((question) => ({ ...question, ...input.reader }));
  }

  if (!usableStems(questions).length) {
    throw new Error(
      "The page was read, but the text could not be split into questions. Try the page again.",
    );
  }
  return questions;
}
