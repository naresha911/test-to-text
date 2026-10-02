import { describe, expect, test } from "bun:test";

import {
  collectQuestionsImagePaths,
  detachImagePath,
  droppedImagePaths,
  normalizeStoredImagePath,
  questionWithoutOption,
} from "@/lib/question-images";
import { emptyQuestion, type Question } from "@/lib/question-schema";

function question(partial: Partial<Question> & { id: string }): Question {
  return emptyQuestion(partial);
}

describe("stored image paths", () => {
  test("accepts document-relative figure and generated files", () => {
    expect(normalizeStoredImagePath("doc-1/p1-fig-1-1.jpg")).toBe("doc-1/p1-fig-1-1.jpg");
    expect(normalizeStoredImagePath("doc-1/generated/q-1/a1b2c3d4.svg")).toBe(
      "doc-1/generated/q-1/a1b2c3d4.svg",
    );
  });

  test("rejects traversal, absolute paths, and the asset manifest", () => {
    expect(normalizeStoredImagePath("../secret.jpg")).toBeNull();
    expect(normalizeStoredImagePath("doc-1/../../secret.jpg")).toBeNull();
    expect(normalizeStoredImagePath("/tmp/secret.jpg")).toBeNull();
    expect(normalizeStoredImagePath("C:/secret.jpg")).toBeNull();
    expect(normalizeStoredImagePath("doc-1\\fig.jpg")).toBeNull();
    expect(normalizeStoredImagePath("doc-1/_manifest.json")).toBeNull();
    expect(normalizeStoredImagePath("")).toBeNull();
  });
});

describe("question image cleanup", () => {
  test("collects nested figure and option files once", () => {
    const parent = question({
      id: "parent",
      figures: [{ description: "Diagram", image_path: "doc/p1-fig-1.jpg" }],
      options: [{ key: "A", text: "A", image_path: "doc/p1-fig-1.jpg" }],
      sub_questions: [
        question({
          id: "child",
          figures: [{ description: "Inset", image_path: "doc/generated/child/a.svg" }],
          options: [{ key: "B", text: "B", image_path: "doc/opt-b.jpg" }],
        }),
      ],
    });

    expect([...collectQuestionsImagePaths([parent])].sort()).toEqual([
      "doc/generated/child/a.svg",
      "doc/opt-b.jpg",
      "doc/p1-fig-1.jpg",
    ]);
  });

  test("detaching an image removes the figure row and the option link", () => {
    const original = question({
      id: "q",
      figures: [
        { description: "Keep", image_path: "doc/keep.jpg" },
        { description: "Question figure", image_path: "doc/gone.jpg", role: "question_figure" },
      ],
      options: [{ key: "A", text: "Choice", image_path: "doc/gone.jpg", image_description: "pic" }],
      sub_questions: [
        question({
          id: "sub",
          figures: [{ description: "Nested", image_path: "doc/gone.jpg" }],
        }),
      ],
    });

    const next = detachImagePath(original, "doc/gone.jpg");

    expect(original.figures).toHaveLength(2);
    expect(next.figures.map((figure) => figure.image_path)).toEqual(["doc/keep.jpg"]);
    expect(next.options[0]).toMatchObject({
      text: "Choice",
      image_path: null,
      image_description: null,
    });
    expect(next.sub_questions[0]?.figures).toEqual([]);
  });

  test("a sibling that still uses the file is not treated as dropped", () => {
    const before = [
      question({ id: "a", figures: [{ description: "Shared", image_path: "doc/shared.jpg" }] }),
      question({ id: "b", figures: [{ description: "Shared", image_path: "doc/shared.jpg" }] }),
    ];
    const after = [before[1]!];

    expect(droppedImagePaths(before, after)).toEqual([]);
  });

  test("removing a question drops images that nobody else uses", () => {
    const before = [
      question({
        id: "a",
        figures: [{ description: "Only here", image_path: "doc/only.jpg" }],
        sub_questions: [
          question({
            id: "a1",
            options: [{ key: "A", text: "A", image_path: "doc/generated/a/opt.svg" }],
          }),
        ],
      }),
      question({ id: "b", figures: [{ description: "Stays", image_path: "doc/stay.jpg" }] }),
    ];

    expect(droppedImagePaths(before, [before[1]!]).sort()).toEqual([
      "doc/generated/a/opt.svg",
      "doc/only.jpg",
    ]);
  });

  test("deleting a choice removes its option crop and keeps a shared question figure", () => {
    const original = question({
      id: "q",
      figures: [
        { description: "Stem", image_path: "doc/stem.jpg", role: "question_figure" },
        { description: "A", image_path: "doc/a.jpg", role: "option_figure", caption: "A" },
      ],
      options: [
        { key: "A", text: "A", image_path: "doc/a.jpg" },
        { key: "B", text: "B", image_path: "doc/stem.jpg" },
      ],
      answer_keys: ["A", "B"],
    });

    const withoutA = questionWithoutOption(original, 0);
    expect(withoutA.options.map((option) => option.key)).toEqual(["B"]);
    expect(withoutA.answer_keys).toEqual(["B"]);
    expect(withoutA.figures.map((figure) => figure.image_path)).toEqual(["doc/stem.jpg"]);

    const withoutB = questionWithoutOption(original, 1);
    expect(withoutB.figures.map((figure) => figure.image_path)).toEqual([
      "doc/stem.jpg",
      "doc/a.jpg",
    ]);
  });
});
