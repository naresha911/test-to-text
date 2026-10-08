import { describe, expect, test } from "bun:test";

import type { DocumentMeta } from "@/lib/document-types";
import { buildExamPrepExport } from "@/lib/exam-prep-export";
import { buildPushPlan } from "@/lib/exam-prep/push-plan";
import { emptyQuestion } from "@/lib/question-schema";

const FIGURE_SVG = '<svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8"/></svg>';
const OPTION_SVG = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

const document = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Diagram mock",
  kind: "ai_mock",
  standard_id: 5,
  created_at: "2026-10-07T00:00:00.000Z",
  updated_at: "2026-10-07T00:00:00.000Z",
} as unknown as DocumentMeta;

function diagramQuestion() {
  return emptyQuestion({
    id: "22222222-2222-2222-2222-222222222222",
    number: "1",
    type: "mcq",
    stem: "Which figure comes next?",
    figures: [{ description: "A row of frames.", svg: FIGURE_SVG }],
    options: [
      { key: "A", text: "", svg: OPTION_SVG, is_correct: true },
      { key: "B", text: "" },
    ],
    answer_keys: ["A"],
  });
}

describe("exam-prep export keeps figure SVG text", () => {
  test("writes diagram_svg and option_svg into the export rows", () => {
    const payload = buildExamPrepExport(document, [diagramQuestion()]);

    const question = payload.tables.questions[0] as Record<string, unknown>;
    expect(question["diagram_svg"]).toBe(FIGURE_SVG);
    expect(question["diagram_path"]).toBeNull();

    const options = payload.tables.option_translations as Record<string, unknown>[];
    expect(options[0]?.["option_svg"]).toBe(OPTION_SVG);
  });

  test("the push plan passes the SVG text through instead of nulling it", () => {
    const plan = buildPushPlan(buildExamPrepExport(document, [diagramQuestion()]));

    expect(plan.units[0]?.question["diagram_svg"]).toBe(FIGURE_SVG);
    expect(plan.units[0]?.question["diagram_path"]).toBeNull();
    expect(plan.units[0]?.optionTranslations[0]?.["option_svg"]).toBe(OPTION_SVG);
  });
});
