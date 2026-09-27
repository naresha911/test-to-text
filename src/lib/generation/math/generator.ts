import { emptyQuestion, type JsonValue, type Question } from "@/lib/question-schema";

import { hashSeed } from "@/lib/generation/job-types";
import type { NumberSeriesRule, NumberSeriesSpec } from "@/lib/generation/math/spec";

function buildTerms(rule: NumberSeriesRule, start: number, count: number): number[] {
  const terms = [start];
  if (rule.kind === "difference_sequence") {
    let difference = rule.initial_difference;
    for (let index = 1; index < count; index += 1) {
      terms.push(terms[index - 1]! + difference);
      difference += rule.difference_delta;
    }
    return terms;
  }
  for (let index = 1; index < count; index += 1) {
    terms.push(terms[index - 1]! * rule.multiply + rule.add);
  }
  return terms;
}

function ruleForSeed(seed: number): NumberSeriesRule {
  if (seed % 2 === 0) {
    return {
      kind: "difference_sequence",
      initial_difference: 2 + (seed % 4),
      difference_delta: 1 + (seed % 3),
    };
  }
  return {
    kind: "multiply_add",
    multiply: 2,
    add: (seed % 5) - 1,
  };
}

function distractors(answer: number, seed: number): number[] {
  const candidates = [
    answer + 1 + (seed % 3),
    answer - (2 + (seed % 4)),
    answer + 4 + (seed % 5),
    answer * 2,
    answer + 10,
  ];
  const unique: number[] = [];
  for (const candidate of candidates) {
    if (candidate === answer || unique.includes(candidate)) continue;
    unique.push(candidate);
    if (unique.length === 3) break;
  }
  while (unique.length < 3) unique.push(answer + unique.length + 3);
  return unique;
}

export function generateNumberSeriesQuestion(options: {
  seedKey: string;
  questionId: string;
  number: string;
  sourceQuestionId?: string | null;
  jobId?: string | null;
}): { question: Question; spec: NumberSeriesSpec } {
  const seed = hashSeed(options.seedKey);
  const rule = ruleForSeed(seed);
  const start = 2 + (seed % 9);
  const terms = buildTerms(rule, start, 5);
  const visible = terms.slice(0, 4);
  const answer = terms[4]!;
  const choices = [answer, ...distractors(answer, seed)];
  const correctSlot = seed % 4;
  const ordered = choices.slice();
  const [correct] = ordered.splice(0, 1);
  ordered.splice(correctSlot, 0, correct!);
  const correctKey = String.fromCharCode(65 + correctSlot);
  const spec: NumberSeriesSpec = { kind: "number_series", rule, visible_terms: visible };
  const ruleText =
    rule.kind === "difference_sequence"
      ? `The gaps start at ${rule.initial_difference} and grow by ${rule.difference_delta}.`
      : `Each term is the previous term times ${rule.multiply}, then ${rule.add >= 0 ? "plus" : "minus"} ${Math.abs(rule.add)}.`;

  const question = emptyQuestion({
    id: options.questionId,
    number: options.number,
    type: "mcq",
    skill_type: "number_series",
    stem: `What is the next number in the series ${visible.join(", ")}, ___?`,
    options: ordered.map((value, index) => ({
      key: String.fromCharCode(65 + index),
      text: String(value),
      is_correct: index === correctSlot,
    })),
    answer_keys: [correctKey],
    hint: "Check how the gap between neighbouring terms changes.",
    explanation: `${ruleText} The next term is ${answer}.`,
    marks: 1,
    difficulty: "medium",
    tags: ["number_series"],
    approved: false,
    approval_status: "generated",
    math_spec: spec as unknown as { [key: string]: JsonValue },
    source_question_id: options.sourceQuestionId ?? null,
    generation_job_id: options.jobId ?? null,
    source: options.sourceQuestionId ?? "ai_mock",
  });

  return { question, spec };
}
