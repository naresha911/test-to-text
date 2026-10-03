import { CheckCircle2, Image as ImageIcon } from "lucide-react";
import { useMemo, useRef, useState, type MutableRefObject } from "react";

import { AddQuestionForm, type NewQuestionInput } from "@/components/questions/AddQuestionForm";
import { QuestionCard } from "@/components/questions/QuestionCard";
import { SolutionUiContext, type SolutionUiValue } from "@/components/questions/solution-ui";
import { questionFamilyBusy } from "@/components/questions/use-question-draft";
import { Badge } from "@/components/ui/badge";
import type { SolutionPromptReveal } from "@/hooks/useSolutionGeneration";
import { sortQuestions } from "@/lib/question-order";
import type { SolutionAudience } from "@/lib/question-context";
import type { Question } from "@/lib/question-schema";
import type { CropLayout } from "@/lib/reading/crop-layout";
import type { ContentMode } from "@/lib/reading/mode";

const EMPTY_QUEUED = new Set<string>();

type Props = {
  questions: Question[];
  /** Numbers used to suggest the next question number. Defaults to `questions`. */
  numberingQuestions?: Question[] | undefined;
  /** When true, shows original page images above each page's questions (library view). */
  showImages?: boolean | undefined;
  pageUrls?: Array<string | undefined> | undefined;
  resolveFigure?: ((path: string) => string | undefined) | undefined;
  onApprovalChange?:
    | ((questionId: string, approved: boolean, options?: { userPrompt?: string }) => void)
    | undefined;
  onQuestionChange?: ((question: Question) => void) | undefined;
  onRegenerate?:
    | ((questionId: string, options?: { userPrompt?: string }) => void)
    | undefined;
  solutionAudience?: SolutionAudience | undefined;
  queuedIds?: Set<string> | undefined;
  promptReveal?: SolutionPromptReveal | null | undefined;
  /** Latest edited prompt for each question, shared with solution generation. */
  promptStore?: MutableRefObject<Map<string, string>> | undefined;
  onDelete?: ((questionId: string) => void) | undefined;
  onAddQuestion?: ((input: NewQuestionInput) => string | void) | undefined;
  /** Paste a clipboard image into storage and return its path. */
  onPasteFigure?: ((file: File) => Promise<string>) | undefined;
  /** Open this question for editing, usually one the toolbar just added. */
  focusQuestionId?: string | null | undefined;
  onReviewGenerated?: ((questionId: string, status: "reviewed" | "rejected") => void) | undefined;
  onRegenerateGenerated?: ((questionId: string) => void) | undefined;
  onRegenerateFigure?: ((questionId: string) => void) | undefined;
  generatingIds?: Set<string> | undefined;
  onReadCrop?: ((question: Question, layout: CropLayout) => Promise<Question>) | undefined;
  contentModeForPage?: ((page: number | null | undefined) => ContentMode) | undefined;
  /** Scroll the image viewer to this 1-based page. */
  onOpenPage?: ((displayedPage: number) => void) | undefined;
};

