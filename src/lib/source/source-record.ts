import type { Question } from "@/lib/question-schema";

/**
 * Read-only view of a saved extraction. Generation may read it and must not
 * write back onto the source document or this object.
 */
export type SourceQuestionRecord = {
  source_question_id: string;
  source_document_id: string;
  page: number | null;
  question: Question;
  source_evidence: {
    page_asset_id: string | null;
    source_figure_asset_ids: string[];
    raw_reader_result_asset_id: string | null;
  };
  extraction: {
    reader_id: string | null;
    status: "extracted" | "needs_review" | "reviewed";
    confidence: number | null;
  };
};

export function toSourceQuestionRecord(input: {
  documentId: string;
  question: Question;
  pageFilePath?: string | null;
  readerId?: string | null;
}): SourceQuestionRecord {
  return {
    source_question_id: input.question.id,
    source_document_id: input.documentId,
    page: input.question.page ?? null,
    question: input.question,
    source_evidence: {
      page_asset_id: input.pageFilePath ?? null,
      source_figure_asset_ids: input.question.figures
        .map((figure) => figure.image_path)
        .filter((path): path is string => Boolean(path)),
      raw_reader_result_asset_id: null,
    },
    extraction: {
      reader_id: input.readerId ?? null,
      status: input.question.approved ? "reviewed" : "extracted",
      confidence: input.question.confidence ?? null,
    },
  };
}
