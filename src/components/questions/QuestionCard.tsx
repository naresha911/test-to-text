import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { MathText } from "@/components/MathText";
import { MathFormatHelp } from "@/components/questions/MathFormatHelp";
import { QuestionCropDialog } from "@/components/questions/QuestionCropDialog";
import { useSolutionUi } from "@/components/questions/solution-ui";
import {
  questionFamilyBusy,
  useQuestionDraft,
} from "@/components/questions/use-question-draft";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  buildSolutionUserPrompt,
  questionHasAnswer,
  SOLUTION_SYSTEM_PROMPT,
} from "@/lib/question-context";
import { clipboardImageFile } from "@/lib/image-utils";
import { detachImagePath, questionWithoutOption, withPastedFigure } from "@/lib/question-images";
import { applyCropReading, type CropLayout } from "@/lib/reading/crop-layout";
import type { ContentMode } from "@/lib/reading/mode";
import { READ_FLAG_LABELS } from "@/lib/reading/read-audit";
import {
  optionKeyToken,
  parseDisplayedPage,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  withQuestionType,
  type Figure,
  type Option,
  type Question,
  type ReadFlag,
} from "@/lib/question-schema";
import { cn } from "@/lib/utils";

type Resolver = (path: string) => string | undefined;

function DeleteImageButton({ onRemove }: { onRemove: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
      aria-label="Delete figure image"
      onClick={() => {
        if (
          window.confirm(
            "Delete this figure image permanently? The file is removed from this computer once no question still uses it.",
          )
        ) {
          onRemove();
        }
      }}
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  );
}

