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

function objectList<T>(value: unknown): T[] {
  return Array.isArray(value)
    ? (value.filter((item) => item && typeof item === "object") as T[])
    : [];
}

function optionToken(value: string | null | undefined): string {
  return (value ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

/** Figure and option image files owned by one question, including nested sub-questions. */
export function collectQuestionImagePaths(
  question: Question,
  into: Set<string> = new Set(),
): Set<string> {
  if (!question || typeof question !== "object") return into;
  for (const figure of objectList<{ image_path?: string | null }>(question.figures)) {
    addPath(into, figure.image_path);
  }
  for (const option of objectList<{ image_path?: string | null }>(question.options)) {
    addPath(into, option.image_path);
  }
  for (const sub of objectList<Question>(question.sub_questions)) {
    collectQuestionImagePaths(sub, into);
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

  const currentFigures = question.figures ?? [];
  const currentOptions = question.options ?? [];
  const currentSubs = question.sub_questions ?? [];
  const figures = currentFigures.filter(
    (figure) => normalizeStoredImagePath(figure.image_path) !== target,
  );
  const options = currentOptions.map((option) =>
    normalizeStoredImagePath(option.image_path) === target
      ? { ...option, image_path: null, image_description: null }
      : option,
  );
  const sub_questions = currentSubs.map((sub) => detachImagePath(sub, target));

  const figuresChanged = figures.length !== currentFigures.length;
  const optionsChanged = options.some((option, index) => option !== currentOptions[index]);
  const subsChanged = sub_questions.some((sub, index) => sub !== currentSubs[index]);
  if (!figuresChanged && !optionsChanged && !subsChanged) return question;
  return { ...question, figures, options, sub_questions };
}

/** Drop a choice and its option-only crop when no remaining choice still uses that file. */
export function questionWithoutOption(question: Question, index: number): Question {
  const removed = question.options?.[index];
  if (!removed) return question;

  const options = question.options.filter((_, optionIndex) => optionIndex !== index);
  const answer_keys = (question.answer_keys ?? []).filter((key) => key !== removed.key);
  const removedPath = normalizeStoredImagePath(removed.image_path);
  const removedToken = optionToken(removed.key);
  const figures = (question.figures ?? []).filter((figure) => {
    if (figure.role !== "option_figure") return true;
    const figurePath = normalizeStoredImagePath(figure.image_path);
    const captionToken = optionToken(figure.caption);
    const linkedByPath = removedPath != null && figurePath === removedPath;
    const linkedByCaption = removedToken.length > 0 && captionToken === removedToken;
    if (!linkedByPath && !linkedByCaption) return true;
    const keptByOption = options.some((option) => {
      if (figurePath && normalizeStoredImagePath(option.image_path) === figurePath) return true;
      return captionToken.length > 0 && optionToken(option.key) === captionToken;
    });
    return keptByOption;
  });

  return { ...question, options, answer_keys, figures };
}
