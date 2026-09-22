import type { DocumentMeta, MockGenerationState } from "@/lib/document-types";
import { mockGenerationTotal } from "@/lib/document-types";
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
  };
}) => Promise<Question>;

type SaveFn = (input: {
  data: {
    id: string;
    patch: {
      questions: Question[];
      generation: MockGenerationState;
    };
  };
}) => Promise<unknown>;

export type ResumeMockPaperResult = {
  questions: Question[];
  generation: MockGenerationState;
  completed: boolean;
  generatedThisRun: number;
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
  let state = markGenerationInProgress(generation);
  let generatedThisRun = 0;

  // Persist in_progress immediately so Resume/Compare UIs stay consistent.
  await options.runSave({
    data: {
      id: options.mockId,
      patch: { questions, generation: state },
    },
  });
  options.onProgress?.({ cursor: state.cursor, total, questions, generation: state });

  const baseAudience = audienceFromDocument(options.document, options.catalogNames);
  const topicsById = options.catalogNames?.topicsById ?? {};

  while (state.cursor < total) {
    if (options.signal?.cancelled) {
      break;
    }

    const index = state.cursor;
    try {
      let question: Question;
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

        question = await options.runGenerate({
          data: {
            mode: "from_source",
            sourceQuestion,
            index,
            total,
            number: sourceQuestion.number ?? String(index + 1),
            sourceQuestionId: sourceId,
            audience,
            catalog,
          },
        });
        questions = [...questions, question];
        state = advanceGenerationAfterSuccess(state, {
          source_question_id: sourceId,
          mock_question_id: question.id,
        });
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
        question = await options.runGenerate({
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
          },
        });
        questions = [...questions, question];
        state = advanceGenerationAfterSuccess(state, {
          source_question_id: null,
          mock_question_id: question.id,
        });
      }

      generatedThisRun += 1;
      await options.runSave({
        data: {
          id: options.mockId,
          patch: { questions, generation: state },
        },
      });
      options.onProgress?.({ cursor: state.cursor, total, questions, generation: state });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mock generation failed.";
      state = markGenerationFailed(state, message);
      await options.runSave({
        data: {
          id: options.mockId,
          patch: { questions, generation: state },
        },
      });
      options.onProgress?.({ cursor: state.cursor, total, questions, generation: state });
      throw error;
    }
  }

  return {
    questions,
    generation: state,
    completed: state.status === "completed",
    generatedThisRun,
  };
}
