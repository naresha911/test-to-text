import { CheckCircle2, Image as ImageIcon } from "lucide-react";

import { QuestionCard } from "@/components/questions/QuestionCard";
import { Badge } from "@/components/ui/badge";
import type { Question } from "@/lib/question-schema";

type Props = {
  questions: Question[];
  /** When true, shows original page images above each page's questions (library view). */
  showImages?: boolean | undefined;
  pageUrls?: Array<string | undefined> | undefined;
  resolveFigure?: ((path: string) => string | undefined) | undefined;
  onApprovalChange?: ((questionId: string, approved: boolean) => void) | undefined;
  onQuestionChange?: ((question: Question) => void) | undefined;
  onRegenerate?: ((questionId: string) => void) | undefined;
  onDelete?: ((questionId: string) => void) | undefined;
  generatingIds?: Set<string> | undefined;
};

export function PageReview({
  questions,
  showImages = true,
  pageUrls = [],
  resolveFigure,
  onApprovalChange,
  onQuestionChange,
  onRegenerate,
  onDelete,
  generatingIds,
}: Props) {
  const pageNumbers = [...new Set(questions.map((question) => question.page ?? null))].sort(
    (a, b) => {
      if (a == null) return 1;
      if (b == null) return -1;
      return a - b;
    },
  );

  return (
    <div className="space-y-8">
      {pageNumbers.map((pageNumber) => {
        const pageQuestions = questions.filter(
          (question) => (question.page ?? null) === pageNumber,
        );
        const approved = pageQuestions.filter((question) => question.approved === true).length;
        const sourceUrl = pageNumber == null ? undefined : pageUrls[pageNumber];
        const pageLabel = pageNumber == null ? "Source image removed" : `Page ${pageNumber + 1}`;
        const headingId = pageNumber == null ? "page-removed" : `page-${pageNumber + 1}`;

        return (
          <section key={headingId} className="space-y-4" aria-labelledby={headingId}>
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <h2 id={headingId} className="text-2xl">
                {pageLabel}
              </h2>
              <Badge variant="outline" className="ml-auto gap-1">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {approved}/{pageQuestions.length} approved
              </Badge>
            </div>

            {showImages ? (
              pageNumber != null && sourceUrl ? (
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
              )
            ) : null}

            <div className="space-y-4">
              {pageQuestions.map((question, index) => (
                <QuestionCard
                  key={question.id ?? `${pageNumber}-${index}`}
                  question={question}
                  index={index}
                  {...(resolveFigure ? { resolve: resolveFigure } : {})}
                  {...(onApprovalChange
                    ? {
                        onApprovalChange: (next) => onApprovalChange(question.id, next),
                      }
                    : {})}
                  {...(onQuestionChange ? { onChange: onQuestionChange } : {})}
                  {...(onRegenerate ? { onRegenerate } : {})}
                  {...(onDelete ? { onDelete } : {})}
                  {...(generatingIds ? { generatingIds } : {})}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
