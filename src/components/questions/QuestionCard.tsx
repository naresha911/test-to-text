import { CheckCircle2, CircleDot, Image as ImageIcon, ListChecks } from "lucide-react";

import { MathText } from "@/components/MathText";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { QUESTION_TYPE_LABELS, type Figure, type Question } from "@/lib/question-schema";
import { cn } from "@/lib/utils";

type Resolver = (path: string) => string | undefined;

function FigureBlock({ figure, resolve }: { figure: Figure; resolve?: Resolver }) {
  const url = figure.image_path ? resolve?.(figure.image_path) : undefined;
  return (
    <figure className="rounded-md border border-border bg-secondary/50 p-3">
      <div className="flex items-start gap-3">
        {url ? (
          <img
            src={url}
            alt={figure.description || "Figure from the question paper"}
            loading="lazy"
            className="max-h-48 w-auto max-w-[45%] rounded border border-border bg-paper object-contain"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-dashed border-border text-muted-foreground">
            <ImageIcon className="h-5 w-5" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-foreground">Figure</p>
          <MathText value={figure.description} className="text-muted-foreground" />
          {figure.caption ? (
            <figcaption className="mt-1 text-xs text-muted-foreground italic">
              {figure.caption}
            </figcaption>
          ) : null}
        </div>
      </div>
    </figure>
  );
}

function OptionList({ question }: { question: Question }) {
  if (!question.options.length) return null;
  const correct = new Set(question.answer_keys);
  const multi = question.type === "multi_select";
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
      {question.options.map((option) => {
        const isCorrect = option.is_correct === true || correct.has(option.key);
        return (
          <li
            key={option.key + option.text}
            className={cn(
              "flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm",
              isCorrect && "border-success/50 bg-success/10",
            )}
          >
            <span
              className={cn(
                "mt-px flex h-5 w-5 shrink-0 items-center justify-center text-xs font-semibold",
                multi ? "rounded-sm" : "rounded-full",
                isCorrect
                  ? "bg-success text-success-foreground"
                  : "bg-secondary text-secondary-foreground",
              )}
            >
              {option.key}
            </span>
            <MathText value={option.text} className="min-w-0" />
          </li>
        );
      })}
    </ul>
  );
}

function TypeBody({ question, resolve }: { question: Question; resolve?: Resolver }) {
  switch (question.type) {
    case "assertion_reason":
      return (
        <div className="mt-3 space-y-2">
          <div className="rounded-md border-l-2 border-primary bg-secondary/40 px-3 py-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Assertion
            </p>
            <MathText value={question.assertion} />
          </div>
          <div className="rounded-md border-l-2 border-highlight bg-secondary/40 px-3 py-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Reason
            </p>
            <MathText value={question.reason} />
          </div>
          <OptionList question={question} />
        </div>
      );

    case "true_false":
      return (
        <div className="mt-3 flex gap-2">
          {[true, false].map((value) => (
            <span
              key={String(value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm",
                question.answer_boolean === value && "border-success/60 bg-success/10 font-medium",
              )}
            >
              {question.answer_boolean === value ? (
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              ) : (
                <CircleDot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
              {value ? "True" : "False"}
            </span>
          ))}
        </div>
      );

    case "fill_blank":
      return (
        <div className="mt-3 space-y-2">
          {question.blanks.length ? (
            <ol className="grid gap-2 sm:grid-cols-2">
              {question.blanks.map((blank, index) => (
                <li
                  key={index}
                  className="flex items-baseline gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="text-xs font-semibold text-muted-foreground">
                    Blank {index + 1}
                  </span>
                  {blank ? (
                    <MathText value={blank} className="font-medium" />
                  ) : (
                    <span className="text-muted-foreground italic">not printed</span>
                  )}
                </li>
              ))}
            </ol>
          ) : null}
          <OptionList question={question} />
        </div>
      );

    case "match_the_following":
      return (
        <div className="mt-3 overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Column A</th>
                <th className="px-3 py-2 text-left font-semibold">Column B</th>
              </tr>
            </thead>
            <tbody>
              {question.match_pairs.map((pair, index) => (
                <tr key={index} className="border-t border-border">
                  <td className="px-3 py-2 align-top">
                    <MathText value={pair.left} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    {pair.right ? (
                      <MathText value={pair.right} />
                    ) : (
                      <span className="text-muted-foreground italic">unmatched</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "comprehension":
      return (
        <div className="mt-3 space-y-4">
          {question.passage ? (
            <blockquote className="rounded-md border border-border bg-secondary/40 px-4 py-3 text-sm">
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Passage
              </p>
              <MathText value={question.passage} />
            </blockquote>
          ) : null}
          <div className="space-y-3 border-l-2 border-border pl-4">
            {question.sub_questions.map((sub, index) => (
              <QuestionCard key={sub.id} question={sub} index={index} nested resolve={resolve} />
            ))}
          </div>
        </div>
      );

    case "short_answer":
    case "long_answer":
    case "numerical":
      return (
        <div className="mt-3">
          {question.answer_text ? (
            <div className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Answer
              </p>
              <MathText value={question.answer_text} />
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
              {question.type === "numerical"
                ? "Numerical response expected"
                : "Written response expected"}
            </div>
          )}
        </div>
      );

    default:
      return <OptionList question={question} />;
  }
}

export function QuestionCard({
  question,
  index,
  nested = false,
  resolve,
}: {
  question: Question;
  index: number;
  nested?: boolean;
  resolve?: Resolver;
}) {
  return (
    <article
      className={cn(
        "text-card-foreground",
        nested
          ? "pt-1"
          : "rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-paper)]",
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
          {question.number ?? `Q${index + 1}`}
        </span>
        <Badge variant="secondary" className="gap-1">
          <ListChecks className="h-3 w-3" aria-hidden="true" />
          {QUESTION_TYPE_LABELS[question.type]}
        </Badge>
        {question.section ? <Badge variant="outline">Section {question.section}</Badge> : null}
        {question.marks != null ? (
          <Badge variant="outline">
            {question.marks} mark{question.marks === 1 ? "" : "s"}
          </Badge>
        ) : null}
        {question.page != null ? (
          <span className="ml-auto text-xs text-muted-foreground">Page {question.page + 1}</span>
        ) : null}
      </header>

      {question.instructions ? (
        <p className="mt-2 text-xs text-muted-foreground italic">{question.instructions}</p>
      ) : null}

      <MathText value={question.stem} className="mt-3 text-[15px]" />

      {question.figures.length ? (
        <div className="mt-3 space-y-2">
          {question.figures.map((figure, i) => (
            <FigureBlock key={i} figure={figure} resolve={resolve} />
          ))}
        </div>
      ) : null}

      <TypeBody question={question} resolve={resolve} />

      {question.explanation ? (
        <>
          <Separator className="my-3" />
          <div className="text-sm">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Explanation
            </p>
            <MathText value={question.explanation} className="text-muted-foreground" />
          </div>
        </>
      ) : null}
    </article>
  );
}
