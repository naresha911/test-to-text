import { applyHintSolution, type HintSolutionResult } from "@/lib/hint-solution";
import {
  missingAnswerIds,
  needsHintOrSolution,
  solutionIncomplete,
  targetsForHintSolution,
  type SolutionAudience,
} from "@/lib/question-context";
import { findQuestionById, updateQuestionById, type Question } from "@/lib/question-schema";

export type RunGenerate = (input: {
  data: {
    question: Question;
    parentPassage?: string | null;
    force?: boolean;
    audience?: SolutionAudience;
    userPrompt?: string;
  };
}) => Promise<HintSolutionResult>;

export type GeneratedSolution = {
  questionId: string;
  result: HintSolutionResult;
};

/** Runs solution requests one at a time, in the order they were enqueued. */
export function createSolutionQueue() {
  let chain: Promise<void> = Promise.resolve();
  return function enqueue(task: () => Promise<void>): Promise<void> {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/**
 * Merge model output onto the latest question list.
 * `keepApproved` is the reviewer's latest intent; a missing right answer still clears it.
 */
export function foldGeneratedQuestions(
  questions: Question[],
  questionId: string,
  generated: GeneratedSolution[],
  force: boolean,
  keepApproved: boolean,
): { questions: Question[]; answersFound: boolean; missingIds: string[] } {
  let next = questions;
  for (const item of generated) {
    next = updateQuestionById(next, item.questionId, (question) =>
      applyHintSolution(question, item.result, force),
    );
  }
  const root = findQuestionById(next, questionId);
  const missingIds = missingAnswerIds(root);
  const answersFound = root != null && missingIds.length === 0;
  next = updateQuestionById(next, questionId, (question) => ({
    ...question,
    approved: answersFound && keepApproved,
  }));
  return { questions: next, answersFound, missingIds };
}

/**
 * Generate hints/solutions for a question (and comprehension sub-items).
 * Returns the model output. The caller merges it onto the latest question list.
 */
export async function generateForApprovedQuestion(options: {
  questions: Question[];
  questionId: string;
  force?: boolean;
  audience?: SolutionAudience;
  /** Used for this question only. Sub-questions use `promptFor`. */
  userPrompt?: string;
  promptFor?: ((questionId: string) => string | undefined) | undefined;
  runGenerate: RunGenerate;
  onProgress?: ((ids: string[]) => void) | undefined;
}): Promise<{ generated: GeneratedSolution[]; generatedIds: string[]; error: string | null }> {
  const root = findQuestionById(options.questions, options.questionId);
  if (!root) return { generated: [], generatedIds: [], error: null };

  const force = options.force === true;
  if (!force && !needsHintOrSolution(root)) {
    return { generated: [], generatedIds: [], error: null };
  }

  const targets = targetsForHintSolution(root).filter(
    (target) => force || solutionIncomplete(target.question),
  );
  if (!targets.length) return { generated: [], generatedIds: [], error: null };

  const generatedIds = targets.map((target) => target.question.id);
  options.onProgress?.(generatedIds);

  const generated: GeneratedSolution[] = [];
  let next = options.questions;
  let error: string | null = null;
  for (const target of targets) {
    const current = findQuestionById(next, target.question.id) ?? target.question;
    const explicit =
      target.question.id === options.questionId ? options.userPrompt?.trim() : "";
    const stored = options.promptFor?.(target.question.id)?.trim() ?? "";
    const userPrompt = explicit || stored;
    try {
      const result = await options.runGenerate({
        data: {
          question: current,
          parentPassage: target.parentPassage ?? null,
          force,
          ...(options.audience ? { audience: options.audience } : {}),
          ...(userPrompt ? { userPrompt } : {}),
        },
      });
      generated.push({ questionId: current.id, result });
      next = updateQuestionById(next, current.id, (question) =>
        applyHintSolution(question, result, force),
      );
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Could not generate hint and solution.";
      break;
    }
  }

  return { generated, generatedIds, error };
}
