import type { DocumentMeta, MockGenerationState } from "@/lib/document-types";
import { ensureGenerationItems, mockGenerationTotal } from "@/lib/document-types";
import type { GenerationItem } from "@/lib/generation/job-types";
import {
  advanceGenerationAfterSuccess,
  audienceFromDocument,
  markGenerationFailed,
  markGenerationInProgress,
  type MockPaperAudience,
} from "@/lib/mock-paper";
import type { Question } from "@/lib/question-schema";

type GenerateFn = (input: {
  data: {
    mode: "from_source" | "from_instructions";
    sourceQuestion?: Question;
    instructions?: string | null;
    index: number;
    total: number;
    number?: string;
    sourceQuestionId?: string | null;
    previousStems?: string[];
    audience?: MockPaperAudience;
    catalog?: {
      subject_id?: number | null;
      topic_id?: number | null;
      standard_id?: number | null;
      stream_id?: number | null;
    };
    documentId: string;
    sourceDocumentId?: string | null;
    jobId?: string;
    item?: GenerationItem;
    generation?: MockGenerationState;
    savedQuestions?: Question[];
    existingQuestion?: Question | null;
    questions_rev: number;
  };
}) => Promise<{ question: Question; item: GenerationItem; questions_rev: number }>;

type SaveFn = (input: {
  data: {
    id: string;
    patch: {
      questions: Question[];
      generation: MockGenerationState;
      questions_rev: number;
    };
  };
}) => Promise<{ questions_rev: number } | null>;

export type ResumeMockPaperResult = {
  questions: Question[];
  generation: MockGenerationState;
  completed: boolean;
  generatedThisRun: number;
  questions_rev: number;
};

export type MockCatalogNames = {
  subject?: string | null;
  standard?: string | null;
  stream?: string | null;
  topic?: string | null;
  /** Optional map of topic_id → name for per-question topic context. */
  topicsById?: Record<number, string>;
};

/**
 * Resume / run AI mock generation from the document's generation cursor.
 * Persists after each successful question so free-API failures are recoverable.
 */
