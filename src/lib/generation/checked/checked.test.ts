import { describe, expect, test } from "bun:test";

import {
  CHECKED_SKILL_IDS,
  generateCheckedQuestion,
  solveChecked,
  validateCheckedQuestion,
} from "@/lib/generation/checked/registry";
import { detectSkill } from "@/lib/generation/skill-detect";
import { runGenerationItem } from "@/lib/generation/orchestrator";
import { buildFromSourceUserPrompt } from "@/lib/mock-paper";
import { emptyQuestion } from "@/lib/question-schema";
import { toSourceQuestionRecord } from "@/lib/source/source-record";
import { createMemoryAssetStore } from "@/lib/assets/store";

const now = "2026-10-04T00:00:00.000Z";

describe("checked skill generators", () => {
  test("every checked skill solves to the marked option", () => {
    for (const skill of CHECKED_SKILL_IDS) {
      for (const grade of [5, 8]) {
        for (const step of [0, 1]) {
          const question = generateCheckedQuestion({
            skill,
            seedKey: `${skill}:${grade}:${step}`,
            questionId: `${skill}-${grade}-${step}`,
            number: "1",
            grade,
            difficultyStep: step,
          });
          const solved = question.math_spec ? solveChecked(question.math_spec) : null;
          expect(solved, skill).toBeTruthy();
          expect(validateCheckedQuestion(question, now).status, `${skill} g${grade} s${step}`).toBe(
            "passed",
          );
        }
      }
    }
  });

  test("a changed option fails the solver", () => {
    const question = generateCheckedQuestion({
      skill: "percentage",
      seedKey: "percentage-wrong",
      questionId: "q-percent",
      number: "1",
      grade: 5,
    });
    const wrong = {
      ...question,
      options: question.options.map((option) =>
        option.is_correct ? { ...option, text: "99999" } : option,
      ),
    };
    expect(validateCheckedQuestion(wrong, now).status).toBe("failed");
  });

  test("a wrong marked clock direction fails", () => {
    const question = generateCheckedQuestion({
      skill: "clock_direction",
      seedKey: "clock-wrong",
      questionId: "q-clock",
      number: "1",
      grade: 5,
    });
    const wrong = {
      ...question,
      options: question.options.map((option) =>
        option.is_correct ? { ...option, text: "Nowhere" } : option,
      ),
    };
    expect(validateCheckedQuestion(wrong, now).status).toBe("failed");
  });

  test("a topic drill tag selects that skill and the orchestrator checks it", async () => {
    expect(detectSkill({ instructions: "[skill:ranking]\nWrite a ranking question." })).toBe(
      "ranking",
    );
    const result = await runGenerationItem({
      jobId: "job-ranking",
      sequence: 0,
      documentId: "doc-ranking",
      instructions: "[skill:ranking]\nIn a row of students, find the position from the right.",
      number: "1",
      grade: 8,
      difficultyStep: 1,
      assetStore: createMemoryAssetStore(),
      now,
    });
    expect(result.question.skill_type).toBe("ranking");
    expect(result.question.validation?.status).toBe("passed");
    expect(result.question.difficulty).toBe("hard");
  });

  test("author instructions are sent with each source question and replace the checked generator", async () => {
    const source = emptyQuestion({
      id: "src-profit",
      type: "mcq",
      stem: "A shopkeeper buys a pen for Rs 20 and sells it for Rs 25. Find the profit.",
    });
    const prompt = buildFromSourceUserPrompt({
      sourceQuestion: source,
      index: 0,
      total: 3,
      authorInstructions: "Use a fruit-seller story and prices in rupees.",
    });
    expect(prompt).toContain("ADDITIONAL INSTRUCTIONS");
    expect(prompt).toContain("fruit-seller");

    let legacyCalls = 0;
    const result = await runGenerationItem({
      jobId: "job-notes",
      sequence: 0,
      documentId: "doc-notes",
      number: "1",
      authorInstructions: "Use a fruit-seller story and prices in rupees.",
      source: toSourceQuestionRecord({ documentId: "source-doc", question: source }),
      assetStore: createMemoryAssetStore(),
      callLegacyModel: async () => {
        legacyCalls += 1;
        return emptyQuestion({
          id: "legacy-profit",
          type: "mcq",
          stem: "A fruit seller buys mangoes for Rs 40 and sells them for Rs 55. What is the profit?",
          options: [{ key: "A", text: "Rs 15", is_correct: true }],
          answer_keys: ["A"],
        });
      },
      now,
    });
    expect(legacyCalls).toBe(1);
    expect(result.question.stem).toContain("fruit seller");
    expect(result.question.validation?.status).toBe("needs_review");
  });
});
