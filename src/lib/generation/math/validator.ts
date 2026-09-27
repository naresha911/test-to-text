import { emptyQuestion, type Question } from "@/lib/question-schema";
import {
  combineValidation,
  type ValidationCheck,
  type ValidationResult,
} from "@/lib/generation/validation-types";
import { isNumberSeriesSpec } from "@/lib/generation/math/spec";
import { solveNumberSeries } from "@/lib/generation/math/solver";

function claimedAnswer(question: Question): number | null {
  const key =
    question.answer_keys[0] ??
    question.options.find((option) => option.is_correct === true)?.key ??
    null;
  if (!key) return null;
  const option = question.options.find((item) => item.key === key);
  if (!option) return null;
  const value = Number(option.text.trim());
  return Number.isInteger(value) ? value : null;
}

export function validateNumberSeriesQuestion(
  question: Question,
  createdAt?: string,
): ValidationResult {
  const checks: ValidationCheck[] = [];
  if (!isNumberSeriesSpec(question.math_spec)) {
    checks.push({
      name: "math",
      status: "failed" as const,
      details: "Number series is missing a typed rule.",
    });
    return combineValidation(checks, createdAt);
  }

  const spec = question.math_spec;
  let solved: number | null = null;
  try {
    solved = solveNumberSeries(spec.rule, spec.visible_terms);
    checks.push({
      name: "math",
      status: "passed" as const,
      details: `Solver next term is ${solved}.`,
    });
  } catch (error) {
    checks.push({
      name: "math",
      status: "failed" as const,
      details: error instanceof Error ? error.message : "The series rule could not be solved.",
    });
  }

  const claimed = claimedAnswer(question);
  if (solved == null) {
    checks.push({
      name: "answer",
      status: "skipped" as const,
      details: "No solved value to compare.",
    });
  } else if (claimed !== solved) {
    checks.push({
      name: "answer",
      status: "failed" as const,
      details: `Marked answer ${claimed ?? "missing"} does not match the solver value ${solved}.`,
    });
  } else {
    checks.push({
      name: "answer",
      status: "passed" as const,
      details: "Marked answer matches the solver.",
    });
  }

  const optionCount = question.options.length === 4;
  checks.push({
    name: "schema",
    status: optionCount && question.stem.trim() ? ("passed" as const) : ("failed" as const),
    details: optionCount
      ? "Series question has a stem and four options."
      : "Series question needs four options.",
  });

  return combineValidation(checks, createdAt);
}
