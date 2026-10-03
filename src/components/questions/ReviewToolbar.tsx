import { useId, useState } from "react";

import { AddQuestionForm, type NewQuestionInput } from "@/components/questions/AddQuestionForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Question } from "@/lib/question-schema";

type Props = {
  questions: Question[];
  suggestedPage: number | null;
  onAdd: (input: NewQuestionInput) => void;
  onScrollToPage: (label: string) => void;
  onScrollToQuestion: (label: string) => void;
};

export function ReviewToolbar({
  questions,
  suggestedPage,
  onAdd,
  onScrollToPage,
  onScrollToQuestion,
}: Props) {
  return (
    <div className="sticky top-[4.25rem] z-10 flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-border bg-card/95 px-3 py-3 shadow-[var(--shadow-paper)] backdrop-blur">
      <AddQuestionForm
        plain
        questions={questions}
        suggestedPage={suggestedPage}
        onAdd={onAdd}
      />
      <JumpField label="Go to page" placeholder="Page" onGo={onScrollToPage} />
      <JumpField label="Go to question" placeholder="Number" onGo={onScrollToQuestion} />
    </div>
  );
}

function JumpField({
  label,
  placeholder,
  onGo,
}: {
  label: string;
  placeholder: string;
  onGo: (value: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState("");

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        onGo(trimmed);
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          className="h-9 w-28"
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <Button type="submit" size="sm" variant="outline" className="h-9">
        Go
      </Button>
    </form>
  );
}
