import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createFileAssetStore, createMemoryAssetStore } from "@/lib/assets/store";
import { sanitizeSvg } from "@/lib/assets/svg-sanitize";
import type { DocumentMeta } from "@/lib/document-types";
import { parseMockGeneration } from "@/lib/document-types";
import { buildExamPrepExport } from "@/lib/exam-prep-export";
import { emptyGenerationItem } from "@/lib/generation/job-types";
import { generateNumberSeriesQuestion } from "@/lib/generation/math/generator";
import { solveNumberSeries } from "@/lib/generation/math/solver";
import { validateNumberSeriesQuestion } from "@/lib/generation/math/validator";
import { runGenerationItem } from "@/lib/generation/orchestrator";
import { mirrorOptionSvgs, redrawMirrorFigure } from "@/lib/generation/visual/assets";
import { inventMirrorSpec } from "@/lib/generation/visual/mirror-image";
import { validateMirrorSvgs } from "@/lib/generation/visual/oracle";
import { GenerationSchema } from "@/lib/local-store.functions";
import { emptyQuestion, normalizeQuestion } from "@/lib/question-schema";
import { isAutoGeneratable } from "@/lib/question-taxonomy";
import { toSourceQuestionRecord } from "@/lib/source/source-record";

const now = "2026-09-27T00:00:00.000Z";

function document(): DocumentMeta {
  return {
    id: "doc-1",
    kind: "ai_mock",
    title: "Mock",
    year: null,
    standard_id: null,
    stream_id: null,
    subject_id: null,
    topic_id: null,
    duration_minutes: null,
    total_marks: 2,
    difficulty: null,
    exam: null,
    notes: null,
    source: null,
    description: null,
    section_timing: false,
    negative_marking: false,
    allow_pause: true,
    max_attempts: 1,
    default_marks: 1,
    default_negative_marks: 0,
    source_document_id: null,
    generation: null,
    questions_rev: 0,
    created_at: now,
    updated_at: now,
  };
}

function grammarOptions() {
  return ["A", "B", "C", "D"].map((key, index) => ({
    key,
    text: `Choice ${key}`,
    is_correct: index === 0,
  }));
}

describe("question schema", () => {
  test("old questions still parse without generation fields", () => {
    const question = normalizeQuestion(
      { type: "mcq", stem: "Hello", approved: true, options: [{ key: "A", text: "Yes" }] },
      0,
    );
    expect(question.approved).toBe(true);
    expect(question.approval_status).toBeNull();
    expect(question.skill_type).toBeNull();
    expect(question.options[0]?.image_path).toBeNull();
  });

  test("generated status wins over a stale approved flag", () => {
    const question = normalizeQuestion(
      { type: "mcq", stem: "New", approved: true, approval_status: "generated" },
      0,
    );
    expect(question.approved).toBe(false);
    expect(question.approval_status).toBe("generated");
  });
});

describe("taxonomy", () => {
  test("a skill runs only when its generator and validator are enabled", () => {
    expect(isAutoGeneratable("grammar")).toBe(true);
    expect(isAutoGeneratable("number_series")).toBe(true);
    expect(isAutoGeneratable("mirror_image")).toBe(true);
    expect(isAutoGeneratable("percentage")).toBe(true);
    expect(isAutoGeneratable("letter_series")).toBe(true);
    expect(isAutoGeneratable("counting_triangles")).toBe(false);
    expect(isAutoGeneratable("figure_series")).toBe(false);
    expect(isAutoGeneratable("general_knowledge")).toBe(false);
  });
});

describe("number series", () => {
  test("the solver agrees with a generated series and rejects a wrong answer", () => {
    const { question, spec } = generateNumberSeriesQuestion({
      seedKey: "series-seed",
      questionId: "q-series",
      number: "1",
    });
    const solved = solveNumberSeries(spec.rule, spec.visible_terms);
    expect(validateNumberSeriesQuestion(question, now).status).toBe("passed");
    const wrong = {
      ...question,
      options: question.options.map((option) =>
        option.is_correct ? { ...option, text: String(solved + 50) } : option,
      ),
    };
    expect(validateNumberSeriesQuestion(wrong, now).status).toBe("failed");
  });
});

