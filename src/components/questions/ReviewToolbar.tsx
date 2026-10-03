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
    <div className="sticky top-[4.25rem] z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-card/95 px-2 py-1 shadow-[var(--shadow-paper)] backdrop-blur">
      <AddQuestionButton questions={questions} onAdd={onAdd} />
      <JumpField label="Go to page" onGo={onScrollToPage} />
      <JumpField label="Go to question" onGo={onScrollToQuestion} />
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
      <Button type="button" size="sm" className="h-7 px-2.5" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
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
    <div className="flex items-center gap-1.5">
      <Label id={labelId} className="text-[11px] text-muted-foreground">
        Status
      </Label>
      <div
        role="group"
        aria-labelledby={labelId}
        className="inline-flex h-7 overflow-hidden rounded-md border border-border bg-background"
      >
        {options.map((option, index) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              className={cn(
                "px-2 text-[11px] font-medium transition-colors",
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

function JumpField({ label, onGo }: { label: string; onGo: (value: string) => void }) {
  const id = useId();
  const [value, setValue] = useState("");

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        onGo(trimmed);
      }}
    >
      <Label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        inputMode="numeric"
        className="h-7 w-12 px-1.5 text-center text-xs tabular-nums"
        onChange={(event) => setValue(event.target.value)}
      />
      <Button type="submit" size="sm" variant="outline" className="h-7 px-2">
        Go
      </Button>
    </form>
  );
}
