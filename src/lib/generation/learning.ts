import type { DocumentKind } from "@/lib/document-types";
import {
  getStoredQuestions,
  queryExemplarQuestions,
  readLearnedSkills,
  syncDocumentQuestionIndex,
  type IndexedQuestionRef,
  type LearnedSkill,
  type QuestionIndexScope,
} from "@/lib/local-db";
import { findQuestionById, type Question } from "@/lib/question-schema";

/**
 * Boundary between the generation agents and the local library.
 * "Learning" is retrieval: tagged questions in `pp_question_index` are the
 * vocabulary the agents draw on, and exemplars are fed back as references.
 */

export type ExampleScope = {
  standard_id?: number | null;
  subject_id?: number | null;
  stream_id?: number | null;
  skill_type?: string | null;
  pattern_subtype?: string | null;
  /** Restrict retrieval to these source document kinds (agent memory). */
  kinds?: DocumentKind[];
};

async function loadQuestions(refs: IndexedQuestionRef[]): Promise<Question[]> {
  const byDocument = new Map<string, string[]>();
  for (const ref of refs) {
    const ids = byDocument.get(ref.document_id) ?? [];
    ids.push(ref.question_id);
    byDocument.set(ref.document_id, ids);
  }
  const found: Question[] = [];
  const seen = new Set<string>();
  for (const [documentId, ids] of byDocument) {
    const stored = await getStoredQuestions(documentId);
    if (!stored) continue;
    for (const id of ids) {
      if (seen.has(id)) continue;
      const question = findQuestionById(stored.questions, id);
      if (question) {
        seen.add(id);
        found.push(question);
      }
    }
  }
  return found;
}

/**
 * Source questions to show a generator as reference, relaxing the match
 * from exact (skill + subtype + class + subject + stream) down to skill only.
 */
export async function examplesFor(scope: ExampleScope, limit = 3): Promise<Question[]> {
  const base: QuestionIndexScope = {
    standard_id: scope.standard_id ?? null,
    subject_id: scope.subject_id ?? null,
    stream_id: scope.stream_id ?? null,
    ...(scope.kinds?.length ? { kinds: scope.kinds } : {}),
  };
  const attempts: QuestionIndexScope[] = [
    {
      ...base,
      skill_type: scope.skill_type ?? null,
      pattern_subtype: scope.pattern_subtype ?? null,
    },
    { ...base, skill_type: scope.skill_type ?? null },
    {
      standard_id: base.standard_id ?? null,
      skill_type: scope.skill_type ?? null,
      ...(base.kinds ? { kinds: base.kinds } : {}),
    },
    { skill_type: scope.skill_type ?? null, ...(base.kinds ? { kinds: base.kinds } : {}) },
  ];
  for (const attempt of attempts) {
    const refs = await queryExemplarQuestions(attempt, limit);
    if (!refs.length) continue;
    const loaded = await loadQuestions(refs);
    if (loaded.length) return loaded;
  }
  return [];
}

/** The learned skill vocabulary for a class / subject / stream. */
export async function learnedSkillsFor(scope: ExampleScope): Promise<LearnedSkill[]> {
  return readLearnedSkills({
    standard_id: scope.standard_id ?? null,
    subject_id: scope.subject_id ?? null,
    stream_id: scope.stream_id ?? null,
    ...(scope.kinds?.length ? { kinds: scope.kinds } : {}),
  });
}

/**
 * Re-derive the index for a document. Called after a regeneration so the new
 * question and any pattern learned from the source are reflected immediately.
 */
export async function learnFromDocument(documentId: string): Promise<void> {
  await syncDocumentQuestionIndex(documentId);
}
