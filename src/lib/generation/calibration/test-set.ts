import {
  getStoredQuestions,
  queryApprovedReferenceQuestions,
  type IndexedQuestionRef,
  type QuestionIndexScope,
} from "@/lib/local-db";
import { findQuestionById, type Question } from "@/lib/question-schema";

import type { CalibrationReference, CalibrationScope } from "@/lib/generation/calibration/types";

const DEFAULT_LIMIT = 5;

async function loadReferences(
  refs: IndexedQuestionRef[],
  scope: CalibrationScope,
): Promise<CalibrationReference[]> {
  const byDocument = new Map<string, Question[] | null>();
  const out: CalibrationReference[] = [];
  for (const ref of refs) {
    if (!byDocument.has(ref.document_id)) {
      const stored = await getStoredQuestions(ref.document_id);
      byDocument.set(ref.document_id, stored?.questions ?? null);
    }
    const question = findQuestionById(byDocument.get(ref.document_id) ?? [], ref.question_id);
    if (!question) continue;
    out.push({
      skill: ref.skill_type ?? "",
      pattern_subtype: ref.pattern_subtype,
      standard_id: question.standard_id ?? scope.standard_id,
      subject_id: question.subject_id ?? scope.subject_id,
      stream_id: question.stream_id ?? scope.stream_id,
      question,
      document_id: ref.document_id,
    });
  }
  return out;
}

/**
 * Pin the approved past-paper questions for a skill and scope. These are the
 * "expected output" the calibrator measures generated questions against. The
 * match relaxes from exact scope down to skill only, like exemplar retrieval.
 * When documentId is set the references come from that document only, with no
 * relaxation (paper-scoped training).
 */
export async function buildCalibrationSet(input: {
  scope: CalibrationScope;
  skill: string;
  limit?: number;
  documentId?: string | null;
}): Promise<CalibrationReference[]> {
  const { scope, skill } = input;
  const limit = Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT));
  if (input.documentId) {
    // A paper defines its own scope: pin to its approved questions of the
    // skill, without class/subject filters or relaxation to other papers.
    const refs = await queryApprovedReferenceQuestions(
      { document_id: input.documentId, skill_type: skill },
      limit,
    );
    const loaded = await loadReferences(refs, scope);
    return loaded.slice(0, limit);
  }
  const attempts: QuestionIndexScope[] = [
    {
      standard_id: scope.standard_id,
      subject_id: scope.subject_id,
      stream_id: scope.stream_id,
      skill_type: skill,
    },
    { standard_id: scope.standard_id, skill_type: skill },
    { skill_type: skill },
  ];
  for (const attempt of attempts) {
    const refs = await queryApprovedReferenceQuestions(attempt, limit);
    if (!refs.length) continue;
    const loaded = await loadReferences(refs, scope);
    if (loaded.length) return loaded.slice(0, limit);
  }
  return [];
}
