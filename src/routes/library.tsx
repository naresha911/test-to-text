import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { PageReview } from "@/components/questions/PageReview";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { generateForApprovedQuestion } from "@/lib/hint-solution-client";
import { generateHintSolution } from "@/lib/hint-solution.functions";
import {
  deleteLocalDocument,
  exportLocalDocument,
  getLocalDocument,
  listLocalDocuments,
  saveLocalDocument,
} from "@/lib/local-store.functions";
import { updateQuestionById, type Question } from "@/lib/question-schema";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Your paper library — PaperParse" },
      {
        name: "description",
        content: "Open in-progress papers stored on this machine and download exam-prep JSON.",
      },
    ],
  }),
  component: LibraryPage,
});

function PaperDetail({ id }: { id: string }) {
  const runGet = useServerFn(getLocalDocument);
  const runSave = useServerFn(saveLocalDocument);
  const runHintSolution = useServerFn(generateHintSolution);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [pageUrls, setPageUrls] = useState<Array<string | undefined>>([]);
  const [figureUrls, setFigureUrls] = useState<Record<string, string>>({});
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(() => new Set());
  const [ready, setReady] = useState(false);
  const questionsRef = useRef(questions);
  questionsRef.current = questions;

  useEffect(() => {
    void runGet({ data: { id } }).then((loaded) => {
      if (!loaded) return;
      setQuestions(loaded.questions);
      const urls: Array<string | undefined> = [];
      for (const page of loaded.pages) urls[page.page_index] = page.dataUrl;
      setPageUrls(urls);
      setFigureUrls(loaded.figureUrls);
      setReady(true);
    });
  }, [id, runGet]);

  function persist(next: Question[]) {
    questionsRef.current = next;
    void runSave({ data: { id, patch: { questions: next } } }).catch(() =>
      toast.error("Could not autosave locally."),
    );
  }

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      void runSave({ data: { id, patch: { questions: questionsRef.current } } }).catch(() =>
        toast.error("Could not autosave locally."),
      );
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void runSave({ data: { id, patch: { questions: questionsRef.current } } }).catch(() => undefined);
    };
  }, [id, runSave]);

  function patchQuestion(next: Question) {
    setQuestions((current) => {
      const updated = updateQuestionById(current, next.id, () => next);
      persist(updated);
      return updated;
    });
  }

  async function runGeneration(questionId: string, force = false) {
    let requested: string[] = [];
    try {
      const result = await generateForApprovedQuestion({
        questions: questionsRef.current,
        questionId,
        force,
        runGenerate: runHintSolution,
        onProgress: (ids) => {
          requested = ids;
          setGeneratingIds((current) => {
            const next = new Set(current);
            for (const qid of ids) next.add(qid);
            return next;
          });
        },
      });
      if (result.generatedIds.length) {
        setQuestions(result.questions);
        persist(result.questions);
        toast.success(force ? "Hint and solution regenerated." : "Hint and solution ready.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate hint and solution.");
    } finally {
      if (requested.length) {
        setGeneratingIds((current) => {
          const next = new Set(current);
          for (const qid of requested) next.delete(qid);
          return next;
        });
      }
    }
  }

  if (!ready) {
    return (
      <div className="mt-4 flex justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mt-6">
      <PageReview
        questions={questions}
        pageUrls={pageUrls}
        resolveFigure={(path) => figureUrls[path]}
        onApprovalChange={(questionId, approved) => {
          setQuestions((current) => {
            const updated = updateQuestionById(current, questionId, (q) => ({ ...q, approved }));
            persist(updated);
            return updated;
          });
          if (approved) void runGeneration(questionId, false);
        }}
        onQuestionChange={patchQuestion}
        onRegenerate={(questionId) => void runGeneration(questionId, true)}
        generatingIds={generatingIds}
      />
    </div>
  );
}

function LibraryPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listLocalDocuments);
  const deleteFn = useServerFn(deleteLocalDocument);
  const exportFn = useServerFn(exportLocalDocument);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
    page_count: number;
    question_count: number;
  } | null>(null);

  const papers = useQuery({
    queryKey: ["local-documents"],
    queryFn: () => listFn(),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => deleteFn({ data: { id } }),
    onSuccess: (_data, id) => {
      toast.success("Paper, questions, and images removed from this machine.");
      setPendingDelete(null);
      setOpenId((current) => (current === id ? null : current));
      void queryClient.invalidateQueries({ queryKey: ["local-documents"] });
    },
    onError: () => toast.error("Could not delete that paper."),
  });

  async function download(id: string, title: string) {
    try {
      const payload = await exportFn({ data: { id } });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "paper"}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not export JSON.");
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-4xl">Your library</h1>
        <p className="mt-2 text-muted-foreground">
          Papers stored in local SQLite on this computer. Open one to keep adding pages.
        </p>

        {papers.isLoading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : !papers.data?.length ? (
          <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground">Nothing saved yet. Convert a paper on the home page.</p>
            <Button className="mt-4" asChild>
              <Link to="/" search={{ id: undefined }}>Convert a paper</Link>
            </Button>
          </div>
        ) : (
          <ul className="mt-8 space-y-4">
            {papers.data.map((paper) => {
              const open = openId === paper.id;
              return (
                <li
                  key={paper.id}
                  className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-paper)]"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="mr-auto min-w-0">
                      <h2 className="truncate text-2xl">{paper.title}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[
                          paper.kind === "practice_test" ? "Practice test" : "Past paper",
                          paper.year,
                          `${paper.question_count} question${paper.question_count === 1 ? "" : "s"}`,
                          `${paper.page_count} page${paper.page_count === 1 ? "" : "s"}`,
                          new Date(paper.updated_at).toLocaleDateString(),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Badge variant="outline">{paper.kind === "practice_test" ? "Test" : "Paper"}</Badge>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/" search={{ id: paper.id }}>
                        Continue
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void download(paper.id, paper.title)}>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      JSON
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setOpenId(open ? null : paper.id)}>
                      {open ? "Hide" : "Review"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPendingDelete({
                          id: paper.id,
                          title: paper.title,
                          page_count: paper.page_count,
                          question_count: paper.question_count,
                        })
                      }
                      aria-label={`Delete ${paper.title}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                    </Button>
                  </div>
                  {open ? <PaperDetail id={paper.id} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <AlertDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this paper?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.title ?? "Untitled"}” will be permanently removed from this machine,
              including{" "}
              {pendingDelete
                ? `${pendingDelete.question_count} question${pendingDelete.question_count === 1 ? "" : "s"}`
                : "its questions"}
              ,{" "}
              {pendingDelete
                ? `${pendingDelete.page_count} page image${pendingDelete.page_count === 1 ? "" : "s"}`
                : "page images"}
              , and any cropped figures stored in local SQLite. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending || !pendingDelete}
              onClick={(event) => {
                event.preventDefault();
                if (pendingDelete) remove.mutate(pendingDelete.id);
              }}
            >
              {remove.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Deleting…
                </>
              ) : (
                "Delete paper and images"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
