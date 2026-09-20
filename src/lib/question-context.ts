import type { Question } from "@/lib/question-schema";

/** Audience-aware extras for the solution model (exam level, subject cues). */
export type SolutionAudience = {
  subject?: string | null;
  exam?: string | null;
  notes?: string | null;
};

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

/** True when hint or solution still needs an AI fill (missing only). */
export function needsHintOrSolution(question: Question): boolean {
  if (question.type === "comprehension" && question.sub_questions.length) {
    return question.sub_questions.some((sub) => !sub.hint?.trim() || !sub.explanation?.trim());
  }
  return !question.hint?.trim() || !question.explanation?.trim();
}