describe("mirror image", () => {
  test("the keyed option matches an independent vertical reflection", () => {
    const spec = inventMirrorSpec("mirror-seed");
    const svgs = mirrorOptionSvgs(spec);
    const correct = svgs[spec.correct_key] ?? "";
    for (const element of spec.elements) {
      if (element.shape === "rect") {
        const reflectedX = spec.canvas.width - (element.x + element.w);
        expect(correct).toContain(`x="${reflectedX}"`);
      } else {
        expect(correct).toContain(`cx="${spec.canvas.width - element.cx}"`);
      }
    }
    expect(validateMirrorSvgs(spec, svgs, now).status).toBe("passed");
    const swapped = {
      ...svgs,
      [spec.correct_key]: svgs["A"] === correct ? svgs["B"]! : svgs["A"]!,
    };
    expect(validateMirrorSvgs(spec, swapped, now).status).toBe("failed");
  });

  test("redrawing the figure keeps the stem and answer", async () => {
    const spec = inventMirrorSpec("redraw-seed");
    const store = createMemoryAssetStore();
    const question = emptyQuestion({
      id: "mirror-q",
      stem: "Which option shows the exact vertical mirror image of the figure?",
      answer_keys: [spec.correct_key],
      visual_spec: spec as unknown as { [key: string]: import("@/lib/question-schema").JsonValue },
      options: ["A", "B", "C", "D"].map((key) => ({
        key,
        text: "",
        is_correct: key === spec.correct_key,
      })),
    });
    const redrawn = await redrawMirrorFigure({
      question,
      store,
      documentId: "doc-1",
      idempotencyKey: "job:0:generation",
    });
    expect(redrawn.id).toBe(question.id);
    expect(redrawn.stem).toBe(question.stem);
    expect(redrawn.answer_keys).toEqual(question.answer_keys);
    expect(redrawn.figures[0]?.image_path).toContain("/generated/");
  });
});

