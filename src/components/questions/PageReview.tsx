import { CheckCircle2, Image as ImageIcon } from "lucide-react";

import { QuestionCard } from "@/components/questions/QuestionCard";
import { Badge } from "@/components/ui/badge";
import type { Question } from "@/lib/question-schema";

type Props = {
  questions: Question[];
  pageUrls: Array<string | undefined>;
  resolveFigure?: ((path: string) => string | undefined) | undefined;
  onApprovalChange?: ((questionId: string, approved: boolean) => void) | undefined;
};

export function PageReview({ questions, pageUrls, resolveFigure, onApprovalChange }: Props) {
  const pageNumbers = [...new Set(questions.map((question) => question.page ?? 0))].sort(
    (a, b) => a - b,
  );

  return (
    <div className="space-y-8">
      {pageNumbers.map((pageNumber) => {
        const pageQuestions = questions.filter((question) => (question.page ?? 0) === pageNumber);
        const approved = pageQuestions.filter((question) => question.approved === true).length;
        const sourceUrl = pageUrls[pageNumber];

        return (
          <section key={pageNumber} className="space-y-4" aria-labelledby={`page-${pageNumber + 1}`}>
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <h2 id={`page-${pageNumber + 1}`} className="text-2xl">
                Page {pageNumber + 1}
              </h2>
              <Badge variant="outline" className="ml-auto gap-1">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {approved}/{pageQuestions.length} approved
              </Badge>
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
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}