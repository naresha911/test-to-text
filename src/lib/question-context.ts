import type { Question } from "@/lib/question-schema";

/** Audience-aware extras for the solution model (exam level, subject cues). */
export type SolutionAudience = {
  subject?: string | null;
  exam?: string | null;
  notes?: string | null;
};

/** System message sent with every hint/solution request. */
export const SOLUTION_SYSTEM_PROMPT = `You are an expert exam tutor. Given one structured question (already reviewed by a human), you write a learner hint and a full solution.

RULES
1. HINT: a short nudge only. Point toward the method or a key idea. NEVER state the final answer, correct option letter, numeric result, or true/false value.
2. EXPLANATION (solution): a full worked solution with clear reasoning suited to the exam audience (school / board / competitive as indicated). Use step-by-step language a student can follow. End with the final answer clearly labelled.
3. Mathematics, chemistry and logic notation MUST be LaTeX: inline $...$ and display $$...$$.
4. Use every relevant context provided (passage for comprehension, assertion/reason, options, figure descriptions, match columns). Do not invent a different question.
5. Fill missing answer fields when you can determine them:
   - MCQ / multi_select: answer_keys (option keys) and options[].is_correct
   - true_false: answer_boolean
   - fill_blank: blanks[] in order
   - short_answer / long_answer / numerical: answer_text
   - match_the_following: match_pairs with completed right sides when solvable
6. If the stem or options look OCR-garbled, still solve the intended question from context, but do NOT return a rewritten stem — the human editor owns the text.
7. Return ONLY JSON. No prose, no markdown fences.

OUTPUT SHAPE
{"hint":"...","explanation":"...","answer_keys":["A"],"answer_text":null,"answer_boolean":null,"options":[{"key":"A","text":"...","is_correct":true}],"blanks":[],"match_pairs":[{"left":"...","right":"..."}]}`;

/**
 * Build the typed prompt payload for hint/solution generation.
 * Comprehension subs must receive the shared passage via `parentPassage`.
 */
export function buildQuestionPromptPayload(
  question: Question,
  options: { parentPassage?: string | null; audience?: SolutionAudience } = {},
): string {
  const lines: string[] = [];
  const { audience, parentPassage } = options;

  if (audience?.exam) lines.push(`Exam / level: ${audience.exam}`);
  if (audience?.subject) lines.push(`Subject: ${audience.subject}`);
  if (audience?.notes) lines.push(`Paper notes: ${audience.notes}`);

  lines.push(`Question type: ${question.type}`);
  if (question.number) lines.push(`Question number: ${question.number}`);
  if (question.marks != null) lines.push(`Marks: ${question.marks}`);
  if (question.section) lines.push(`Section: ${question.section}`);
  if (question.instructions) lines.push(`Instructions: ${question.instructions}`);

  const passage = parentPassage ?? question.passage;
  if (passage) {
    lines.push("");
    lines.push("Shared passage / context (required for this item):");
    lines.push(passage);
  }

  if (question.stem) {
    lines.push("");
    lines.push("Stem:");
    lines.push(question.stem);
  }

  if (question.type === "assertion_reason") {
    if (question.assertion) {
      lines.push("");
      lines.push("Assertion:");
      lines.push(question.assertion);
    }
    if (question.reason) {
      lines.push("");
      lines.push("Reason:");
      lines.push(question.reason);
    }
  }

  if (question.options.length) {
    lines.push("");
    lines.push("Options:");
    for (const option of question.options) {
      lines.push(`${option.key}. ${option.text}`);
    }
  }

  if (question.type === "fill_blank" || question.blanks.length) {
    lines.push("");
    lines.push(
      question.blanks.length
        ? `Blanks (${question.blanks.length}): ${question.blanks
            .map((b, i) => `${i + 1}=${b || "(empty)"}`)
            .join("; ")}`
        : "Blanks: answers not printed — supply them in the response.",
    );
  }

  if (question.type === "match_the_following" || question.match_pairs.length) {
    lines.push("");
    lines.push("Match the following:");
    for (const [index, pair] of question.match_pairs.entries()) {
      lines.push(`${index + 1}. Left: ${pair.left} | Right: ${pair.right || "(unmatched)"}`);
    }
  }

  if (question.figures.length) {
    lines.push("");
    lines.push("Figures (text descriptions — use these; there is no image):");
    for (const [index, figure] of question.figures.entries()) {
      const caption = figure.caption ? ` Caption: ${figure.caption}` : "";
      lines.push(`${index + 1}. ${figure.description}${caption}`);
    }
  }

  if (question.answer_keys.length) {
    lines.push("");
    lines.push(`Printed answer keys (may be incomplete): ${question.answer_keys.join(", ")}`);
  }
  if (question.answer_text) {
    lines.push(`Printed answer text: ${question.answer_text}`);
  }
  if (question.answer_boolean != null) {
    lines.push(`Printed true/false answer: ${question.answer_boolean}`);
  }
  if (question.explanation) {
    lines.push("");
    lines.push("Existing explanation/solution (refine only if regenerating):");
    lines.push(question.explanation);
  }
  if (question.hint) {
    lines.push("");
    lines.push("Existing hint:");
    lines.push(question.hint);
  }

  return lines.join("\n").trim();
}

