import { Plus } from "lucide-react";
import { useId, useState } from "react";

import { AddQuestionForm, type NewQuestionInput } from "@/components/questions/AddQuestionForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Question } from "@/lib/question-schema";
import { cn } from "@/lib/utils";

export type ApprovalFilter = "all" | "approved" | "unapproved";

type Props = {
  questions: Question[];
  approvalFilter: ApprovalFilter;
  onApprovalFilterChange: (filter: ApprovalFilter) => void;
  onAdd: (input: NewQuestionInput) => void;
  onScrollToPage: (label: string) => void;
  onScrollToQuestion: (label: string) => void;
};

export function ReviewToolbar({
  questions,
  approvalFilter,
  onApprovalFilterChange,
  onAdd,
  onScrollToPage,
  onScrollToQuestion,
}: Props) {
  return (
    <div className="sticky top-[4.25rem] z-10 flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-border bg-card/95 px-3 py-3 shadow-[var(--shadow-paper)] backdrop-blur">
      <AddQuestionButton questions={questions} onAdd={onAdd} />
      <JumpField label="Go to page" placeholder="Page" onGo={onScrollToPage} />
      <JumpField label="Go to question" placeholder="Number" onGo={onScrollToQuestion} />
      <ApprovalFilterControl
        questions={questions}
        value={approvalFilter}
        onChange={onApprovalFilterChange}
      />
    </div>
  );
}

function AddQuestionButton({
  questions,
  onAdd,
}: {
  questions: Question[];
  onAdd: (input: NewQuestionInput) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" size="sm" className="h-9" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add question
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add question</DialogTitle>
            <DialogDescription>
              Enter the question number, type, and page. Leave the page blank if it is not on a
              scanned page yet.
            </DialogDescription>
          </DialogHeader>
          {open ? (
            <AddQuestionForm
              plain
              stacked
              prefill={false}
              questions={questions}
              onAdd={(input) => {
                onAdd(input);
                setOpen(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ApprovalFilterControl({
  questions,
  value,
  onChange,
}: {
  questions: Question[];
  value: ApprovalFilter;
  onChange: (filter: ApprovalFilter) => void;
}) {
  const labelId = useId();
  const approved = questions.filter((question) => question.approved === true).length;
  const options: Array<{ value: ApprovalFilter; label: string; count: number }> = [
    { value: "all", label: "All", count: questions.length },
    { value: "approved", label: "Approved", count: approved },
    { value: "unapproved", label: "Unapproved", count: questions.length - approved },
  ];

  return (
    <div className="space-y-1">
      <Label id={labelId}>Status</Label>
      <div
        role="group"
        aria-labelledby={labelId}
        className="inline-flex h-9 overflow-hidden rounded-md border border-border bg-background"
      >
        {options.map((option, index) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              className={cn(
                "px-3 text-xs font-medium transition-colors",
                index > 0 && "border-l border-border",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
              onClick={() => onChange(option.value)}
            >
              {option.label} {option.count}
            </button>
          );
        })}
      </div>
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
