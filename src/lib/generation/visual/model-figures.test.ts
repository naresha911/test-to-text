import { describe, expect, test } from "bun:test";

import { createMemoryAssetStore } from "@/lib/assets/store";
import { attachModelFigures } from "@/lib/generation/visual/model-figures";
import { emptyQuestion } from "@/lib/question-schema";

const SQUARE = '<svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8"/></svg>';
const CIRCLE = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
const SQUARE_SVG =
  '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect x="1" y="1" width="8" height="8"/></svg>';
const CIRCLE_SVG =
  '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>';

describe("attachModelFigures", () => {
  test("keeps the drawing as svg text and points image_path at the stored file", async () => {
    const store = createMemoryAssetStore();
    const question = emptyQuestion({
      id: "q1",
      figures: [{ description: "A square.", svg: SQUARE }],
    });

    const next = await attachModelFigures({ question, store, documentId: "doc" });

    const figure = next.figures[0];
    expect(figure?.svg).toBe(SQUARE_SVG);
    expect(figure?.image_path).toStartWith("doc/generated/q1/");
    expect(figure?.generation_method).toBe("svg");
    expect(store.snapshot()).toHaveLength(1);
  });

  test("keeps an answer-option drawing and its description", async () => {
    const store = createMemoryAssetStore();
    const question = emptyQuestion({
      id: "q2",
      options: [{ key: "A", text: "", image_description: "A circle.", svg: CIRCLE }],
    });

    const next = await attachModelFigures({ question, store, documentId: "doc" });

    expect(next.options[0]?.svg).toBe(CIRCLE_SVG);
    expect(next.options[0]?.image_path).toStartWith("doc/generated/q2/");
    expect(next.options[0]?.image_description).toBe("A circle.");
    expect(store.snapshot()).toHaveLength(1);
  });

  test("sanitizes a drawing before keeping it", async () => {
    const store = createMemoryAssetStore();
    const question = emptyQuestion({
      id: "q3",
      figures: [
        {
          description: "A square.",
          svg: '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect/></svg>',
        },
      ],
    });

    const next = await attachModelFigures({ question, store, documentId: "doc" });

    expect(next.figures[0]?.svg).toContain("<svg");
    expect(next.figures[0]?.svg).not.toContain("script");
  });

  test("drops an oversized drawing and leaves the figure description-only", async () => {
    const store = createMemoryAssetStore();
    const question = emptyQuestion({
      id: "q4",
      figures: [{ description: "A square.", svg: `<svg>${"a".repeat(200_001)}</svg>` }],
    });

    const next = await attachModelFigures({ question, store, documentId: "doc" });

    expect(next.figures[0]?.svg).toBeNull();
    expect(next.figures[0]?.image_path).toBeUndefined();
    expect(store.snapshot()).toHaveLength(0);
    expect(next).not.toBe(question);
  });

  test("keeps figures the model described without a drawing", async () => {
    const store = createMemoryAssetStore();
    const question = emptyQuestion({ id: "q5", figures: [{ description: "A square." }] });

    const next = await attachModelFigures({ question, store, documentId: "doc" });

    expect(next.figures[0]?.svg).toBeUndefined();
    expect(next).toBe(question);
  });

  test("recurses into comprehension sub-questions", async () => {
    const store = createMemoryAssetStore();
    const sub = emptyQuestion({ id: "sub1", figures: [{ description: "A square.", svg: SQUARE }] });
    const question = emptyQuestion({ id: "q6", sub_questions: [sub] });

    const next = await attachModelFigures({ question, store, documentId: "doc" });

    expect(next.sub_questions[0]?.figures[0]?.svg).toBe(SQUARE_SVG);
    expect(next.sub_questions[0]?.figures[0]?.image_path).toStartWith("doc/generated/sub1/");
  });
});