/** User message for one hint/solution request. Includes the question details. */
export function buildSolutionUserPrompt(
  question: Question,
  options: { parentPassage?: string | null; audience?: SolutionAudience; force?: boolean } = {},
): string {
  const verb = options.force ? "Regenerate" : "Generate";
  const payload = buildQuestionPromptPayload(question, {
    ...(options.parentPassage !== undefined ? { parentPassage: options.parentPassage } : {}),
    ...(options.audience ? { audience: options.audience } : {}),
  });
  return `${verb} hint and solution for this question.\n\n${payload}`;
}

/** True when the question has a determined right answer. A passage set needs every sub-question. */
export function questionHasAnswer(question: Question): boolean {
  switch (question.type) {
    case "true_false":
      return question.answer_boolean != null;
    case "fill_blank":
      return question.blanks.some((blank) => blank.trim().length > 0);
    case "match_the_following":
      return (
        question.match_pairs.length > 0 &&
        question.match_pairs.every((pair) => pair.right.trim().length > 0)
      );
    case "short_answer":
    case "long_answer":
    case "numerical":
      return Boolean(question.answer_text?.trim());
    case "comprehension":
      return (
        question.sub_questions.length > 0 &&
        question.sub_questions.every((sub) => questionHasAnswer(sub))
      );
    case "mcq":
    case "multi_select":
    case "assertion_reason":
      return (
        question.answer_keys.some((key) => key.trim().length > 0) ||
        question.options.some((option) => option.is_correct === true)
      );
    default:
      return (
        question.answer_keys.some((key) => key.trim().length > 0) ||
        question.options.some((option) => option.is_correct === true) ||
        Boolean(question.answer_text?.trim()) ||
        question.answer_boolean != null
      );
  }
}

/** Ids that still have no right answer. Comprehension returns the incomplete sub-questions. */
export function missingAnswerIds(question: Question | undefined): string[] {
  if (!question) return [];
  if (question.type === "comprehension" && question.sub_questions.length) {
    return question.sub_questions.flatMap((sub) => missingAnswerIds(sub));
  }
  return questionHasAnswer(question) ? [] : [question.id];
}

/** True when a hint, a solution, or a right answer is still missing. */
export function solutionIncomplete(question: Question): boolean {
  if (question.type === "comprehension" && question.sub_questions.length) {
    return question.sub_questions.some((sub) => solutionIncomplete(sub));
  }
  return !question.hint?.trim() || !question.explanation?.trim() || !questionHasAnswer(question);
}

/** Questions that should receive their own hint/solution when a parent is approved. */
export function targetsForHintSolution(question: Question): Array<{
  question: Question;
  parentPassage?: string | null;
}> {
  if (question.type === "comprehension" && question.sub_questions.length) {
    return question.sub_questions.map((sub) => ({
      question: sub,
      parentPassage: question.passage ?? null,
    }));
  }
  return [{ question }];
}

/** True when hint, solution, or a right answer still needs an AI fill. */
export function needsHintOrSolution(question: Question): boolean {
  return solutionIncomplete(question);
}
