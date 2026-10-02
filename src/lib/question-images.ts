import type { Question } from "@/lib/question-schema";

const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Storage key relative to the local image root. Rejects absolute paths and traversal. */
export function normalizeStoredImagePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\\") || trimmed.includes("\0")) return null;
  if (trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) return null;

  const segments = trimmed.split("/");
  if (!segments.length || segments.some((segment) => !PATH_SEGMENT.test(segment))) return null;
  if (segments[segments.length - 1] === "_manifest.json") return null;
  return segments.join("/");
}

function addPath(paths: Set<string>, value: string | null | undefined): void {
  const normalized = normalizeStoredImagePath(value);
  if (normalized) paths.add(normalized);
}

/** Figure and option image files owned by one question, including nested sub-questions. */
export function collectQuestionImagePaths(
  question: Question,
  into: Set<string> = new Set(),
): Set<string> {
  for (const figure of question.figures ?? []) addPath(into, figure?.image_path);
  for (const option of question.options ?? []) addPath(into, option?.image_path);
  for (const sub of question.sub_questions ?? []) {
    if (sub) collectQuestionImagePaths(sub, into);
  }
  return into;
}

export function collectQuestionsImagePaths(questions: readonly Question[]): Set<string> {
  const paths = new Set<string>();
  for (const question of questions) collectQuestionImagePaths(question, paths);
  return paths;
}

/** Paths that disappeared from a question tree. Callers still have to honor other documents. */
export function droppedImagePaths(
  before: readonly Question[],
  after: readonly Question[],
): string[] {
  const kept = collectQuestionsImagePaths(after);
  const dropped: string[] = [];
  for (const path of collectQuestionsImagePaths(before)) {
    if (!kept.has(path)) dropped.push(path);
  }
  return dropped;
}

/**
 * Remove one stored image from this question.
 * Figure rows that pointed at it are deleted. Options keep their text and lose the file link.
 */
export function detachImagePath(question: Question, imagePath: string): Question {
  const target = normalizeStoredImagePath(imagePath);
  if (!target) return question;

  const figures = (question.figures ?? []).filter(
    (figure) => normalizeStoredImagePath(figure.image_path) !== target,
  );
  const options = (question.options ?? []).map((option) =>
    normalizeStoredImagePath(option.image_path) === target
      ? { ...option, image_path: null, image_description: null }
      : option,
  );
  const sub_questions = (question.sub_questions ?? []).map((sub) => detachImagePath(sub, target));

  const figuresChanged = figures.length !== (question.figures ?? []).length;
  const optionsChanged = options.some((option, index) => option !== question.options[index]);
  const subsChanged = sub_questions.some((sub, index) => sub !== question.sub_questions[index]);
  if (!figuresChanged && !optionsChanged && !subsChanged) return question;
  return { ...question, figures, options, sub_questions };
}

/** Drop a choice and its option-only crop when no remaining choice still uses that file. */
export function questionWithoutOption(question: Question, index: number): Question {
  const removed = question.options[index];
  if (!removed) return question;

  const options = question.options.filter((_, optionIndex) => optionIndex !== index);
  const answer_keys = question.answer_keys.filter((key) => key !== removed.key);
  const removedPath = normalizeStoredImagePath(removed.image_path);
  const stillUsed =
    removedPath != null &&
    options.some((option) => normalizeStoredImagePath(option.image_path) === removedPath);
  const figures =
    removedPath && !stillUsed
      ? question.figures.filter((figure) => {
          if (figure.role !== "option_figure") return true;
          return normalizeStoredImagePath(figure.image_path) !== removedPath;
        })
      : question.figures;

  return { ...question, options, answer_keys, figures };
}
