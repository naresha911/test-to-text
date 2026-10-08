import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  DOCUMENT_KINDS,
  emptyMockGeneration,
  type DocumentKind,
  type MockGenerationState,
} from "@/lib/document-types";
import { drillBlueprint } from "@/lib/generation/blueprint";
import { skillAuthorPrompt } from "@/lib/generation/skill-prompts";
import { skillByType } from "@/lib/question-taxonomy";
import { GENERATION_ITEM_STATUSES, GENERATION_STAGES } from "@/lib/generation/job-types";
import { buildExamPrepExport } from "@/lib/exam-prep-export";
import {
  appendPage,
  createDocument,
  deleteDocument,
  getCatalog,
  getDocument,
  importCatalogDump,
  listDocuments,
  markPageOcr,
  removePage,
  resetDocumentPageReads,
  saveFigure,
  updateDocument,
  type DocumentPatch,
} from "@/lib/local-db";
import type { Question } from "@/lib/question-schema";
import { CONTENT_MODES } from "@/lib/reading/mode";

const KindSchema = z.enum(DOCUMENT_KINDS);

const GenerationPairSchema = z.object({
  source_question_id: z.string().nullable(),
  mock_question_id: z.string(),
});

const GenerationItemSchema = z.object({
  item_id: z.string(),
  sequence: z.number().int(),
  source_question_id: z.string().nullable(),
  stage: z.enum(GENERATION_STAGES),
  status: z.enum(GENERATION_ITEM_STATUSES),
  attempt_count: z.number().int(),
  candidate_question_id: z.string().nullable(),
  validation_status: z.enum(["passed", "failed", "needs_review"]).nullable(),
  last_error: z.string().nullable(),
  idempotency_key: z.string(),
  completed_stages: z.array(z.enum(GENERATION_STAGES)),
});

export const GenerationSchema = z.object({
  mode: z.enum(["from_source", "from_instructions"]),
  status: z.enum(["pending", "in_progress", "completed", "failed"]),
  instructions: z.string().max(8000).nullable(),
  planned_count: z.number().int().nullable(),
  source_question_ids: z.array(z.string()),
  cursor: z.number().int().min(0),
  last_error: z.string().max(2000).nullable(),
  pairs: z.array(GenerationPairSchema),
  job_id: z.string().nullable().optional(),
  items: z.array(GenerationItemSchema).optional(),
  blueprint: z.array(z.object({ skill: z.string(), count: z.number() })).optional(),
  strategy: z.enum(["rewrite", "write_new"]).optional(),
  difficulty_step: z.number().int().min(-1).max(2).optional(),
  drill_skill: z.string().max(80).nullable().optional(),
  figure_skills: z.record(z.string(), z.string().max(40)).optional(),
});

export const listLocalDocuments = createServerFn({ method: "GET" }).handler(async () =>
  listDocuments(),
);

export const getLocalDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => getDocument(data.id));

export const createLocalDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        kind: KindSchema,
        title: z.string().max(200).optional(),
        source_document_id: z.string().uuid().nullable().optional(),
        generation: GenerationSchema.nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) =>
    createDocument(data.kind as DocumentKind, {
      ...(data.title !== undefined ? { title: data.title } : {}),
      source_document_id: data.source_document_id ?? null,
      generation: (data.generation as MockGenerationState | null | undefined) ?? null,
    }),
  );

const MetaPatch = z.object({
  kind: KindSchema.optional(),
  title: z.string().max(300).optional(),
  year: z.number().int().nullable().optional(),
  standard_id: z.number().int().nullable().optional(),
  stream_id: z.number().int().nullable().optional(),
  subject_id: z.number().int().nullable().optional(),
  topic_id: z.number().int().nullable().optional(),
  duration_minutes: z.number().int().nullable().optional(),
  total_marks: z.number().nullable().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).nullable().optional(),
  exam: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  section_timing: z.boolean().optional(),
  negative_marking: z.boolean().optional(),
  allow_pause: z.boolean().optional(),
  max_attempts: z.number().int().optional(),
  default_marks: z.number().nullable().optional(),
  default_negative_marks: z.number().nullable().optional(),
  source_document_id: z.string().uuid().nullable().optional(),
  generation: GenerationSchema.nullable().optional(),
  questions: z.array(z.unknown()).optional(),
  questions_rev: z.number().int().nonnegative().optional(),
});

