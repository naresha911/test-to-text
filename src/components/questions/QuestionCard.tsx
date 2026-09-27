import {
  CheckCircle2,
  CircleDot,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { MathText } from "@/components/MathText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  withQuestionType,
  type Figure,
  type Option,
  type Question,
} from "@/lib/question-schema";
import { cn } from "@/lib/utils";

type Resolver = (path: string) => string | undefined;

function FigureBlock({ figure, resolve }: { figure: Figure; resolve?: Resolver | undefined }) {
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

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function nextOptionKey(options: Option[]): string {
  const used = new Set(options.map((option) => option.key));
  for (let index = 0; index < 26; index += 1) {
    const key = String.fromCharCode(65 + index);
    if (!used.has(key)) return key;
  }
  let number = 1;
  while (used.has(String(number))) number += 1;
  return String(number);
}

function OptionList({
  question,
  editing,
  onChange,
}: {
  question: Question;
  editing: boolean;
  onChange?: ((next: Question) => void) | undefined;
}) {
  if (!question.options.length && !editing) return null;
  const correct = new Set(question.answer_keys);
  const multi = question.type === "multi_select";
  const canEditChoices = question.type === "mcq" || question.type === "multi_select";

  if (editing && onChange) {
    return (
      <div className="mt-3">
        <ul className="grid gap-2">
          {question.options.map((option, index) => (
            <li key={`${option.key}-${index}`} className="flex items-start gap-2">
              <Input
                value={option.key}
                className="h-9 w-14 shrink-0"
                aria-label={`Option ${index + 1} key`}
                onChange={(event) => {
                  const nextKey = event.target.value;
                  const previousKey = option.key;
                  const options = question.options.map((item, i) =>
                    i === index ? { ...item, key: nextKey } : item,
                  );
                  const answer_keys =
                    nextKey === previousKey
                      ? question.answer_keys
                      : question.answer_keys.map((key) => (key === previousKey ? nextKey : key));
                  onChange({ ...question, options, answer_keys });
                }}
              />
              <Textarea
                value={option.text}
                rows={2}
                className="min-h-[2.5rem] flex-1"
                aria-label={`Option ${option.key} text`}
                onChange={(event) => {
                  const options = question.options.map((item, i) =>
                    i === index ? { ...item, text: event.target.value } : item,
                  );
                  onChange({ ...question, options });
                }}
              />
              <label className="flex items-center gap-1 pt-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={option.is_correct === true || correct.has(option.key)}
                  onCheckedChange={(checked) => {
                    const isCorrect = checked === true;
                    const options = question.options.map((item, i) =>
                      i === index ? { ...item, is_correct: isCorrect } : item,
                    );
                    const answer_keys = isCorrect
                      ? [...new Set([...question.answer_keys, option.key])]
                      : question.answer_keys.filter((key) => key !== option.key);
                    onChange({ ...question, options, answer_keys });
                  }}
                />
                Correct
              </label>
              {canEditChoices ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
                  aria-label={`Delete option ${option.key || index + 1}`}
                  disabled={question.options.length <= 2}
                  onClick={() => {
                    const options = question.options.filter((_, i) => i !== index);
                    const answer_keys = question.answer_keys.filter((key) => key !== option.key);
                    onChange({ ...question, options, answer_keys });
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canEditChoices ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() =>
              onChange({
                ...question,
                options: [
                  ...question.options,
                  { key: nextOptionKey(question.options), text: "", is_correct: null },
                ],
              })
            }
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add option
          </Button>
        ) : null}
      </div>
    );
  }

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

function TypeBody({
  question,
  resolve,
  editing,
  onChange,
  generatingIds,
  onRegenerate,
  onDelete,
}: {
  question: Question;
  resolve?: Resolver | undefined;
  editing: boolean;
  onChange?: ((next: Question) => void) | undefined;
  generatingIds?: Set<string> | undefined;
  onRegenerate?: ((questionId: string) => void) | undefined;
  onDelete?: ((questionId: string) => void) | undefined;
}) {
  switch (question.type) {
    case "assertion_reason":
      return (
        <div className="mt-3 space-y-2">
          <div className="rounded-md border-l-2 border-primary bg-secondary/40 px-3 py-2">
            <FieldLabel>Assertion</FieldLabel>
            {editing && onChange ? (
              <Textarea
                value={question.assertion ?? ""}
                rows={3}
                onChange={(event) => onChange({ ...question, assertion: event.target.value })}
              />
            ) : (
              <MathText value={question.assertion ?? null} />
            )}
          </div>
          <div className="rounded-md border-l-2 border-highlight bg-secondary/40 px-3 py-2">
            <FieldLabel>Reason</FieldLabel>
            {editing && onChange ? (
              <Textarea
                value={question.reason ?? ""}
                rows={3}
                onChange={(event) => onChange({ ...question, reason: event.target.value })}
              />
            ) : (
              <MathText value={question.reason ?? null} />
            )}
          </div>
          <OptionList question={question} editing={editing} {...(onChange ? { onChange } : {})} />
        </div>
      );

    case "true_false":
      return (
        <div className="mt-3 flex gap-2">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              disabled={!editing || !onChange}
              onClick={() => onChange?.({ ...question, answer_boolean: value })}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm",
                question.answer_boolean === value && "border-success/60 bg-success/10 font-medium",
                editing && "cursor-pointer hover:bg-secondary/60",
              )}
            >
              {question.answer_boolean === value ? (
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              ) : (
                <CircleDot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
              {value ? "True" : "False"}
            </button>
          ))}
        </div>
      );

    case "fill_blank":
      return (
        <div className="mt-3 space-y-2">
          {question.blanks.length || editing ? (
            <ol className="grid gap-2 sm:grid-cols-2">
              {(question.blanks.length ? question.blanks : [""]).map((blank, index) => (
                <li
                  key={index}
                  className="flex items-baseline gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="text-xs font-semibold text-muted-foreground">
                    Blank {index + 1}
                  </span>
                  {editing && onChange ? (
                    <Input
                      value={blank}
                      className="h-8 flex-1"
                      onChange={(event) => {
                        const blanks = [...question.blanks];
                        if (!blanks.length) blanks.push("");
                        blanks[index] = event.target.value;
                        onChange({ ...question, blanks });
                      }}
                    />
                  ) : blank ? (
                    <MathText value={blank} className="font-medium" />
                  ) : (
                    <span className="text-muted-foreground italic">not printed</span>
                  )}
                </li>
              ))}
            </ol>
          ) : null}
          <OptionList question={question} editing={editing} {...(onChange ? { onChange } : {})} />
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
                    {editing && onChange ? (
                      <Textarea
                        value={pair.left}
                        rows={2}
                        onChange={(event) => {
                          const match_pairs = question.match_pairs.map((item, i) =>
                            i === index ? { ...item, left: event.target.value } : item,
                          );
                          onChange({ ...question, match_pairs });
                        }}
                      />
                    ) : (
                      <MathText value={pair.left} />
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {editing && onChange ? (
                      <Textarea
                        value={pair.right}
                        rows={2}
                        onChange={(event) => {
                          const match_pairs = question.match_pairs.map((item, i) =>
                            i === index ? { ...item, right: event.target.value } : item,
                          );
                          onChange({ ...question, match_pairs });
                        }}
                      />
                    ) : pair.right ? (
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
          {question.passage || editing ? (
            <blockquote className="rounded-md border border-border bg-secondary/40 px-4 py-3 text-sm">
              <FieldLabel>Passage</FieldLabel>
              {editing && onChange ? (
                <Textarea
                  value={question.passage ?? ""}
                  rows={6}
                  onChange={(event) => onChange({ ...question, passage: event.target.value })}
                />
              ) : (
                <MathText value={question.passage ?? null} />
              )}
            </blockquote>
          ) : null}
          <div className="space-y-3 border-l-2 border-border pl-4">
            {question.sub_questions.map((sub, index) => (
              <QuestionCard
                key={sub.id}
                question={sub}
                index={index}
                nested
                {...(resolve ? { resolve } : {})}
                {...(onChange
                  ? {
                      onChange: (next) => {
                        const sub_questions = question.sub_questions.map((item) =>
                          item.id === next.id ? next : item,
                        );
                        onChange({ ...question, sub_questions });
                      },
                    }
                  : {})}
                {...(generatingIds ? { generatingIds } : {})}
                {...(onRegenerate ? { onRegenerate } : {})}
                {...(onDelete ? { onDelete } : {})}
              />
            ))}
          </div>
        </div>
      );

    case "short_answer":
    case "long_answer":
    case "numerical":
      return (
        <div className="mt-3">
          {editing && onChange ? (
            <div className="rounded-md border border-border px-3 py-2 text-sm">
              <FieldLabel>Answer</FieldLabel>
              <Textarea
                value={question.answer_text ?? ""}
                rows={3}
                onChange={(event) => onChange({ ...question, answer_text: event.target.value })}
              />
            </div>
          ) : question.answer_text ? (
            <div className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
              <FieldLabel>Answer</FieldLabel>
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
      return <OptionList question={question} editing={editing} {...(onChange ? { onChange } : {})} />;
  }
}

function HintSolutionBlock({
  question,
  editing,
  generating,
  onChange,
  onRegenerate,
}: {
  question: Question;
  editing: boolean;
  generating?: boolean | undefined;
  onChange?: ((next: Question) => void) | undefined;
  onRegenerate?: (() => void) | undefined;
}) {
  const show = editing || generating || question.hint || question.explanation || onRegenerate;
  if (!show) return null;

  return (
    <>
      <Separator className="my-3" />
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Hint & solution
          </p>
          {generating ? (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Generating…
            </Badge>
          ) : null}
          {onRegenerate && question.approved && !generating ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs"
              onClick={onRegenerate}
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              Regenerate
            </Button>
          ) : null}
        </div>

        <div>
          <FieldLabel>Hint</FieldLabel>
          {editing && onChange ? (
            <Textarea
              value={question.hint ?? ""}
              rows={2}
              placeholder="Short nudge — no final answer"
              onChange={(event) => onChange({ ...question, hint: event.target.value })}
            />
          ) : question.hint ? (
            <MathText value={question.hint} className="text-muted-foreground" />
          ) : (
            <p className="text-muted-foreground italic">
              {generating ? "Writing a hint…" : "Approve this question to generate a hint."}
            </p>
          )}
        </div>

        <div>
          <FieldLabel>Solution</FieldLabel>
          {editing && onChange ? (
            <Textarea
              value={question.explanation ?? ""}
              rows={5}
              placeholder="Full worked solution"
              onChange={(event) => onChange({ ...question, explanation: event.target.value })}
            />
          ) : question.explanation ? (
            <MathText value={question.explanation} className="text-muted-foreground" />
          ) : (
            <p className="text-muted-foreground italic">
              {generating ? "Writing a solution…" : "Approve this question to generate a solution."}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

export function QuestionCard({
  question,
  index,
  nested = false,
  resolve,
  onApprovalChange,
  onChange,
  onRegenerate,
  onDelete,
  generatingIds,
}: {
  question: Question;
  index: number;
  nested?: boolean;
  resolve?: Resolver | undefined;
  onApprovalChange?: ((approved: boolean) => void) | undefined;
  onChange?: ((next: Question) => void) | undefined;
  onRegenerate?: ((questionId: string) => void) | undefined;
  onDelete?: ((questionId: string) => void) | undefined;
  generatingIds?: Set<string> | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const generating = generatingIds?.has(question.id) === true;
  const canEdit = !!onChange;

  return (
    <article
      className={cn(
        "text-card-foreground",
        nested
          ? "pt-1"
          : "rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-paper)]",
        editing && "ring-1 ring-primary/30",
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        {editing && onChange ? (
          <Input
            value={question.number ?? ""}
            className="h-7 w-20"
            placeholder={`Q${index + 1}`}
            aria-label="Question number"
            onChange={(event) => onChange({ ...question, number: event.target.value || null })}
          />
        ) : (
          <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
            {question.number ?? `Q${index + 1}`}
          </span>
        )}

        {editing && onChange ? (
          <select
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            value={question.type}
            aria-label="Question type"
            onChange={(event) =>
              onChange(withQuestionType(question, event.target.value as Question["type"]))
            }
          >
            {QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {QUESTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        ) : (
          <Badge variant="secondary" className="gap-1">
            <ListChecks className="h-3 w-3" aria-hidden="true" />
            {QUESTION_TYPE_LABELS[question.type]}
          </Badge>
        )}

        {question.section ? <Badge variant="outline">Section {question.section}</Badge> : null}
        {question.marks != null ? (
          <Badge variant="outline">
            {question.marks} mark{question.marks === 1 ? "" : "s"}
          </Badge>
        ) : null}
        {question.negative_marks != null ? (
          <Badge variant="outline">−{question.negative_marks}</Badge>
        ) : null}
        {question.difficulty ? (
          <Badge variant="outline" className="capitalize">
            {question.difficulty}
          </Badge>
        ) : null}
        {question.page != null ? (
          <span className="text-xs text-muted-foreground">Page {question.page + 1}</span>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              aria-label={`Delete question ${question.number ?? index + 1}`}
              onClick={() => {
                const label = question.number ?? `Q${index + 1}`;
                if (window.confirm(`Delete ${label}? This cannot be undone.`)) {
                  onDelete(question.id);
                }
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}

          {canEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={editing ? "Done editing" : "Edit question"}
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? (
                <X className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Pencil className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          ) : null}

          {!nested && onApprovalChange ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
              <Checkbox
                checked={question.approved === true}
                onCheckedChange={(checked) => onApprovalChange(checked === true)}
                aria-label={`Mark question ${question.number ?? index + 1} approved`}
              />
              Approved
            </label>
          ) : question.approved ? (
            <Badge variant="outline" className="border-success/60 bg-success/10 text-success">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Approved
            </Badge>
          ) : null}
        </div>
      </header>

      {question.instructions || editing ? (
        editing && onChange ? (
          <div className="mt-2">
            <FieldLabel>Instructions</FieldLabel>
            <Input
              value={question.instructions ?? ""}
              onChange={(event) =>
                onChange({ ...question, instructions: event.target.value || null })
              }
            />
          </div>
        ) : question.instructions ? (
          <p className="mt-2 text-xs text-muted-foreground italic">{question.instructions}</p>
        ) : null
      ) : null}

      {editing && onChange ? (
        <div className="mt-3">
          <FieldLabel>Stem</FieldLabel>
          <Textarea
            value={question.stem}
            rows={8}
            className="min-h-48"
            aria-label="Recognised question text"
            onChange={(event) => onChange({ ...question, stem: event.target.value })}
          />
        </div>
      ) : (
        <MathText value={question.stem} className="mt-3 text-[15px]" />
      )}

      {editing && onChange ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div>
            <FieldLabel>Section</FieldLabel>
            <Input
              value={question.section ?? ""}
              onChange={(event) =>
                onChange({ ...question, section: event.target.value || null })
              }
            />
          </div>
          <div>
            <FieldLabel>Marks</FieldLabel>
            <Input
              type="number"
              value={question.marks ?? ""}
              onChange={(event) =>
                onChange({
                  ...question,
                  marks: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </div>
          <div>
            <FieldLabel>Negative marks</FieldLabel>
            <Input
              type="number"
              value={question.negative_marks ?? ""}
              onChange={(event) =>
                onChange({
                  ...question,
                  negative_marks:
                    event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </div>
          <div>
            <FieldLabel>Difficulty</FieldLabel>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={question.difficulty ?? ""}
              onChange={(event) =>
                onChange({
                  ...question,
                  difficulty: (event.target.value || null) as "easy" | "medium" | "hard" | null,
                })
              }
            >
              <option value="">Unset</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div>
            <FieldLabel>Subject ID</FieldLabel>
            <Input
              type="number"
              value={question.subject_id ?? ""}
              onChange={(event) =>
                onChange({
                  ...question,
                  subject_id: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </div>
          <div>
            <FieldLabel>Topic ID</FieldLabel>
            <Input
              type="number"
              value={question.topic_id ?? ""}
              onChange={(event) =>
                onChange({
                  ...question,
                  topic_id: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </div>
          <div className="sm:col-span-3">
            <FieldLabel>Tags (comma separated)</FieldLabel>
            <Input
              value={question.tags.join(", ")}
              onChange={(event) =>
                onChange({
                  ...question,
                  tags: event.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
        </div>
      ) : null}

      {question.figures.length ? (
        <div className="mt-3 space-y-2">
          {question.figures.map((figure, i) => (
            <FigureBlock key={i} figure={figure} {...(resolve ? { resolve } : {})} />
          ))}
        </div>
      ) : null}

      <TypeBody
        question={question}
        editing={editing}
        {...(resolve ? { resolve } : {})}
        {...(onChange ? { onChange } : {})}
        {...(generatingIds ? { generatingIds } : {})}
        {...(onRegenerate ? { onRegenerate } : {})}
        {...(onDelete ? { onDelete } : {})}
      />

      {question.type !== "comprehension" || !question.sub_questions.length ? (
        <HintSolutionBlock
          question={question}
          editing={editing}
          {...(generating ? { generating: true } : {})}
          {...(onChange ? { onChange } : {})}
          {...(onRegenerate
            ? { onRegenerate: () => onRegenerate(question.id) }
            : {})}
        />
      ) : null}
    </article>
  );
}
