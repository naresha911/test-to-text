import type { Question } from "@/lib/question-schema";
import {
  combineValidation,
  type ValidationCheck,
  type ValidationResult,
} from "@/lib/generation/validation-types";

function correctCount(question: Question): number {
  const keyed = new Set(question.answer_keys);
  const marked = question.options.filter(
    (option) => option.is_correct === true || keyed.has(option.key),
  );
  return new Set(marked.map((option) => option.key)).size;
}

/** Eight-word phrases are distinctive. Short classroom phrases are ignored. */
export function copiesDistinctivePhrase(source: string, generated: string): boolean {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const left = normalize(source);
  const right = normalize(generated);
  const words = left.split(" ").filter(Boolean);
  if (words.length < 8 || right.length < 40) return false;
  for (let index = 0; index <= words.length - 8; index += 1) {
    const phrase = words.slice(index, index + 8).join(" ");
    if (phrase.length >= 24 && right.includes(phrase)) return true;
  }
  return false;
}

export function validateGrammarQuestion(
  question: Question,
  sourceStem?: string | null,
  createdAt?: string,
): ValidationResult {
  const optionCount = question.options.length;
  const answers = correctCount(question);
  const checks: ValidationCheck[] = [
    {
      name: "schema",
      status:
        question.type === "mcq" && question.stem.trim() ? ("passed" as const) : ("failed" as const),
      details: question.stem.trim()
        ? "Grammar item has a stem."
        : "Grammar item is missing a stem.",
    },
    {
      name: "options",
      status: optionCount === 4 ? ("passed" as const) : ("failed" as const),
      details: optionCount === 4 ? "Four options." : `Expected 4 options, found ${optionCount}.`,
    },
    {
      name: "answer",
      status: answers === 1 ? ("passed" as const) : ("failed" as const),
      details: answers === 1 ? "One answer is marked." : `Expected one answer, found ${answers}.`,
    },
  ];

  if (sourceStem?.trim()) {
    const copied = copiesDistinctivePhrase(sourceStem, question.stem);
    checks.push({
      name: "originality",
      status: copied ? ("needs_review" as const) : ("passed" as const),
      details: copied
        ? "The stem repeats a long phrase from the source."
        : "No long copied phrase detected.",
    });
  } else {
    checks.push({
      name: "originality",
      status: "skipped",
      details: "No source stem to compare.",
    });
  }

  return combineValidation(checks, createdAt);
}