export const saveLocalDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().uuid(), patch: MetaPatch }).parse(input))
  .handler(async ({ data }) => {
    const patch: DocumentPatch = {};
    const src = data.patch;
    if (src.kind !== undefined) patch.kind = src.kind;
    if (src.title !== undefined) patch.title = src.title;
    if (src.year !== undefined) patch.year = src.year;
    if (src.standard_id !== undefined) patch.standard_id = src.standard_id;
    if (src.stream_id !== undefined) patch.stream_id = src.stream_id;
    if (src.subject_id !== undefined) patch.subject_id = src.subject_id;
    if (src.topic_id !== undefined) patch.topic_id = src.topic_id;
    if (src.duration_minutes !== undefined) patch.duration_minutes = src.duration_minutes;
    if (src.total_marks !== undefined) patch.total_marks = src.total_marks;
    if (src.difficulty !== undefined) patch.difficulty = src.difficulty;
    if (src.exam !== undefined) patch.exam = src.exam;
    if (src.notes !== undefined) patch.notes = src.notes;
    if (src.source !== undefined) patch.source = src.source;
    if (src.description !== undefined) patch.description = src.description;
    if (src.section_timing !== undefined) patch.section_timing = src.section_timing;
    if (src.negative_marking !== undefined) patch.negative_marking = src.negative_marking;
    if (src.allow_pause !== undefined) patch.allow_pause = src.allow_pause;
    if (src.max_attempts !== undefined) patch.max_attempts = src.max_attempts;
    if (src.default_marks !== undefined) patch.default_marks = src.default_marks;
    if (src.default_negative_marks !== undefined) {
      patch.default_negative_marks = src.default_negative_marks;
    }
    if (src.source_document_id !== undefined) patch.source_document_id = src.source_document_id;
    if (src.generation !== undefined) patch.generation = src.generation as MockGenerationState;
    if (src.questions !== undefined) patch.questions = src.questions as Question[];
    if (src.questions_rev !== undefined) patch.questions_rev = src.questions_rev;
    return updateDocument(data.id, patch);
  });

export const deleteLocalDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    await deleteDocument(data.id);
    return { ok: true };
  });

export const appendLocalPage = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        dataUrl: z.string().min(32),
        originalName: z.string().max(300),
      })
      .parse(input),
  )
  .handler(async ({ data }) => appendPage(data));

export const removeLocalPage = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ pageId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    await removePage(data.pageId);
    return { ok: true };
  });

export const markLocalPageOcr = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        pageId: z.string().uuid(),
        status: z.string().max(40),
        readMode: z.enum(CONTENT_MODES).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await markPageOcr(data.pageId, data.status, data.readMode);
    return { ok: true };
  });

export const resetLocalDocumentPageReads = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ documentId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    await resetDocumentPageReads(data.documentId);
    return { ok: true };
  });

export const saveLocalFigure = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        dataUrl: z.string().min(32),
        filename: z.string().max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }) => ({ path: await saveFigure(data) }));

export const getLocalCatalog = createServerFn({ method: "GET" }).handler(async () => getCatalog());

export const importLocalCatalog = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ dump: z.unknown() }).parse(input))
  .handler(async ({ data }) => importCatalogDump(data.dump));

export const exportLocalDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const loaded = await getDocument(data.id);
    if (!loaded) throw new Error("Document not found");
    return buildExamPrepExport(loaded.document, loaded.questions);
  });

export const pushLocalDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const loaded = await getDocument(data.id);
    if (!loaded) throw new Error("Document not found");
    if (!loaded.questions.length) throw new Error("This paper has no questions to push.");
    const { pushExamPrepExport } = await import("@/lib/exam-prep-push");
    const result = await pushExamPrepExport(buildExamPrepExport(loaded.document, loaded.questions));
    return result;
  });