function FigureBlock({
  figure,
  resolve,
  onRemove,
}: {
  figure: Figure;
  resolve?: Resolver | undefined;
  onRemove?: (() => void) | undefined;
}) {
  const url = figure.image_path ? resolve?.(figure.image_path) : undefined;
  return (
    <figure className="relative rounded-md border border-border bg-secondary/50 p-3">
      {onRemove ? (
        <div className="absolute top-2 right-2">
          <DeleteImageButton onRemove={onRemove} />
        </div>
      ) : null}
      <div className={cn("flex items-start gap-3", onRemove && "pr-8")}>
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

/** Option crops live on the option, or on a matching answer figure when the link was not copied across. */
function optionImage(
  question: Question,
  option: Option,
): { path: string; description: string } | null {
  if (option.image_path) {
    return {
      path: option.image_path,
      description: option.image_description || `Option ${option.key}`,
    };
  }
  const token = optionKeyToken(option.key);
  if (!token) return null;
  const figure = question.figures.find((item) => {
    if (item.role !== "option_figure" || !item.image_path) return false;
    return optionKeyToken(item.caption ?? "") === token;
  });
  if (!figure?.image_path) return null;
  return {
    path: figure.image_path,
    description: figure.description || option.image_description || `Option ${option.key}`,
  };
}

function OptionImage({
  question,
  option,
  resolve,
  onRemoveImage,
}: {
  question: Question;
  option: Option;
  resolve?: Resolver | undefined;
  onRemoveImage?: ((path: string) => void) | undefined;
}) {
  const image = optionImage(question, option);
  if (!image) return null;
  const url = resolve?.(image.path);
  if (!url && !onRemoveImage) return null;
  return (
    <div className="flex items-start gap-2">
      {url ? (
        <img
          src={url}
          alt={image.description}
          className="max-h-28 w-auto max-w-full rounded border border-border bg-paper object-contain"
        />
      ) : null}
      {onRemoveImage ? <DeleteImageButton onRemove={() => onRemoveImage(image.path)} /> : null}
    </div>
  );
}

function OptionList({
  question,
  editing,
  resolve,
  onChange,
}: {
  question: Question;
  editing: boolean;
  resolve?: Resolver | undefined;
  onChange?: ((next: Question) => void) | undefined;
}) {
  if (!question.options.length && !editing) return null;
  const correct = new Set(question.answer_keys);
  const removeImage = onChange
    ? (path: string) => onChange(detachImagePath(question, path))
    : undefined;
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
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <OptionImage
                  question={question}
                  option={option}
                  {...(resolve ? { resolve } : {})}
                  {...(removeImage ? { onRemoveImage: removeImage } : {})}
                />
                <Textarea
                  value={option.text}
                  rows={2}
                  className="min-h-[2.5rem] w-full"
                  aria-label={`Option ${option.key} text`}
                  onChange={(event) => {
                    const options = question.options.map((item, i) =>
                      i === index ? { ...item, text: event.target.value } : item,
                    );
                    onChange({ ...question, options });
                  }}
                />
              </div>
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
                  onClick={() => onChange(questionWithoutOption(question, index))}
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
            <div className="min-w-0 space-y-1">
              <OptionImage
                question={question}
                option={option}
                {...(resolve ? { resolve } : {})}
                {...(removeImage ? { onRemoveImage: removeImage } : {})}
              />
              {option.text ? <MathText value={option.text} className="min-w-0" /> : null}
              {!option.text && option.image_description ? (
                <MathText
                  value={option.image_description}
                  className="min-w-0 text-sm text-muted-foreground"
                />
              ) : null}
            </div>
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
  queuedIds,
  onPasteFigure,
  onRegenerate,
  onDelete,
  onOpenPage,
}: {
  question: Question;
  resolve?: Resolver | undefined;
  editing: boolean;
  onChange?: ((next: Question) => void) | undefined;
  generatingIds?: Set<string> | undefined;
  queuedIds?: Set<string> | undefined;
  onPasteFigure?: ((file: File) => Promise<string>) | undefined;
  onRegenerate?: ((questionId: string) => void) | undefined;
  onDelete?: ((questionId: string) => void) | undefined;
  onOpenPage?: ((displayedPage: number) => void) | undefined;
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
          <OptionList
            question={question}
            editing={editing}
            {...(resolve ? { resolve } : {})}
            {...(onChange ? { onChange } : {})}
          />
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
          <OptionList
            question={question}
            editing={editing}
            {...(resolve ? { resolve } : {})}
            {...(onChange ? { onChange } : {})}
          />
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
                generating={questionFamilyBusy(sub, generatingIds)}
                queued={questionFamilyBusy(sub, queuedIds)}
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
                parentPassage={question.passage ?? null}
                {...(onPasteFigure ? { onPasteFigure } : {})}
                {...(onRegenerate ? { onRegenerate } : {})}
                {...(onDelete ? { onDelete } : {})}
                {...(onOpenPage ? { onOpenPage } : {})}
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
      return (
        <OptionList
          question={question}
          editing={editing}
          {...(resolve ? { resolve } : {})}
          {...(onChange ? { onChange } : {})}
        />
      );
  }
}

function HintSolutionBlock({
  question,
  editing,
  generating,
  queued,
  onChange,
  onRegenerate,
}: {
  question: Question;
  editing: boolean;
  generating?: boolean | undefined;
  queued?: boolean | undefined;
  onChange?: ((next: Question) => void) | undefined;
  onRegenerate?: (() => void) | undefined;
}) {
  const answerMissing =
    !questionHasAnswer(question) && Boolean(question.hint?.trim() || question.explanation?.trim());
  const show =
    editing || generating || queued || question.hint || question.explanation || onRegenerate;
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
          ) : queued ? (
            <Badge variant="outline">Queued</Badge>
          ) : null}
          {answerMissing && !generating && !queued ? (
            <Badge variant="outline" className="border-destructive/50 text-destructive">
              No answer
            </Badge>
          ) : null}
          {onRegenerate && !generating && !queued && (question.approved || answerMissing) ? (
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
        {answerMissing && !generating && !queued ? (
          <p className="text-destructive">
            No right answer was found. Edit the AI prompt below and regenerate.
          </p>
        ) : null}

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
              {generating
                ? "Writing a hint…"
                : queued
                  ? "Waiting in the queue…"
                  : "Approve this question to generate a hint."}
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
              {generating
                ? "Writing a solution…"
                : queued
                  ? "Waiting in the queue…"
                  : "Approve this question to generate a solution."}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function EditableNumber({
  question,
  index,
  onChange,
}: {
  question: Question;
  index: number;
  onChange: (next: Question) => void;
}) {
  const [draft, setDraft] = useState(question.number ?? "");
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(question.number ?? "");
  }, [question.number]);

  function commit(field: HTMLInputElement) {
    focused.current = false;
    const next = draft.trim();
    const current = (question.number ?? "").trim();
    if (next === current) return;
    onChange({ ...question, number: next || null });
    requestAnimationFrame(() => {
      field.closest("article")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  return (
    <Input
      value={draft}
      className="h-7 w-24"
      placeholder={`Q${index + 1}`}
      aria-label="Question number"
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function ReadFlags({
  flags,
  onOpen,
}: {
  flags: readonly ReadFlag[];
  onOpen?: (() => void) | undefined;
}) {
  if (!flags.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1">
      {flags.map((flag) =>
        onOpen ? (
          <button key={flag} type="button" className="rounded-md" onClick={onOpen}>
            <Badge variant="secondary">{READ_FLAG_LABELS[flag]}</Badge>
          </button>
        ) : (
          <Badge key={flag} variant="secondary">
            {READ_FLAG_LABELS[flag]}
          </Badge>
        ),
      )}
    </div>
  );
}

function SolutionPrompt({
  open,
  onOpenChange,
  value,
  busy,
  canReset,
  answerMissing,
  onChange,
  onReset,
  onRegenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  busy: boolean;
  canReset: boolean;
  answerMissing: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
  onRegenerate: () => void;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="mt-3">
      <CollapsibleTrigger className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground [&[data-state=open]>svg]:rotate-180">
        <ChevronDown className="h-4 w-4 transition-transform" aria-hidden="true" />
        AI prompt
        {answerMissing ? (
          <Badge variant="outline" className="border-destructive/50 text-destructive">
            No answer
          </Badge>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        <p className="text-sm text-muted-foreground">
          This message is sent when you approve or regenerate. It includes the question details.
          The fixed instructions below go with it. Edit the message and regenerate if the model
          did not find a right answer. Several approvals run one at a time, in the order you check
          them.
        </p>
        <div>
          <FieldLabel>Question message</FieldLabel>
          <Textarea
            value={value}
            rows={12}
            maxLength={80000}
            spellCheck={false}
            className="font-mono text-xs leading-relaxed"
            aria-label="AI prompt for this question"
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {canReset ? (
            <Button type="button" variant="outline" size="sm" onClick={onReset}>
              Reset to current question
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={busy || !value.trim()}
            onClick={onRegenerate}
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Regenerate
          </Button>
        </div>
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium text-muted-foreground [&[data-state=open]>svg]:rotate-180">
            <ChevronDown className="h-3 w-3 transition-transform" aria-hidden="true" />
            Fixed instructions
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-secondary/40 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
              {SOLUTION_SYSTEM_PROMPT}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </CollapsibleContent>
    </Collapsible>
  );
}

function EditablePage({
  page,
  onChange,
}: {
  page: number | null | undefined;
  onChange: (page: number | null) => void;
}) {
  const [text, setText] = useState(page == null ? "" : String(page + 1));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(page == null ? "" : String(page + 1));
  }, [page]);

  function commit(field: HTMLInputElement) {
    focused.current = false;
    const parsed = parseDisplayedPage(text);
    if (!parsed) {
      setText(page == null ? "" : String(page + 1));
      return;
    }
    if ((page ?? null) === parsed.page) return;
    onChange(parsed.page);
    requestAnimationFrame(() => {
      field.closest("article")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      Page
      <Input
        value={text}
        inputMode="numeric"
        placeholder="—"
        aria-label="Page number"
        className="h-7 w-16"
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export const QuestionCard = memo(function QuestionCard({
  question: source,
  index,
  nested = false,
  startEditing = false,
  parentPassage,
  resolve,
  onApprovalChange,
  onChange: publish,
  onRegenerate,
  onDelete,
  onReviewGenerated,
  onRegenerateGenerated,
  onRegenerateFigure,
  onPasteFigure,
  generating = false,
  queued = false,
  onReadCrop,
  contentMode = "text",
  onOpenPage,
}: {
  question: Question;
  index: number;
  nested?: boolean;
  startEditing?: boolean;
  /** Passage from a comprehension parent. Sub-questions do not store it themselves. */
  parentPassage?: string | null;
  resolve?: Resolver | undefined;
  onApprovalChange?:
    | ((questionId: string, approved: boolean, options?: { userPrompt?: string }) => void)
    | undefined;
  onChange?: ((next: Question) => void) | undefined;
  onRegenerate?:
    | ((questionId: string, options?: { userPrompt?: string }) => void)
    | undefined;
  onDelete?: ((questionId: string) => void) | undefined;
  onReviewGenerated?: ((questionId: string, status: "reviewed" | "rejected") => void) | undefined;
  onRegenerateGenerated?: ((questionId: string) => void | Promise<void>) | undefined;
  onRegenerateFigure?: ((questionId: string) => void | Promise<void>) | undefined;
  /** Store a pasted image and return its path. Absent on screens that cannot keep figures. */
  onPasteFigure?: ((file: File) => Promise<string>) | undefined;
  /** This question, or one of its sub-questions, is generating. */
  generating?: boolean;
  queued?: boolean;
  onReadCrop?: ((question: Question, layout: CropLayout) => Promise<Question>) | undefined;
  contentMode?: ContentMode | undefined;
  /** Scroll the image viewer to this 1-based page. Absent where there is no viewer. */
  onOpenPage?: ((displayedPage: number) => void) | undefined;
}) {
  const { draft: question, draftRef, update, flush } = useQuestionDraft(source, publish);
  const onChange = publish ? update : undefined;
  const [editing, setEditing] = useState(startEditing);
  const [cropOpen, setCropOpen] = useState(false);
  const [regeneratingQuestion, setRegeneratingQuestion] = useState(false);
  const [regeneratingFigure, setRegeneratingFigure] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const solutionUi = useSolutionUi();
  const canEdit = !!onChange;
  const canRegenerateSolution =
    Boolean(onRegenerate) &&
    (question.type !== "comprehension" || question.sub_questions.length === 0);
  const showSolutionPrompt = canRegenerateSolution && !question.approval_status;
  const audience = solutionUi?.audience;
  const builtPrompt = useMemo(
    () =>
      buildSolutionUserPrompt(question, {
        ...(parentPassage !== undefined ? { parentPassage } : {}),
        ...(audience ? { audience } : {}),
      }),
    [question, parentPassage, audience],
  );
  const [prompt, setPrompt] = useState(builtPrompt);
  const [promptDirty, setPromptDirty] = useState(false);
  const answerMissing =
    !questionHasAnswer(question) &&
    Boolean(
      question.hint?.trim() ||
        question.explanation?.trim() ||
        solutionUi?.promptReveal?.ids.includes(question.id),
    );
  const [promptOpen, setPromptOpen] = useState(false);
  const offerSolutionRegenerate =
    canRegenerateSolution &&
    (!question.approval_status || question.approved || answerMissing);
  const cropUrl = question.source_block?.image_path
    ? resolve?.(question.source_block.image_path)
    : undefined;
  const canReadCrop = Boolean(onReadCrop && question.source_block);
  const cropLabel = question.number ? `question ${question.number}` : `question ${index + 1}`;
  const readFlags = question.source_block?.flags ?? [];

  useEffect(() => {
    if (!startEditing) return;
    articleRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [startEditing]);

  useEffect(() => {
    if (!promptDirty) setPrompt(builtPrompt);
  }, [builtPrompt, promptDirty]);

  useEffect(() => {
    if (solutionUi?.promptReveal?.ids.includes(question.id)) setPromptOpen(true);
  }, [solutionUi?.promptReveal, question.id]);

  useEffect(() => {
    if (!showSolutionPrompt) return;
    const text = (promptDirty ? prompt : builtPrompt).trim();
    if (text) solutionUi?.prompts.current.set(question.id, text);
  }, [showSolutionPrompt, promptDirty, prompt, builtPrompt, question.id, solutionUi?.prompts]);

  function promptText(): string {
    return (promptDirty ? prompt : builtPrompt).trim();
  }

  function rememberPrompt(text: string) {
    if (text) solutionUi?.prompts.current.set(question.id, text);
    setPrompt(text);
    setPromptDirty(true);
  }

  function submitRegenerate() {
    flush();
    const text = promptText();
    if (!text || !onRegenerate) return;
    rememberPrompt(text);
    onRegenerate(question.id, { userPrompt: text });
  }

  async function pasteStemImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = clipboardImageFile(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    if (!onPasteFigure) {
      toast.error("Pasted images can be saved from the home screen or the library.");
      return;
    }
    try {
      const path = await onPasteFigure(file);
      update(withPastedFigure(draftRef.current, path));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not paste that image.");
    }
  }

  return (
    <article
      id={`question-${question.id}`}
      ref={articleRef}
      data-question-number={question.number ?? undefined}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        flush();
      }}
      className={cn(
        "text-card-foreground",
        nested
          ? "pt-1"
          : "scroll-mt-4 rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-paper)]",
        editing && "ring-1 ring-primary/30",
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        {editing && onChange ? (
          <EditableNumber question={question} index={index} onChange={onChange} />
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
        {question.skill_type ? (
          <Badge variant="outline" className="capitalize">
            {question.skill_type.replaceAll("_", " ")}
          </Badge>
        ) : null}
        {question.approval_status ? (
          <Badge variant="outline" className="capitalize">
            {question.approval_status}
          </Badge>
        ) : null}
        {question.validation ? (
          <Badge variant="outline" className="capitalize">
            Check {question.validation.status.replaceAll("_", " ")}
          </Badge>
        ) : null}
        {editing && onChange ? (
          <EditablePage
            page={question.page}
            onChange={(page) => onChange({ ...question, page })}
          />
        ) : question.page != null ? (
          onOpenPage ? (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              aria-label={`Show page ${question.page + 1} in the image viewer`}
              onClick={() => {
                if (question.page == null) return;
                onOpenPage(question.page + 1);
              }}
            >
              Page {question.page + 1}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Page {question.page + 1}</span>
          )
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canReadCrop ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!cropUrl}
              title={cropUrl ? "Read this printed question again" : "Printed crop unavailable"}
              onClick={() => setCropOpen(true)}
            >
              Read crop
            </Button>
          ) : null}
          {queued || generating ? (
            <Badge variant="outline" className="gap-1">
              {generating ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
              {generating ? "Generating…" : "Queued"}
            </Badge>
          ) : null}
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
              variant={editing ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8"
              aria-label={editing ? "Done editing" : "Edit question"}
              onClick={() => {
                if (editing) flush();
                setEditing((value) => !value);
              }}
            >
              {editing ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Pencil className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          ) : null}

          {!nested && question.approval_status && onReviewGenerated ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  question.approval_status === "reviewed" ||
                  question.approval_status === "published"
                }
                onClick={() => onReviewGenerated(question.id, "reviewed")}
              >
                Review
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={question.approval_status === "rejected"}
                onClick={() => onReviewGenerated(question.id, "rejected")}
              >
                Reject
              </Button>
              {onRegenerateGenerated ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={regeneratingQuestion}
                  onClick={async () => {
                    setRegeneratingQuestion(true);
                    try {
                      await onRegenerateGenerated(question.id);
                    } finally {
                      setRegeneratingQuestion(false);
                    }
                  }}
                >
                  {regeneratingQuestion ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  )}
                  {regeneratingQuestion ? "Regenerating…" : "Regenerate question"}
                </Button>
              ) : null}
              {onRegenerateFigure && question.skill_type === "mirror_image" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={regeneratingFigure}
                  onClick={async () => {
                    setRegeneratingFigure(true);
                    try {
                      await onRegenerateFigure(question.id);
                    } finally {
                      setRegeneratingFigure(false);
                    }
                  }}
                >
                  {regeneratingFigure ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  )}
                  {regeneratingFigure ? "Regenerating…" : "Regenerate figure"}
                </Button>
              ) : null}
            </>
          ) : !nested && onApprovalChange && !question.approval_status ? (
            <label
              className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground"
              title="Approvals run one at a time, in the order you check them."
            >
              <Checkbox
                checked={question.approved === true}
                onCheckedChange={(checked) => {
                  flush();
                  if (checked === true) {
                    const text = showSolutionPrompt ? promptText() : "";
                    if (text) rememberPrompt(text);
                    onApprovalChange(question.id, true, text ? { userPrompt: text } : undefined);
                  } else {
                    onApprovalChange(question.id, false);
                  }
                }}
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

      <ReadFlags
        flags={readFlags}
        {...(canReadCrop && cropUrl ? { onOpen: () => setCropOpen(true) } : {})}
      />
      {canReadCrop && !cropUrl ? (
        <p className="mt-3 text-sm text-muted-foreground">Printed crop unavailable.</p>
      ) : null}
      {canReadCrop && cropUrl && onReadCrop ? (
        <QuestionCropDialog
          open={cropOpen}
          onOpenChange={setCropOpen}
          label={cropLabel}
          cropUrl={cropUrl}
          contentMode={contentMode}
          onRun={(layout) => onReadCrop(question, layout)}
          onReplace={(reading) => {
            onChange?.(applyCropReading(question, reading, contentMode));
            setCropOpen(false);
          }}
          preview={(reading) => (
            <QuestionCard
              question={reading}
              index={index}
              {...(resolve ? { resolve } : {})}
            />
          )}
        />
      ) : null}

      {question.validation?.checks.length ? (
        <div className="mt-3 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Validation
          </p>
          <ul className="mt-1 space-y-1">
            {question.validation.checks.map((check) => (
              <li key={check.name}>
                <span className="font-medium capitalize">{check.name}</span>
                {": "}
                <span className="capitalize">{check.status.replaceAll("_", " ")}</span>
                {check.details ? (
                  <span className="text-muted-foreground"> — {check.details}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Stem
            </p>
            <MathFormatHelp />
          </div>
          <Textarea
            value={question.stem}
            rows={8}
            className="min-h-48"
            aria-label="Recognised question text"
            onChange={(event) => onChange({ ...question, stem: event.target.value })}
            onPaste={(event) => void pasteStemImage(event)}
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
              onChange={(event) => onChange({ ...question, section: event.target.value || null })}
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
                  negative_marks: event.target.value === "" ? null : Number(event.target.value),
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

      {question.figures.some((figure) => figure.role !== "option_figure") ? (
        <div className="mt-3 space-y-2">
          {question.figures
            .filter((figure) => figure.role !== "option_figure")
            .map((figure, i) => {
              const imagePath = figure.image_path;
              return (
                <FigureBlock
                  key={imagePath ?? `${figure.description}-${i}`}
                  figure={figure}
                  {...(resolve ? { resolve } : {})}
                  {...(onChange && imagePath
                    ? { onRemove: () => onChange(detachImagePath(question, imagePath)) }
                    : {})}
                />
              );
            })}
        </div>
      ) : null}

      <TypeBody
        question={question}
        editing={editing}
        {...(resolve ? { resolve } : {})}
        {...(onChange ? { onChange } : {})}
        {...(solutionUi
          ? {
              generatingIds: solutionUi.generatingIdsRef.current,
              queuedIds: solutionUi.queuedIdsRef.current,
            }
          : {})}
        {...(onPasteFigure ? { onPasteFigure } : {})}
        {...(onRegenerate ? { onRegenerate } : {})}
        {...(onDelete ? { onDelete } : {})}
        {...(onOpenPage ? { onOpenPage } : {})}
      />

      {question.type !== "comprehension" || !question.sub_questions.length ? (
        <>
          <HintSolutionBlock
            question={question}
            editing={editing}
            {...(generating ? { generating: true } : {})}
            {...(queued ? { queued: true } : {})}
            {...(onChange ? { onChange } : {})}
            {...(offerSolutionRegenerate ? { onRegenerate: submitRegenerate } : {})}
          />
          {showSolutionPrompt ? (
            <SolutionPrompt
              open={promptOpen}
              onOpenChange={setPromptOpen}
              value={promptDirty ? prompt : builtPrompt}
              busy={generating || queued}
              canReset={promptDirty && prompt.trim() !== builtPrompt.trim()}
              answerMissing={answerMissing}
              onChange={(next) => {
                setPrompt(next);
                setPromptDirty(true);
              }}
              onReset={() => {
                setPrompt(builtPrompt);
                setPromptDirty(false);
              }}
              onRegenerate={submitRegenerate}
            />
          ) : null}
        </>
      ) : null}
    </article>
  );
});
