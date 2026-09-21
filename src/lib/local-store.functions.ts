import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { DocumentKind } from "@/lib/document-types";
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
  saveFigure,
  updateDocument,
  type DocumentPatch,
} from "@/lib/local-db";
import type { Question } from "@/lib/question-schema";

export const listLocalDocuments = createServerFn({ method: "GET" }).handler(async () =>
  listDocuments(),
);

export const getLocalDocument = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => getDocument(data.id));

export const createLocalDocument = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: z.enum(["past_paper", "practice_test"]),
        title: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => createDocument(data.kind as DocumentKind, data.title));

const MetaPatch = z.object({
  kind: z.enum(["past_paper", "practice_test"]).optional(),
  title: z.string().max(300).optional(),
  year: z.number().int().nullable().optional(),
  standard_id: z.number().int().nullable().optional(),
  stream_id: z.number().int().nullable().optional(),
  subject_id: z.number().int().nullable().optional(),
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
  questions: z.array(z.unknown()).optional(),
});

export const saveLocalDocument = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), patch: MetaPatch }).parse(input),
  )
  .handler(async ({ data }) => {
    const patch: DocumentPatch = {};
    const src = data.patch;
    if (src.kind !== undefined) patch.kind = src.kind;
    if (src.title !== undefined) patch.title = src.title;
    if (src.year !== undefined) patch.year = src.year;
    if (src.standard_id !== undefined) patch.standard_id = src.standard_id;
    if (src.stream_id !== undefined) patch.stream_id = src.stream_id;
    if (src.subject_id !== undefined) patch.subject_id = src.subject_id;
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
    if (src.questions !== undefined) patch.questions = src.questions as Question[];
    return updateDocument(data.id, patch);
  });

export const deleteLocalDocument = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    await deleteDocument(data.id);
    return { ok: true };
  });

export const appendLocalPage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
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
  .inputValidator((input: unknown) => z.object({ pageId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    await removePage(data.pageId);
    return { ok: true };
  });

export const markLocalPageOcr = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ pageId: z.string().uuid(), status: z.string().max(40) }).parse(input),
  )
  .handler(async ({ data }) => {
    await markPageOcr(data.pageId, data.status);
    return { ok: true };
  });

export const saveLocalFigure = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
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
  .inputValidator((input: unknown) => z.object({ dump: z.unknown() }).parse(input))
  .handler(async ({ data }) => importCatalogDump(data.dump));

export const exportLocalDocument = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const loaded = await getDocument(data.id);
    if (!loaded) throw new Error("Document not found");
    return buildExamPrepExport(loaded.document, loaded.questions);
  });
