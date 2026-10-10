import { describe, expect, test } from "bun:test";

import {
  assessStructure,
  hasDeterministicOracle,
  isCopiedText,
  parseJudgeVerdict,
  scoreCase,
} from "@/lib/generation/calibration/judge";
import { emptyQuestion, type Question } from "@/lib/question-schema";
import type { JudgeVerdict, StructuralJudgement } from "@/lib/generation/calibration/types";

function mcq(partial: Partial<Question>): Question {
  return emptyQuestion({
    id: crypto.randomUUID(),
    type: "mcq",
    stem: "Find the next number: 2, 4, 6, 8, ?",
    options: ["A", "B", "C", "D"].map((key) => ({
      key,
      text: `option ${key}`,
      is_correct: key === "A",
    })),
    answer_keys: ["A"],
    difficulty: "easy",
    marks: 1,
    ...partial,
  });
}

const reference = mcq({ stem: "Find the next number: 3, 6, 9, 12, ?" });

describe("hasDeterministicOracle", () => {
  test("oracle skills are recognised", () => {
    expect(hasDeterministicOracle("number_series")).toBe(true);
    expect(hasDeterministicOracle("mirror_image")).toBe(true);
    expect(hasDeterministicOracle("grammar")).toBe(true);
    expect(hasDeterministicOracle("percentage")).toBe(true);
    expect(hasDeterministicOracle("idioms")).toBe(false);
  });
});

describe("isCopiedText", () => {
  test("identical and near-identical text is a copy", () => {
    expect(isCopiedText("Find the next number: 3, 6, 9", "Find the next number: 3, 6, 9")).toBe(
      true,
    );
    expect(isCopiedText("Find the next number: 3, 6, 9, 12", "Find the next number: 3, 6, 9")).toBe(
      true,
    );
  });

  test("a rewritten stem is not a copy", () => {
    expect(
      isCopiedText("What comes next: 5, 10, 20, 40, ?", "Find the next number: 3, 6, 9, 12, ?"),
    ).toBe(false);
  });
});

describe("assessStructure", () => {
  test("a valid generated question passes", () => {
    const generated = mcq({
      skill_type: "number_series",
      options: [
        { key: "A", text: "14", is_correct: true },
        { key: "B", text: "10", is_correct: false },
        { key: "C", text: "12", is_correct: false },
        { key: "D", text: "18", is_correct: false },
      ],
    });
    const structural = assessStructure({ generated, reference, skill: "number_series" });
    expect(structural.passed).toBe(true);
    expect(structural.notes.length).toBe(0);
  });

  test("one shared short option is not a copy", () => {
    const generated = mcq({
      skill_type: "number_series",
      options: [
        { key: "A", text: "14", is_correct: true },
        { key: "B", text: "option B", is_correct: false },
        { key: "C", text: "12", is_correct: false },
        { key: "D", text: "18", is_correct: false },
      ],
    });
    const structural = assessStructure({ generated, reference, skill: "number_series" });
    expect(structural.copied_reference).toBe(false);
    expect(structural.passed).toBe(true);
  });

  test("two or more copied options fail as a copy", () => {
    const generated = mcq({
      skill_type: "number_series",
      options: [
        { key: "A", text: "option A", is_correct: true },
        { key: "B", text: "option B", is_correct: false },
        { key: "C", text: "12", is_correct: false },
        { key: "D", text: "18", is_correct: false },
      ],
    });
    const structural = assessStructure({ generated, reference, skill: "number_series" });
    expect(structural.copied_reference).toBe(true);
    expect(structural.passed).toBe(false);
  });

  test("a copied stem fails even when otherwise valid", () => {
    const generated = mcq({ skill_type: "number_series", stem: reference.stem });
    const structural = assessStructure({ generated, reference, skill: "number_series" });
    expect(structural.copied_reference).toBe(true);
    expect(structural.passed).toBe(false);
  });

  test("a question with no answer fails", () => {
    const generated = mcq({ skill_type: "number_series", answer_keys: [] });
    const structural = assessStructure({ generated, reference, skill: "number_series" });
    expect(structural.has_answers).toBe(false);
    expect(structural.passed).toBe(false);
  });

  test("a wrong option count fails", () => {
    const generated = mcq({
      skill_type: "number_series",
      options: [
        { key: "A", text: "a", is_correct: true },
        { key: "B", text: "b", is_correct: false },
      ],
    });
    const structural = assessStructure({ generated, reference, skill: "number_series" });
    expect(structural.option_count_ok).toBe(false);
    expect(structural.passed).toBe(false);
  });
});

describe("parseJudgeVerdict", () => {
  test("parses a fenced JSON verdict", () => {
    const verdict = parseJudgeVerdict(
      '```json\n{"equivalent":true,"skill_match":4,"difficulty_match":3,"answerable":true,"past_paper_like":5,"reasons":["ok"]}\n```',
    );
    expect(verdict?.equivalent).toBe(true);
    expect(verdict?.skill_match).toBe(4);
    expect(verdict?.past_paper_like).toBe(5);
    expect(Math.round((verdict?.judge_score ?? 0) * 15)).toBe(12);
  });

  test("returns null for unreadable output", () => {
    expect(parseJudgeVerdict("no json here")).toBeNull();
  });
});

describe("scoreCase", () => {
  const passed: StructuralJudgement = {
    schema_valid: true,
    has_answers: true,
    option_count_ok: true,
    skill_match: true,
    copied_reference: false,
    oracle_passed: true,
    marks_sane: true,
    difficulty_match: true,
    passed: true,
    notes: [],
  };

  test("an oracle skill passes on a clean check", () => {
    expect(scoreCase({ structural: passed, judge: null, oracleSkill: true }).passed).toBe(true);
    expect(scoreCase({ structural: passed, judge: null, oracleSkill: true }).score).toBe(1);
  });

  test("an oracle skill fails when the solver rejects the answer", () => {
    const failed = { ...passed, oracle_passed: false };
    expect(scoreCase({ structural: failed, judge: null, oracleSkill: true }).passed).toBe(false);
  });

  test("a judge skill passes on a strong verdict", () => {
    const verdict: JudgeVerdict = {
      equivalent: true,
      skill_match: 5,
      difficulty_match: 4,
      answerable: true,
      past_paper_like: 5,
      reasons: [],
      judge_score: 14 / 15,
      model: null,
    };
    expect(scoreCase({ structural: passed, judge: verdict, oracleSkill: false }).passed).toBe(true);
  });

  test("a judge skill fails when generation copies the reference", () => {
    const copied = { ...passed, copied_reference: true, passed: false };
    const verdict: JudgeVerdict = {
      equivalent: true,
      skill_match: 5,
      difficulty_match: 5,
      answerable: true,
      past_paper_like: 5,
      reasons: [],
      judge_score: 1,
      model: null,
    };
    expect(scoreCase({ structural: copied, judge: verdict, oracleSkill: false }).passed).toBe(
      false,
    );
  });
});