describe("svg and assets", () => {
  test("sanitizer removes scripts, handlers, and foreignObject", () => {
    const clean = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect onclick="alert(1)" x="1" y="1" width="2" height="2" fill="#111" /><foreignObject><div href="http://evil.example">x</div></foreignObject></svg>`,
    );
    expect(clean.toLowerCase()).not.toContain("script");
    expect(clean.toLowerCase()).not.toContain("onclick");
    expect(clean.toLowerCase()).not.toContain("foreignobject");
    expect(clean).toContain("<rect");
  });

  test("a repeated write does not duplicate an asset, and generated writes cannot replace source", async () => {
    const store = createMemoryAssetStore();
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const input = {
      asset_id: "asset-1",
      kind: "generated" as const,
      role: "question_figure" as const,
      mime_type: "image/svg+xml",
      bytes,
      document_id: "doc-1",
      question_id: "q-1",
      generation_method: "svg" as const,
    };
    const first = await store.put(input);
    const second = await store.put(input);
    expect(second.storage_key).toBe(first.storage_key);
    expect(store.snapshot()).toHaveLength(1);

    await store.put({
      ...input,
      asset_id: "source-1",
      kind: "source",
      role: "source_figure",
      question_id: null,
    });
    await expect(store.put({ ...input, asset_id: "source-1", kind: "generated" })).rejects.toThrow(
      /source asset/,
    );
  });

  test("file storage keeps generated bytes under the generated folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paperparse-assets-"));
    const store = createFileAssetStore(root);
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const saved = await store.put({
      asset_id: "file-1",
      kind: "generated",
      role: "question_figure",
      mime_type: "image/svg+xml",
      bytes,
      document_id: "doc-1",
      question_id: "q-1",
    });
    await store.put({
      asset_id: "file-1",
      kind: "generated",
      role: "question_figure",
      mime_type: "image/svg+xml",
      bytes,
      document_id: "doc-1",
      question_id: "q-1",
    });
    const folder = path.join(root, "doc-1", "generated", "q-1");
    const names = await readdir(folder);
    expect(names.filter((name) => name.endsWith(".svg"))).toEqual(["file-1.svg"]);
    expect(saved.storage_key).toBe("doc-1/generated/q-1/file-1.svg");
    expect(await store.get("file-1")).not.toBeNull();
  });
});

describe("generation orchestrator", () => {
  test("does not repeat a completed generation stage", async () => {
    const { question } = generateNumberSeriesQuestion({
      seedKey: "resume-seed",
      questionId: "kept-id",
      number: "2",
    });
    const item = emptyGenerationItem({ jobId: "job", sequence: 0, sourceQuestionId: "src-1" });
    item.completed_stages = ["analysis", "generation"];
    item.candidate_question_id = question.id;
    item.attempt_count = 1;
    let produced = 0;
    const source = emptyQuestion({
      id: "src-1",
      type: "mcq",
      stem: "Find the next number in the series 3, 6, 9, 12",
    });
    const result = await runGenerationItem({
      item,
      jobId: "job",
      sequence: 0,
      documentId: "doc-1",
      number: "2",
      now,
      source: toSourceQuestionRecord({ documentId: "source-doc", question: source }),
      existingQuestion: question,
      assetStore: createMemoryAssetStore(),
      onProduce: () => {
        produced += 1;
      },
    });
    expect(produced).toBe(0);
    expect(result.question.id).toBe("kept-id");
    expect(JSON.stringify(source)).toBe(
      JSON.stringify(
        toSourceQuestionRecord({ documentId: "source-doc", question: source }).question,
      ),
    );
  });

  test("retries a broken grammar question once, then keeps a valid one", async () => {
    let calls = 0;
    const result = await runGenerationItem({
      jobId: "job",
      sequence: 1,
      documentId: "doc-1",
      number: "3",
      now,
      instructions: "Write a grammar question about verb tense.",
      assetStore: createMemoryAssetStore(),
      callGrammarModel: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            type: "mcq",
            stem: "Choose the right tense.",
            options: [{ key: "A", text: "Only one", is_correct: true }],
          };
        }
        return {
          type: "mcq",
          stem: "Choose the sentence in the simple past.",
          options: grammarOptions(),
          answer_keys: ["A"],
          hint: "Look at the verb ending.",
          explanation: "The simple past uses the past form of the verb.",
        };
      },
    });
    expect(calls).toBe(2);
    expect(result.question.approval_status).toBe("generated");
    expect(result.question.approved).toBe(false);
    expect(result.item.validation_status).toBe("passed");
    expect(result.item.attempt_count).toBe(2);
  });

  test("a copied grammar stem stops at needs_review without another attempt", async () => {
    const stem = "the unusual crimson parrot flew over the quiet river today";
    let calls = 0;
    const source = emptyQuestion({ id: "src-grammar", type: "mcq", stem });
    const before = JSON.stringify(source);
    const result = await runGenerationItem({
      jobId: "job",
      sequence: 2,
      documentId: "doc-1",
      number: "4",
      now,
      instructions: "Practice grammar tense.",
      source: toSourceQuestionRecord({ documentId: "source-doc", question: source }),
      assetStore: createMemoryAssetStore(),
      callGrammarModel: async () => {
        calls += 1;
        return { type: "mcq", stem, options: grammarOptions(), answer_keys: ["A"] };
      },
    });
    expect(calls).toBe(1);
    expect(result.item.validation_status).toBe("needs_review");
    expect(result.item.status).toBe("needs_review");
    expect(JSON.stringify(source)).toBe(before);
  });

  test("generation state keeps item checkpoints", () => {
    const item = emptyGenerationItem({ jobId: "job", sequence: 0 });
    item.completed_stages = ["analysis", "generation"];
    const parsed = parseMockGeneration({
      mode: "from_instructions",
      status: "in_progress",
      instructions: "grammar",
      planned_count: 1,
      source_question_ids: [],
      cursor: 0,
      last_error: null,
      pairs: [],
      job_id: "job",
      items: [item],
    });
    expect(parsed?.items?.[0]?.completed_stages).toEqual(["analysis", "generation"]);
    expect(parsed?.job_id).toBe("job");
    const saved = GenerationSchema.parse({
      mode: "from_instructions",
      status: "completed",
      instructions: "grammar",
      planned_count: 1,
      source_question_ids: [],
      cursor: 1,
      last_error: null,
      pairs: [],
      job_id: "job",
      items: [item],
    });
    expect(saved.items?.[0]?.idempotency_key).toBe(item.idempotency_key);
    expect(saved.items?.[0]?.completed_stages).toEqual(["analysis", "generation"]);
  });
});

describe("figure skill vision routing", () => {
  const figureSource = () =>
    toSourceQuestionRecord({
      documentId: "source-doc",
      question: emptyQuestion({
        id: "src-fig",
        type: "diagram",
        stem: "(a)",
        figures: [{ description: "Pasted image", image_path: "source-doc/source/fig.png" }],
      }),
    });

  test("a vague figure routed to mirror_image uses the deterministic generator", async () => {
    let legacyCalls = 0;
    const result = await runGenerationItem({
      jobId: "job",
      sequence: 0,
      documentId: "doc-1",
      number: "1",
      now,
      strategy: "rewrite",
      source: figureSource(),
      assetStore: createMemoryAssetStore(),
      classifySourceFigure: async () => "mirror_image",
      callLegacyModel: async () => {
        legacyCalls += 1;
        throw new Error("the model must not be called for a mirror figure");
      },
    });

    expect(legacyCalls).toBe(0);
    expect(result.question.skill_type).toBe("mirror_image");
    expect(result.question.visual_spec?.["kind"]).toBe("mirror_image");
    expect(result.question.options.every((option) => option.image_path)).toBe(true);
  });

  test("without a classifier the same figure stays on the model path", async () => {
    let seenSkill = "";
    const result = await runGenerationItem({
      jobId: "job",
      sequence: 0,
      documentId: "doc-1",
      number: "1",
      now,
      strategy: "rewrite",
      source: figureSource(),
      assetStore: createMemoryAssetStore(),
      callLegacyModel: async (_id, skill) => {
        seenSkill = skill;
        return emptyQuestion({ id: "q", type: "diagram", stem: "A new figure." });
      },
    });

    expect(seenSkill).toBe("figure_identity");
    expect(result.question.skill_type).toBe("figure_identity");
  });

  test("a cached source skill routes without calling vision again", async () => {
    let classifyCalls = 0;
    const result = await runGenerationItem({
      jobId: "job",
      sequence: 0,
      documentId: "doc-1",
      number: "1",
      now,
      strategy: "rewrite",
      source: figureSource(),
      assetStore: createMemoryAssetStore(),
      sourceSkill: "mirror_image",
      classifySourceFigure: async () => {
        classifyCalls += 1;
        return "figure_identity";
      },
      callLegacyModel: async () => {
        throw new Error("the model must not be called for a cached mirror skill");
      },
    });

    expect(classifyCalls).toBe(0);
    expect(result.question.skill_type).toBe("mirror_image");
    expect(result.question.visual_spec?.["kind"]).toBe("mirror_image");
  });
});

describe("generation state skills", () => {
  test("a cached figure skill survives a parse round-trip", () => {
    const parsed = parseMockGeneration({
      mode: "from_source",
      status: "in_progress",
      instructions: null,
      planned_count: 1,
      source_question_ids: ["src-1"],
      cursor: 0,
      last_error: null,
      figure_skills: { "src-1": "mirror_image" },
    });

    expect(parsed?.figure_skills).toEqual({ "src-1": "mirror_image" });
  });
});

describe("exam-prep export", () => {
  test("unreviewed generated questions stay out of the learner tables and remain in the author list", () => {
    const generated = emptyQuestion({
      stem: "Generated",
      approval_status: "generated",
      approved: false,
      skill_type: "grammar",
      math_spec: {
        kind: "number_series",
        rule: { kind: "multiply_add", multiply: 2, add: 1 },
        visible_terms: [2, 5, 11],
      },
    });
    const reviewed = emptyQuestion({
      stem: "Reviewed",
      approval_status: "reviewed",
      approved: true,
      skill_type: "number_series",
    });
    const extracted = emptyQuestion({ stem: "Extracted", approved: true });
    const payload = buildExamPrepExport(document(), [generated, reviewed, extracted]);
    const ids = payload.tables.questions.flatMap((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return [];
      const id = row["id"];
      return typeof id === "string" ? [id] : [];
    });
    expect(ids).not.toContain(generated.id);
    expect(ids).toContain(reviewed.id);
    expect(ids).toContain(extracted.id);
    expect(payload.author_questions.map((question) => question.stem)).toEqual([
      "Generated",
      "Reviewed",
      "Extracted",
    ]);
    expect(payload.author_questions[0]?.skill_type).toBe("grammar");
    expect(payload.author_questions[0]?.math_spec?.["kind"]).toBe("number_series");
  });
});
