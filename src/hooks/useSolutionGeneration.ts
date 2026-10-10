import {
  startTransition,
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
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

export type GenerationRunStatus =
  "queued" | "generating" | "success" | "failed" | "skipped" | "superseded";

export type GenerationRunEntry = {
  questionId: string;
  number: string | null;
  epoch: number;
  status: GenerationRunStatus;
  force: boolean;
  targets: number;
  completedTargets: number;
  error: string | null;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export type GenerationStatus = {
  state: "idle" | "active" | "done";
  entries: GenerationRunEntry[];
  running: GenerationRunEntry | null;
  queued: GenerationRunEntry[];
  pending: number;
  finished: number;
  failed: number;
};

type BatchCounts = { pending: number; finished: number; failed: number };

const LOG_CAP = 50;

type Options = {
  questionsRef: MutableRefObject<Question[]>;
  setQuestions: Dispatch<SetStateAction<Question[]>>;
  runGenerate: RunGenerate;
  audience?: SolutionAudience | undefined;
  save: (questions: Question[]) => void;
};

const NO_ANSWER =
  "No right answer was found. The question was left unapproved. Regenerate to try again.";

/**
 * Hint/solution requests run one at a time, in the order questions were approved.
 * A question stays approved only when the model returns a right answer.
 */
export function useSolutionGeneration(options: Options) {
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(() => new Set());
  const [queuedIds, setQueuedIds] = useState<Set<string>>(() => new Set());
  const [promptReveal, setPromptReveal] = useState<SolutionPromptReveal | null>(null);
  const [runLog, setRunLog] = useState<GenerationRunEntry[]>([]);
  const [batch, setBatch] = useState<BatchCounts>({
    pending: 0,
    finished: 0,
    failed: 0,
  });
  const batchRef = useRef(batch);
  const prompts = useRef(new Map<string, string>());
  const queue = useRef(createSolutionQueue()).current;
  const approvalIntent = useRef(new Map<string, boolean>());
  const epochs = useRef(new Map<string, number>());
  const waiting = useRef(new Map<string, number>());
  const optionsRef = useRef(options);
  optionsRef.current = options;

  function patchEntry(
    questionId: string,
    epoch: number,
    patch: (entry: GenerationRunEntry) => GenerationRunEntry,
  ) {
    setRunLog((current) => {
      let changed = false;
      const next = current.map((entry) => {
        if (entry.questionId !== questionId || entry.epoch !== epoch) return entry;
        changed = true;
        return patch(entry);
      });
      return changed ? next : current;
    });
  }

  function updateBatch(patch: (counts: BatchCounts) => void) {
    patch(batchRef.current);
    setBatch({ ...batchRef.current });
  }

  function recordDrain() {
    const counts = batchRef.current;
    if (counts.pending !== 0 || counts.finished + counts.failed === 0) return;
    if (counts.failed > 0) {
      toast.error(
        `All hint generations finished: ${counts.finished} succeeded, ${counts.failed} failed.`,
      );
    } else {
      toast.success(
        `All ${counts.finished} hint generation${counts.finished === 1 ? "" : "s"} finished.`,
      );
    }
  }

  function reveal(ids: string[]) {
    setPromptReveal({ tick: Date.now(), ids });
  }

  function commit(recipe: (current: Question[]) => Question[], transition = false) {
    const apply = () => {
      let snapshot: Question[] | null = null;
      optionsRef.current.setQuestions((current) => {
        snapshot = recipe(current);
        optionsRef.current.questionsRef.current = snapshot;
        return snapshot;
      });
      if (snapshot) optionsRef.current.save(snapshot);
    };
    if (transition) startTransition(apply);
    else apply();
  }

  function dropQueued(ids: Iterable<string>) {
    startTransition(() =>
      setQueuedIds((current) => {
        let changed = false;
        const next = new Set(current);
        for (const id of ids) {
          if (next.delete(id)) changed = true;
        }
        return changed ? next : current;
      }),
    );
  }

  function dropGenerating(ids: Iterable<string>) {
    startTransition(() =>
      setGeneratingIds((current) => {
        let changed = false;
        const next = new Set(current);
        for (const id of ids) {
          if (next.delete(id)) changed = true;
        }
        return changed ? next : current;
      }),
    );
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
    let outcome: "success" | "failed" | "skipped" = "skipped";
    try {
      if (!force && approvalIntent.current.get(questionId) === false) {
        patchEntry(questionId, epoch, (entry) =>
          entry.status === "queued"
            ? { ...entry, status: "skipped", finishedAt: Date.now() }
            : entry,
        );
        return;
      }

      patchEntry(questionId, epoch, (entry) =>
        entry.status === "queued"
          ? { ...entry, status: "generating", startedAt: Date.now() }
          : entry,
      );

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
          patchEntry(questionId, epoch, (entry) => ({
            ...entry,
            targets: ids.length,
            completedTargets: 0,
          }));
          dropQueued([questionId]);
          startTransition(() =>
            setGeneratingIds((current) => {
              const next = new Set(current);
              next.add(questionId);
              for (const id of ids) next.add(id);
              return next;
            }),
          );
        },
        onTargetComplete: () => {
          patchEntry(questionId, epoch, (entry) => ({
            ...entry,
            completedTargets: entry.completedTargets + 1,
          }));
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
        }, true);
        const entryError = result.error ?? (!answersFound ? NO_ANSWER : null);
        outcome = entryError ? "failed" : "success";
        patchEntry(questionId, epoch, (entry) =>
          entry.status === "generating"
            ? {
                ...entry,
                status: outcome === "failed" ? "failed" : "success",
                completedTargets: result.generated.length,
                error: entryError,
                finishedAt: Date.now(),
              }
            : entry,
        );
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
        outcome = "failed";
        patchEntry(questionId, epoch, (entry) =>
          entry.status === "generating"
            ? {
                ...entry,
                status: "failed",
                error: result.error,
                finishedAt: Date.now(),
              }
            : entry,
        );
        commit(
          (current) =>
            updateQuestionById(current, questionId, (question) => ({
              ...question,
              approved: false,
            })),
          true,
        );
        toast.error(result.error);
        reveal([questionId]);
      } else {
        outcome = result.error ? "failed" : "skipped";
        patchEntry(questionId, epoch, (entry) =>
          entry.status === "generating"
            ? {
                ...entry,
                status: outcome === "failed" ? "failed" : "skipped",
                error: result.error,
                finishedAt: Date.now(),
              }
            : entry,
        );
      }
    } catch (error) {
      outcome = "failed";
      const message =
        error instanceof Error ? error.message : "Could not generate hint and solution.";
      patchEntry(questionId, epoch, (entry) =>
        entry.status === "generating"
          ? { ...entry, status: "failed", error: message, finishedAt: Date.now() }
          : entry,
      );
      if (epochs.current.get(questionId) === epoch) {
        commit(
          (current) =>
            updateQuestionById(current, questionId, (question) => ({
              ...question,
              approved: false,
            })),
          true,
        );
        toast.error(
          error instanceof Error ? error.message : "Could not generate hint and solution.",
        );
        reveal([questionId]);
      }
    } finally {
      dropGenerating([questionId, ...requested]);
      if ((waiting.current.get(questionId) ?? 0) > 0) {
        startTransition(() =>
          setQueuedIds((current) => {
            if (current.has(questionId)) return current;
            const next = new Set(current);
            next.add(questionId);
            return next;
          }),
        );
      }
      const counts = batchRef.current;
      counts.pending = Math.max(0, counts.pending - 1);
      if (outcome === "failed") counts.failed += 1;
      else if (outcome === "success") counts.finished += 1;
      recordDrain();
      setBatch({ ...counts });
    }
  }

  const runGenerationRef = useRef(runGeneration);
  runGenerationRef.current = runGeneration;

  const enqueue = useCallback(
    (questionId: string, force: boolean, userPrompt?: string) => {
      waiting.current.set(questionId, (waiting.current.get(questionId) ?? 0) + 1);
      const epoch = (epochs.current.get(questionId) ?? 0) + 1;
      epochs.current.set(questionId, epoch);
      const number =
        findQuestionById(optionsRef.current.questionsRef.current, questionId)?.number ?? null;
      setRunLog((current) =>
        [
          ...current.map((entry) =>
            entry.questionId === questionId &&
            entry.epoch !== epoch &&
            (entry.status === "queued" || entry.status === "generating")
              ? { ...entry, status: "superseded" as const }
              : entry,
          ),
          {
            questionId,
            number,
            epoch,
            status: "queued" as const,
            force,
            targets: 0,
            completedTargets: 0,
            error: null,
            queuedAt: Date.now(),
            startedAt: null,
            finishedAt: null,
          },
        ].slice(-LOG_CAP),
      );
      updateBatch((counts) => {
        if (counts.pending === 0) {
          counts.finished = 0;
          counts.failed = 0;
        }
        counts.pending += 1;
      });
      startTransition(() =>
        setQueuedIds((current) => {
          if (current.has(questionId)) return current;
          const next = new Set(current);
          next.add(questionId);
          return next;
        }),
      );
      void queue(() => runGenerationRef.current(questionId, force, userPrompt, epoch));
    },
    [queue],
  );

  const approve = useCallback(
    (questionId: string, approved: boolean, extra?: { userPrompt?: string }) => {
      approvalIntent.current.set(questionId, approved);
      commit((current) =>
        updateQuestionById(current, questionId, (question) => ({ ...question, approved })),
      );
      if (approved) enqueue(questionId, false, extra?.userPrompt);
    },
    [enqueue],
  );

  const regenerate = useCallback(
    (questionId: string, extra?: { userPrompt?: string }) => {
      approvalIntent.current.set(questionId, true);
      enqueue(questionId, true, extra?.userPrompt);
    },
    [enqueue],
  );

  const clearGenerationLog = useCallback(() => {
    batchRef.current = { pending: 0, finished: 0, failed: 0 };
    setBatch({ pending: 0, finished: 0, failed: 0 });
    setRunLog([]);
  }, []);

  const generationStatus: GenerationStatus = {
    state: batch.pending > 0 ? "active" : runLog.length > 0 ? "done" : "idle",
    entries: runLog,
    running: runLog.find((entry) => entry.status === "generating") ?? null,
    queued: runLog.filter((entry) => entry.status === "queued"),
    pending: batch.pending,
    finished: batch.finished,
    failed: batch.failed,
  };

  return {
    generatingIds,
    queuedIds,
    promptReveal,
    prompts,
    approve,
    regenerate,
    generationStatus,
    clearGenerationLog,
  };
}