export function PageReview({
  questions,
  numberingQuestions,
  showImages = true,
  pageUrls = [],
  resolveFigure,
  onApprovalChange,
  onQuestionChange,
  onRegenerate,
  onDelete,
  onAddQuestion,
  onPasteFigure,
  focusQuestionId,
  onReviewGenerated,
  onRegenerateGenerated,
  onRegenerateFigure,
  generatingIds,
  solutionAudience,
  queuedIds,
  promptReveal,
  promptStore,
  onReadCrop,
  contentModeForPage,
  onOpenPage,
}: Props) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const fallbackPrompts = useRef(new Map<string, string>());
  const prompts = promptStore ?? fallbackPrompts;
  const generatingIdsRef = useRef(generatingIds ?? EMPTY_QUEUED);
  generatingIdsRef.current = generatingIds ?? EMPTY_QUEUED;
  const queuedIdsRef = useRef(queuedIds ?? EMPTY_QUEUED);
  queuedIdsRef.current = queuedIds ?? EMPTY_QUEUED;
  const solutionUi = useMemo<SolutionUiValue>(
    () => ({
      ...(solutionAudience ? { audience: solutionAudience } : {}),
      promptReveal: promptReveal ?? null,
      prompts,
      generatingIdsRef,
      queuedIdsRef,
    }),
    [solutionAudience, promptReveal, prompts, generatingIdsRef, queuedIdsRef],
  );
  const sorted = sortQuestions(questions);

  function handleAdd(input: NewQuestionInput) {
    const id = onAddQuestion?.(input);
    if (typeof id === "string") setFocusId(id);
  }

  return (
    <SolutionUiContext.Provider value={solutionUi}>
    <div className="space-y-4">
      {onAddQuestion ? (
        <AddQuestionForm questions={numberingQuestions ?? questions} onAdd={handleAdd} />
      ) : null}

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No questions yet. Add one and give it a question number — the cards stay in that order.
        </p>
      ) : null}

      {sorted.map((question, index) => {
        const pageNumber = question.page ?? null;
        const previousPage = index === 0 ? undefined : (sorted[index - 1]?.page ?? null);
        const showPage = showImages && pageNumber != null && pageNumber !== previousPage;
        const pageQuestions = showPage ? sorted.filter((item) => item.page === pageNumber) : [];
        const approved = pageQuestions.filter((item) => item.approved === true).length;
        const checked = pageQuestions.filter((item) => item.source_block);
        const passedChecks = checked.filter(
          (item) => (item.source_block?.flags.length ?? 0) === 0,
        ).length;
        const sourceUrl = pageNumber == null ? undefined : pageUrls[pageNumber];
        const headingId = `page-${pageNumber ?? "none"}-${question.id}`;

        return (
          <div key={question.id} className="space-y-4">
            {showPage && pageNumber != null ? (
              <section className="space-y-4" aria-labelledby={headingId}>
                <div className="flex items-center gap-2 border-b border-border pb-2">
                  <h2 id={headingId} className="text-2xl">
                    Page {pageNumber + 1}
                  </h2>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {checked.length ? (
                      <Badge variant="outline">
                        {passedChecks} of {checked.length} passed checks
                      </Badge>
                    ) : null}
                    <Badge variant="outline" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      {approved}/{pageQuestions.length} approved
                    </Badge>
                  </div>
                </div>
                {sourceUrl ? (
                  <figure className="overflow-hidden rounded-lg border border-border bg-secondary/30 p-3">
                    <img
                      src={sourceUrl}
                      alt={`Original uploaded question paper page ${pageNumber + 1}`}
                      className="mx-auto max-h-[70vh] w-auto max-w-full rounded border border-border object-contain"
                    />
                    <figcaption className="mt-2 text-center text-xs text-muted-foreground">
                      Original page {pageNumber + 1}
                    </figcaption>
                  </figure>
                ) : (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-8 text-sm text-muted-foreground">
                    <ImageIcon className="h-4 w-4" aria-hidden="true" />
                    Original page image is unavailable
                  </div>
                )}
              </section>
            ) : null}

            <QuestionCard
              question={question}
              index={index}
              startEditing={question.id === focusId || question.id === focusQuestionId}
              generating={questionFamilyBusy(question, generatingIds)}
              queued={questionFamilyBusy(question, queuedIds)}
              {...(resolveFigure ? { resolve: resolveFigure } : {})}
              {...(onApprovalChange ? { onApprovalChange } : {})}
              {...(onQuestionChange ? { onChange: onQuestionChange } : {})}
              {...(onRegenerate ? { onRegenerate } : {})}
              {...(onDelete ? { onDelete } : {})}
              {...(onReviewGenerated ? { onReviewGenerated } : {})}
              {...(onRegenerateGenerated ? { onRegenerateGenerated } : {})}
              {...(onRegenerateFigure ? { onRegenerateFigure } : {})}
              {...(onPasteFigure ? { onPasteFigure } : {})}
              {...(onOpenPage ? { onOpenPage } : {})}
              {...(onReadCrop
                ? {
                    onReadCrop,
                    contentMode: contentModeForPage?.(question.page) ?? "text",
                  }
                : {})}
            />
          </div>
        );
      })}
    </div>
    </SolutionUiContext.Provider>
  );
}
