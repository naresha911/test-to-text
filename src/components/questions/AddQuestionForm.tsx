import { Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { suggestNextQuestionNumber } from "@/lib/question-order";
import {
  parseDisplayedPage,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type Question,
  type QuestionType,
} from "@/lib/question-schema";
import { cn } from "@/lib/utils";

export type NewQuestionInput = {
  number: string;
  type: QuestionType;
  /** 0-based page index. Null when the reviewer left the field empty. */
  page: number | null;
};

type Props = {
  questions: Question[];
  onAdd: (input: NewQuestionInput) => void;
  /**
   * 1-based page nearest the top of the image viewer.
   * Applied until the reviewer edits the page field.
   */
  suggestedPage?: number | null;
  /** Drop the dashed frame when the form sits inside another toolbar. */
  plain?: boolean;
  /** Leave number, type, and page empty until the reviewer fills them in. */
  prefill?: boolean;
  /** Stack the fields for a dialog instead of a single toolbar row. */
  stacked?: boolean;
};

export function AddQuestionForm({
  questions,
  onAdd,
  suggestedPage = null,
  plain = false,
  prefill = true,
  stacked = false,
}: Props) {
  const suggested = suggestNextQuestionNumber(questions);
  const [number, setNumber] = useState(prefill ? suggested : "");
  const [type, setType] = useState<QuestionType | "">(prefill ? "mcq" : "");
  const [pageText, setPageText] = useState(
    prefill && suggestedPage != null ? String(suggestedPage) : "",
  );
  const [pageInvalid, setPageInvalid] = useState(false);
  const [typeInvalid, setTypeInvalid] = useState(false);
  const dirty = useRef(false);
  const pageDirty = useRef(false);
  const numberId = useId();
  const typeId = useId();
  const pageId = useId();

  useEffect(() => {
    if (!prefill || dirty.current) return;
    setNumber(suggested);
  }, [prefill, suggested]);

  useEffect(() => {
    if (!prefill || pageDirty.current) return;
    setPageText(suggestedPage != null ? String(suggestedPage) : "");
    setPageInvalid(false);
  }, [prefill, suggestedPage]);

  return (
    <form
      className={cn(
        stacked ? "grid gap-3" : "flex flex-wrap items-end gap-2",
        !plain && !stacked && "rounded-lg border border-dashed border-border bg-background/95 p-3",
      )}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = number.trim();
        if (!trimmed) return;
        if (type === "") {
          setTypeInvalid(true);
          return;
        }
        const parsed = parseDisplayedPage(pageText);
        if (!parsed) {
          setPageInvalid(true);
          return;
        }
        onAdd({ number: trimmed, type, page: parsed.page });
        dirty.current = false;
        pageDirty.current = false;
        setPageInvalid(false);
        setTypeInvalid(false);
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={numberId}>Question number</Label>
        <Input
          id={numberId}
          value={number}
          required
          maxLength={40}
          placeholder="e.g. 5"
          className={cn("h-9", stacked ? "w-full" : "w-28")}
          aria-label="New question number"
          onChange={(event) => {
            dirty.current = true;
            setNumber(event.target.value);
          }}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={typeId}>Type</Label>
        <select
          id={typeId}
          className={cn(
            "h-9 rounded-md border border-input bg-background px-2 text-sm",
            stacked && "w-full",
          )}
          value={type}
          aria-label="New question type"
          aria-invalid={typeInvalid}
          onChange={(event) => {
            setTypeInvalid(false);
            setType(event.target.value as QuestionType | "");
          }}
        >
          {prefill ? null : (
            <option value="" disabled>
              Select type
            </option>
          )}
          {QUESTION_TYPES.map((option) => (
            <option key={option} value={option}>
              {QUESTION_TYPE_LABELS[option]}
            </option>
          ))}
        </select>
        {typeInvalid ? <p className="text-xs text-destructive">Choose a question type.</p> : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor={pageId}>Page number</Label>
        <Input
          id={pageId}
          value={pageText}
          inputMode="numeric"
          placeholder="e.g. 2"
          className={cn("h-9", stacked ? "w-full" : "w-24")}
          aria-label="New question page number"
          aria-invalid={pageInvalid}
          onChange={(event) => {
            pageDirty.current = true;
            setPageInvalid(false);
            setPageText(event.target.value);
          }}
        />
        {pageInvalid ? (
          <p className="text-xs text-destructive">Use a page number of 1 or more.</p>
        ) : null}
      </div>
      <Button type="submit" size="sm" className={cn("h-9", stacked && "justify-self-end")}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add question
      </Button>
    </form>
  );
}
