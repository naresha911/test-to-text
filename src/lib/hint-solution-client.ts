import {
  applyHintSolution,
  type HintSolutionResult,
} from "@/lib/hint-solution";
import {
  needsHintOrSolution,
  targetsForHintSolution,
  type SolutionAudience,
} from "@/lib/question-context";
import {
  findQuestionById,
  updateQuestionById,
  type Question,
} from "@/lib/question-schema";

type RunGenerate = (input: {
  data: {
    question: Question;
    parentPassage?: string | null;
    force?: boolean;
    audience?: SolutionAudience;
  };
}) => Promise<HintSolutionResult>;

/**
 * Generate hints/solutions for a top-level question (and comprehension sub-items).
 * Returns the updated questions list and the ids that were requested.
 */
export async function generateForApprovedQuestion(options: {
  questions: Question[];
  questionId: string;
  force?: boolean;
  audience?: SolutionAudience;
  runGenerate: RunGenerate;
  onProgress?: (ids: string[]) => void;
}): Promise<{ questions: Question[]; generatedIds: string[] }> {
  const root = findQuestionById(options.questions, options.questionId);
  if (!root) return { questions: options.questions, generatedIds: [] };

  const force = options.force === true;
  if (!force && !needsHintOrSolution(root)) {
    return { questions: options.questions, generatedIds: [] };
  }

  const targets = targetsForHintSolution(root).filter(
    (target) => force || !target.question.hint?.trim() || !target.question.explanation?.trim(),
  );
  if (!targets.length) return { questions: options.questions, generatedIds: [] };

  const generatedIds = targets.map((target) => target.question.id);
  options.onProgress?.(generatedIds);

  let next = options.questions;
  for (const target of targets) {
    const current = findQuestionById(next, target.question.id) ?? target.question;
    const result = await options.runGenerate({
      data: {
        question: current,
        parentPassage: target.parentPassage ?? null,
        force,
        ...(options.audience ? { audience: options.audience } : {}),
      },
    });
    next = updateQuestionById(next, current.id, (question) =>
      applyHintSolution(question, result, force),
    );
  }

  next = updateQuestionById(next, options.questionId, (question) => ({
    ...question,
    approved: true,
  }));

  return { questions: next, generatedIds };
}