export async function resumeMockPaperGeneration(options: {
  mockId: string;
  document: DocumentMeta;
  questions: Question[];
  sourceQuestions?: Question[];
  catalogNames?: MockCatalogNames;
  runGenerate: GenerateFn;
  runSave: SaveFn;
  onProgress?: (state: {
    cursor: number;
    total: number;
    questions: Question[];
    generation: MockGenerationState;
    questions_rev: number;
  }) => void;
  signal?: { cancelled: boolean };
}): Promise<ResumeMockPaperResult> {
  const generation = options.document.generation;
  if (!generation) {
    throw new Error("This document has no mock generation state.");
  }

  const total = mockGenerationTotal(generation);
  if (total <= 0) {
    throw new Error("Nothing to generate — planned question count is empty.");
  }

  let questions = [...options.questions];
  let state = ensureGenerationItems(markGenerationInProgress(generation));
  let generatedThisRun = 0;
  let questionsRev = options.document.questions_rev;

  // Persist in_progress immediately so Resume/Compare UIs stay consistent.
  const started = await options.runSave({
    data: {
      id: options.mockId,
      patch: { questions, generation: state, questions_rev: questionsRev },
    },
  });
  if (started) questionsRev = started.questions_rev;
  options.onProgress?.({
    cursor: state.cursor,
    total,
    questions,
    generation: state,
    questions_rev: questionsRev,
  });

  const baseAudience = audienceFromDocument(options.document, options.catalogNames);
  const topicsById = options.catalogNames?.topicsById ?? {};

  while (state.cursor < total) {
    if (options.signal?.cancelled) {
      break;
    }

    const index = state.cursor;
    const item = state.items?.[index];
    if (!item) throw new Error(`Missing generation item at index ${index}.`);
    const already = item.candidate_question_id
      ? questions.find((question) => question.id === item.candidate_question_id)
      : undefined;
    const stageDone =
      item.status === "completed" ||
      item.status === "needs_review" ||
      item.completed_stages.includes("review");
    if (already && stageDone) {
      const pair = {
        source_question_id: item.source_question_id,
        mock_question_id: already.id,
      };
      state = state.pairs.some((entry) => entry.mock_question_id === already.id)
        ? {
            ...state,
            cursor: state.cursor + 1,
            status: state.cursor + 1 >= total ? "completed" : "in_progress",
            last_error: null,
          }
        : advanceGenerationAfterSuccess(state, pair);
      const skipped = await options.runSave({
        data: {
          id: options.mockId,
          patch: { questions, generation: state, questions_rev: questionsRev },
        },
      });
      if (skipped) questionsRev = skipped.questions_rev;
      options.onProgress?.({
        cursor: state.cursor,
        total,
        questions,
        generation: state,
        questions_rev: questionsRev,
      });
      continue;
    }

    try {
      let question: Question;
      let nextItem: GenerationItem;
      if (state.mode === "from_source") {
        const sourceId = state.source_question_ids[index];
        const sourceQuestion = options.sourceQuestions?.find((q) => q.id === sourceId);
        if (!sourceQuestion || !sourceId) {
          throw new Error(`Missing source question at index ${index}.`);
        }

        const topicId = sourceQuestion.topic_id ?? null;
        const topicName =
          topicId != null && topicsById[topicId]
            ? topicsById[topicId]
            : (options.catalogNames?.topic ?? null);

        const audience: MockPaperAudience = {
          ...baseAudience,
          difficulty: sourceQuestion.difficulty ?? baseAudience.difficulty ?? null,
          topic: topicName ?? baseAudience.topic ?? null,
        };

        const catalog = {
          subject_id: sourceQuestion.subject_id ?? options.document.subject_id,
          topic_id: topicId ?? null,
          standard_id: sourceQuestion.standard_id ?? options.document.standard_id,
          stream_id: sourceQuestion.stream_id ?? options.document.stream_id,
        };

        const generated = await options.runGenerate({
          data: {
            mode: "from_source",
            sourceQuestion,
            instructions: state.instructions,
            index,
            total,
            number: sourceQuestion.number ?? String(index + 1),
            sourceQuestionId: sourceId,
            audience,
            catalog,
            documentId: options.mockId,
            sourceDocumentId: options.document.source_document_id,
            jobId: state.job_id ?? options.mockId,
            item,
            generation: state,
            savedQuestions: questions,
            existingQuestion: already ?? null,
            questions_rev: questionsRev,
          },
        });
        question = generated.question;
        nextItem = generated.item;
        questionsRev = generated.questions_rev;
        questions = questions.some((entry) => entry.id === question.id)
          ? questions.map((entry) => (entry.id === question.id ? question : entry))
          : [...questions, question];
        state = {
          ...advanceGenerationAfterSuccess(state, {
            source_question_id: sourceId,
            mock_question_id: question.id,
          }),
          items: (state.items ?? []).map((entry) =>
            entry.item_id === item.item_id ? nextItem : entry,
          ),
        };
      } else {
        const instructions = state.instructions?.trim();
        if (!instructions) {
          throw new Error("Mock instructions are missing.");
        }
        const catalog = {
          subject_id: options.document.subject_id,
          standard_id: options.document.standard_id,
          stream_id: options.document.stream_id,
        };
        const generated = await options.runGenerate({
          data: {
            mode: "from_instructions",
            instructions,
            index,
            total,
            number: String(index + 1),
            sourceQuestionId: null,
            previousStems: questions.map((q) => q.stem).filter(Boolean),
            audience: baseAudience,
            catalog,
            documentId: options.mockId,
            jobId: state.job_id ?? options.mockId,
            item,
            generation: state,
            savedQuestions: questions,
            existingQuestion: already ?? null,
            questions_rev: questionsRev,
          },
        });
        question = generated.question;
        nextItem = generated.item;
        questionsRev = generated.questions_rev;
        questions = questions.some((entry) => entry.id === question.id)
          ? questions.map((entry) => (entry.id === question.id ? question : entry))
          : [...questions, question];
        state = {
          ...advanceGenerationAfterSuccess(state, {
            source_question_id: null,
            mock_question_id: question.id,
          }),
          items: (state.items ?? []).map((entry) =>
            entry.item_id === item.item_id ? nextItem : entry,
          ),
        };
      }

      generatedThisRun += 1;
      const saved = await options.runSave({
        data: {
          id: options.mockId,
          patch: { questions, generation: state, questions_rev: questionsRev },
        },
      });
      if (saved) questionsRev = saved.questions_rev;
      options.onProgress?.({
        cursor: state.cursor,
        total,
        questions,
        generation: state,
        questions_rev: questionsRev,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mock generation failed.";
      state = markGenerationFailed(state, message);
      try {
        const saved = await options.runSave({
          data: {
            id: options.mockId,
            patch: { questions, generation: state, questions_rev: questionsRev },
          },
        });
        if (saved) questionsRev = saved.questions_rev;
      } catch {
        // The original generation error is the one the caller should see.
      }
      options.onProgress?.({
        cursor: state.cursor,
        total,
        questions,
        generation: state,
        questions_rev: questionsRev,
      });
      throw error;
    }
  }

  return {
    questions,
    generation: state,
    completed: state.status === "completed",
    generatedThisRun,
    questions_rev: questionsRev,
  };
}
