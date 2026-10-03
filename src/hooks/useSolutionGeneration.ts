import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { toast } from "sonner";

import {
  createSolutionQueue,
  foldGeneratedQuestions,
  generateForApprovedQuestion,
  type RunGenerate,
} from "@/lib/hint-solution-client";
import type { SolutionAudience } from "@/lib/question-context";
import { findQuestionById, updateQuestionById, type Question } from "@/lib/question-schema";

export type SolutionPromptReveal = { tick: number; ids: string[] };

type Options = {
  questionsRef: MutableRefObject<Question[]>;
  setQuestions: Dispatch<SetStateAction<Question[]>>;
  runGenerate: RunGenerate;
  audience?: SolutionAudience | undefined;
  save: (questions: Question[]) => void;
};

const NO_ANSWER =
  "No right answer was found. The question was left unapproved. Edit the AI prompt and regenerate.";

/**
 * Hint/solution requests run one at a time, in the order questions were approved.
 * A question stays approved only when the model returns a right answer.
 */
export function useSolutionGeneration(options: Options) {
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(() => new Set());
  const [queuedIds, setQueuedIds] = useState<Set<string>>(() => new Set());
  const [promptReveal, setPromptReveal] = useState<SolutionPromptReveal | null>(null);
  const prompts = useRef(new Map<string, string>());
  const queue = useRef(createSolutionQueue()).current;
  const approvalIntent = useRef(new Map<string, boolean>());
  const epochs = useRef(new Map<string, number>());
  const waiting = useRef(new Map<string, number>());
  const optionsRef = useRef(options);
  optionsRef.current = options;

  function reveal(ids: string[]) {
    setPromptReveal({ tick: Date.now(), ids });
  }

  function commit(recipe: (current: Question[]) => Question[]) {
    let snapshot: Question[] | null = null;
    optionsRef.current.setQuestions((current) => {
      snapshot = recipe(current);
      optionsRef.current.questionsRef.current = snapshot;
      return snapshot;
    });
    if (snapshot) optionsRef.current.save(snapshot);
  }

  function dropQueued(ids: Iterable<string>) {
    setQueuedIds((current) => {
      let changed = false;
      const next = new Set(current);
      for (const id of ids) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : current;
    });
  }

  function dropGenerating(ids: Iterable<string>) {
    setGeneratingIds((current) => {
      let changed = false;
      const next = new Set(current);
      for (const id of ids) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : current;
    });
  }

  async function runGeneration(
    questionId: string,
    force: boolean,
    userPrompt: string | undefined,
    epoch: number,
  ) {
    const waitingBehind = (waiting.current.get(questionId) ?? 1) - 1;
    if (waitingBehind <= 0) waiting.current.delete(questionId);
    else waiting.current.set(questionId, waitingBehind);
    if (waitingBehind <= 0) dropQueued([questionId]);

    let requested: string[] = [];
    try {
      if (!force && approvalIntent.current.get(questionId) === false) return;

      const { questionsRef, runGenerate, audience } = optionsRef.current;
      const result = await generateForApprovedQuestion({
        questions: questionsRef.current,
        questionId,
        force,
        runGenerate,
        ...(audience ? { audience } : {}),
        ...(userPrompt?.trim() ? { userPrompt: userPrompt.trim() } : {}),
        promptFor: (id) => {
          const text = prompts.current.get(id)?.trim();
          return text || undefined;
        },
        onProgress: (ids) => {
          requested = ids;
          dropQueued([questionId]);
          setGeneratingIds((current) => {
            const next = new Set(current);
            next.add(questionId);
            for (const id of ids) next.add(id);
            return next;
          });
        },
      });

      const stillLatest = epochs.current.get(questionId) === epoch;
      const keepApproved = approvalIntent.current.get(questionId) !== false;
      if (result.generated.length) {
        let answersFound = false;
        let missingIds: string[] = [];
        commit((current) => {
          const folded = foldGeneratedQuestions(
            current,
            questionId,
            result.generated,
            force,
            keepApproved,
          );
          answersFound = folded.answersFound;
          missingIds = folded.missingIds;
          if (stillLatest) return folded.questions;
          const approvedNow = findQuestionById(current, questionId)?.approved === true;
          return updateQuestionById(folded.questions, questionId, (question) => ({
            ...question,
            approved: approvedNow,
          }));
        });
        if (!stillLatest) return;
        if (result.error) {
          toast.error(result.error);
          reveal(missingIds.length ? missingIds : [questionId]);
        } else if (!answersFound) {
          if (keepApproved) toast.error(NO_ANSWER);
          reveal(missingIds.length ? missingIds : [questionId]);
        } else if (keepApproved) {
          toast.success(force ? "Hint and solution regenerated." : "Hint and solution ready.");
        }
      } else if (result.error && stillLatest) {
        commit((current) =>
          updateQuestionById(current, questionId, (question) => ({ ...question, approved: false })),
        );
        toast.error(result.error);
        reveal([questionId]);
      }
    } catch (error) {
      if (epochs.current.get(questionId) === epoch) {
        commit((current) =>
          updateQuestionById(current, questionId, (question) => ({ ...question, approved: false })),
        );
        toast.error(error instanceof Error ? error.message : "Could not generate hint and solution.");
        reveal([questionId]);
      }
    } finally {
      dropGenerating([questionId, ...requested]);
      if ((waiting.current.get(questionId) ?? 0) > 0) {
        setQueuedIds((current) => {
          if (current.has(questionId)) return current;
          const next = new Set(current);
          next.add(questionId);
          return next;
        });
      }
    }
  }

  function enqueue(questionId: string, force: boolean, userPrompt?: string) {
    waiting.current.set(questionId, (waiting.current.get(questionId) ?? 0) + 1);
    const epoch = (epochs.current.get(questionId) ?? 0) + 1;
    epochs.current.set(questionId, epoch);
    setQueuedIds((current) => {
      if (current.has(questionId)) return current;
      const next = new Set(current);
      next.add(questionId);
      return next;
    });
    void queue(() => runGeneration(questionId, force, userPrompt, epoch));
  }

  function approve(questionId: string, approved: boolean, extra?: { userPrompt?: string }) {
    approvalIntent.current.set(questionId, approved);
    commit((current) =>
      updateQuestionById(current, questionId, (question) => ({ ...question, approved })),
    );
    if (approved) enqueue(questionId, false, extra?.userPrompt);
  }

  function regenerate(questionId: string, extra?: { userPrompt?: string }) {
    approvalIntent.current.set(questionId, true);
    enqueue(questionId, true, extra?.userPrompt);
  }

  return { generatingIds, queuedIds, promptReveal, prompts, approve, regenerate };
}