/** Create an AI mock draft from an existing library paper. */
export const createAiMockFromSource = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        sourceId: z.string().uuid(),
        strategy: z.enum(["rewrite", "write_new"]),
        difficultyStep: z.number().int().min(-1).max(1).optional(),
        authorInstructions: z.string().max(4000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const loaded = await getDocument(data.sourceId);
    if (!loaded) throw new Error("Source paper not found");
    if (loaded.document.kind === "ai_mock") {
      throw new Error("Cannot generate a mock from another AI mock. Choose a scanned paper.");
    }
    if (!loaded.questions.length) {
      throw new Error("That paper has no questions yet. Extract questions first.");
    }

    // One output question per top-level source question, in order. Duplicate
    // printed numbers count once; nested sub-questions belong to their parent.
    const seenNumbers = new Set<string>();
    const sourceIds = loaded.questions.flatMap((question) => {
      const number = question.number?.trim() ?? "";
      if (number && seenNumbers.has(number)) return [];
      if (number) seenNumbers.add(number);
      return [question.id];
    });

    const authorInstructions = data.authorInstructions?.trim() || null;
    const generation = emptyMockGeneration({
      mode: "from_source",
      status: "pending",
      source_question_ids: sourceIds,
      cursor: 0,
      strategy: data.strategy,
      instructions: authorInstructions,
      difficulty_step: data.difficultyStep ?? 0,
    });

    const created = await createDocument("ai_mock", {
      title: `Mock — ${loaded.document.title}`,
      source_document_id: loaded.document.id,
      generation,
    });

    await updateDocument(created.id, {
      year: loaded.document.year,
      standard_id: loaded.document.standard_id,
      stream_id: loaded.document.stream_id,
      subject_id: loaded.document.subject_id,
      topic_id: loaded.document.topic_id,
      duration_minutes: loaded.document.duration_minutes,
      total_marks: loaded.document.total_marks,
      difficulty: loaded.document.difficulty,
      exam: loaded.document.exam,
      notes: loaded.document.notes,
      source: `ai_mock_from:${loaded.document.id}`,
      description: loaded.document.description,
      section_timing: loaded.document.section_timing,
      negative_marking: loaded.document.negative_marking,
      allow_pause: loaded.document.allow_pause,
      max_attempts: loaded.document.max_attempts,
      default_marks: loaded.document.default_marks,
      default_negative_marks: loaded.document.default_negative_marks,
      questions: [],
      questions_rev: created.questions_rev,
    });

    const next = await getDocument(created.id);
    if (!next) throw new Error("Could not load the new AI mock document");
    return next;
  });

/** Create an AI mock draft from free-text instructions (no source paper). */
export const createAiMockFromInstructions = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        title: z.string().min(1).max(300),
        instructions: z.string().max(8000).optional(),
        planned_count: z.number().int().min(1).max(80),
        drill_skill: z.string().max(80).optional(),
        difficulty_step: z.number().int().min(0).max(1).optional(),
        standard_id: z.number().int().nullable().optional(),
        stream_id: z.number().int().nullable().optional(),
        subject_id: z.number().int().nullable().optional(),
        topic_id: z.number().int().nullable().optional(),
        difficulty: z.enum(["easy", "medium", "hard"]).nullable().optional(),
        exam: z.string().max(200).nullable().optional(),
        duration_minutes: z.number().int().nullable().optional(),
        default_marks: z.number().nullable().optional(),
      })
      .superRefine((value, ctx) => {
        const notes = value.instructions?.trim() ?? "";
        if (!value.drill_skill && notes.length < 10) {
          ctx.addIssue({
            code: "custom",
            message: "Add clearer instructions (at least a short paragraph).",
            path: ["instructions"],
          });
        }
        if (value.drill_skill && !skillByType(value.drill_skill)) {
          ctx.addIssue({
            code: "custom",
            message: "Choose a known topic.",
            path: ["drill_skill"],
          });
        }
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const drill = data.drill_skill ? drillBlueprint({
      skill: data.drill_skill,
      count: data.planned_count,
      difficultyStep: data.difficulty_step ?? 0,
    }) : null;
    const notes = data.instructions?.trim() ?? "";
    const instructions = drill
      ? [`[skill:${drill.skill}]`, skillAuthorPrompt(drill.skill), notes].filter(Boolean).join("\n")
      : notes;
    const generation = emptyMockGeneration({
      mode: "from_instructions",
      status: "pending",
      instructions,
      planned_count: data.planned_count,
      cursor: 0,
      ...(drill
        ? {
            blueprint: [{ skill: drill.skill, count: drill.count }],
            difficulty_step: drill.difficultyStep,
            drill_skill: drill.skill,
          }
        : {}),
    });

    const created = await createDocument("ai_mock", {
      title: data.title.trim(),
      source_document_id: null,
      generation,
    });

    await updateDocument(created.id, {
      standard_id: data.standard_id ?? null,
      stream_id: data.stream_id ?? null,
      subject_id: data.subject_id ?? null,
      topic_id: data.topic_id ?? null,
      difficulty: data.difficulty ?? null,
      exam: data.exam ?? null,
      duration_minutes: data.duration_minutes ?? null,
      default_marks: data.default_marks ?? null,
      source: drill ? `ai_mock_drill:${drill.skill}` : "ai_mock_from_instructions",
      description: instructions.slice(0, 2000),
      questions: [],
      questions_rev: created.questions_rev,
    });

    const next = await getDocument(created.id);
    if (!next) throw new Error("Could not load the new AI mock document");
    return next;
  });
