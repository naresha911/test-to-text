import { Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { suggestNextQuestionNumber } from "@/lib/question-order";
import {
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type Question,
  type QuestionType,
} from "@/lib/question-schema";

export type NewQuestionInput = {
  number: string;
  type: QuestionType;
};

type Props = {
  questions: Question[];
  onAdd: (input: NewQuestionInput) => void;
};

export function AddQuestionForm({ questions, onAdd }: Props) {
  const suggested = suggestNextQuestionNumber(questions);
  const [number, setNumber] = useState(suggested);
  const [type, setType] = useState<QuestionType>("mcq");
  const dirty = useRef(false);
  const numberId = useId();
  const typeId = useId();

  useEffect(() => {
    if (!dirty.current) setNumber(suggested);
  }, [suggested]);

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border bg-background/95 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = number.trim();
        if (!trimmed) return;
        onAdd({ number: trimmed, type });
        dirty.current = false;
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
          className="h-9 w-28"
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
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={type}
          aria-label="New question type"
          onChange={(event) => setType(event.target.value as QuestionType)}
        >
          {QUESTION_TYPES.map((option) => (
            <option key={option} value={option}>
              {QUESTION_TYPE_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm" className="h-9">
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add question
      </Button>
    </form>
  );
}
