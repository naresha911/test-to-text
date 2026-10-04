import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Columns2, Download, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { type NewQuestionInput } from "@/components/questions/AddQuestionForm";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  documentKindBadge,
  documentKindLabel,
  isMockGenerationIncomplete,
  isPaperChangedError,
  mockGenerationTotal,
  type Catalog,
  type DocumentMeta,
  type MockGenerationState,
  type PageRecord,
} from "@/lib/document-types";
import { readQuestionCrop } from "@/lib/extract.functions";
import { generateHintSolution } from "@/lib/hint-solution.functions";
import { useSolutionGeneration } from "@/hooks/useSolutionGeneration";
import {
  createAiMockFromSource,
  deleteLocalDocument,
  exportLocalDocument,
  getLocalCatalog,
  pushLocalDocument,
  getLocalDocument,
  listLocalDocuments,
  saveLocalDocument,
  saveLocalFigure,
} from "@/lib/local-store.functions";
import { blueprintFromQuestions, numberGaps } from "@/lib/generation/blueprint";
import { fileToDataUrl } from "@/lib/image-utils";
import { resumeMockPaperGeneration } from "@/lib/mock-paper-client";
import {
  generateMockQuestion,
  regenerateMockFigure,
  regenerateMockQuestion,
} from "@/lib/mock-paper.functions";
import { pastedFigureFilename } from "@/lib/question-images";
import { sortMockPairs, sortQuestions } from "@/lib/question-order";
import { readStoredCrop } from "@/lib/reading/crop-client";
import type { CropLayout } from "@/lib/reading/crop-layout";
import {
  createManualQuestion,
  findQuestionById,
  removeQuestionById,
  updateQuestionById,
  withGeneratedStatus,
  type Question,
} from "@/lib/question-schema";

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
  const runReadCrop = useServerFn(readQuestionCrop);
  const runSaveFigure = useServerFn(saveLocalFigure);
  const runCatalog = useServerFn(getLocalCatalog);
  const runRegenerateQuestion = useServerFn(regenerateMockQuestion);
  const runRegenerateFigure = useServerFn(regenerateMockFigure);
  const queryClient = useQueryClient();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [pageUrls, setPageUrls] = useState<Array<string | undefined>>([]);
  const [figureUrls, setFigureUrls] = useState<Record<string, string>>({});
  const pagesRef = useRef<PageRecord[]>([]);
  const figureUrlsRef = useRef(figureUrls);
  figureUrlsRef.current = figureUrls;
  const [ready, setReady] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>({
    standards: [],
    subjects: [],
    topics: [],
    streams: [],
  });
  const [audienceMeta, setAudienceMeta] = useState({
    exam: null as string | null,
    notes: null as string | null,
    subject_id: null as number | null,
  });
  const questionsRef = useRef(questions);
  const questionsRevRef = useRef(0);
  const docRef = useRef<DocumentMeta | null>(null);
  const loadedRef = useRef(false);
  const saveChain = useRef(Promise.resolve());
  questionsRef.current = questions;

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    void runGet({ data: { id } }).then((loaded) => {
      if (cancelled || !loaded) return;
      const sorted = sortQuestions(loaded.questions);
      questionsRef.current = sorted;
      setAudienceMeta({
        exam: loaded.document.exam,
        notes: loaded.document.notes,
        subject_id: loaded.document.subject_id,
      });
      docRef.current = loaded.document.generation
        ? {
            ...loaded.document,
            generation: {
              ...loaded.document.generation,
              pairs: sortMockPairs(loaded.document.generation.pairs, sorted),
            },
          }
        : loaded.document;
      loadedRef.current = true;
      questionsRevRef.current = loaded.document.questions_rev;
      pagesRef.current = loaded.pages;
      setQuestions(sorted);
      const urls: Array<string | undefined> = [];
      for (const page of loaded.pages) urls[page.page_index] = page.dataUrl;
      setPageUrls(urls);
      setFigureUrls(loaded.figureUrls);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id, runGet]);

  useEffect(() => {
    void runCatalog()
      .then(setCatalog)
      .catch(() => undefined);
  }, [runCatalog]);

  const audience = useMemo(
    () => ({
      subject: catalog.subjects.find((subject) => subject.id === audienceMeta.subject_id)?.name ?? null,
      exam: audienceMeta.exam,
      notes: audienceMeta.notes,
    }),
    [catalog.subjects, audienceMeta],
  );

  const solution = useSolutionGeneration({
    questionsRef,
    setQuestions,
    runGenerate: runHintSolution,
    audience,
    save: (next) => persist(next),
  });

  function persist(next: Question[], generation?: MockGenerationState) {
    questionsRef.current = next;
    if (generation && docRef.current) docRef.current = { ...docRef.current, generation };
    const run = saveChain.current.then(async () => {
      try {
        const saved = await runSave({
          data: {
            id,
            patch: generation
              ? {
                  questions: questionsRef.current,
                  generation: docRef.current?.generation ?? generation,
                  questions_rev: questionsRevRef.current,
                }
              : { questions: questionsRef.current, questions_rev: questionsRevRef.current },
          },
        });
        if (saved) questionsRevRef.current = saved.questions_rev;
      } catch (error) {
        if (!isPaperChangedError(error)) {
          toast.error("Could not autosave locally.");
          return;
        }
        const loaded = await runGet({ data: { id } });
        if (!loaded) return;
        questionsRevRef.current = loaded.document.questions_rev;
        const sorted = sortQuestions(loaded.questions);
        questionsRef.current = sorted;
        setQuestions(sorted);
        setFigureUrls(loaded.figureUrls);
        toast.error("This paper changed on disk, so it was reloaded.");
      }
    });
    saveChain.current = run.then(
      () => undefined,
      () => undefined,
    );
  }

  useEffect(() => {
    const onHide = () => {
      if (!loadedRef.current || document.visibilityState !== "hidden") return;
      persist(questionsRef.current);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (!loadedRef.current) return;
      persist(questionsRef.current);
    };
    // persist reads the latest refs when the queued save runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function deleteQuestion(questionId: string) {
    const updated = removeQuestionById(questionsRef.current, questionId);
    const generation = docRef.current?.generation
      ? {
          ...docRef.current.generation,
          pairs: docRef.current.generation.pairs.filter(
            (pair) => pair.mock_question_id !== questionId,
          ),
        }
      : undefined;
    setQuestions(updated);
    persist(updated, generation);
    void queryClient.invalidateQueries({ queryKey: ["local-documents"] });
    toast.success("Question deleted.");
  }

  function addQuestion(input: NewQuestionInput): string {
    const doc = docRef.current;
    const created = createManualQuestion({
      number: input.number,
      type: input.type,
      ...(input.page != null ? { page: input.page } : {}),
      marks: doc?.default_marks ?? null,
      negative_marks: doc?.default_negative_marks ?? null,
      difficulty: doc?.difficulty ?? null,
      subject_id: doc?.subject_id ?? null,
      standard_id: doc?.standard_id ?? null,
      stream_id: doc?.stream_id ?? null,
      year: doc?.year ?? null,
      ...(doc?.kind === "ai_mock" ? { approval_status: "draft" as const, approved: false } : {}),
    });
    const updated = sortQuestions([...questionsRef.current, created]);
    const generation = doc?.generation
      ? {
          ...doc.generation,
          pairs: sortMockPairs(
            [...doc.generation.pairs, { source_question_id: null, mock_question_id: created.id }],
            updated,
          ),
        }
      : undefined;
    setQuestions(updated);
    persist(updated, generation);
    void queryClient.invalidateQueries({ queryKey: ["local-documents"] });
    toast.success(`Question ${created.number} added.`);
    return created.id;
  }

  function patchQuestion(next: Question) {
    setQuestions((current) => {
      const previous = findQuestionById(current, next.id);
      const patched = updateQuestionById(current, next.id, () => next);
      const numberChanged = (previous?.number ?? null) !== (next.number ?? null);
      const pageChanged = (previous?.page ?? null) !== (next.page ?? null);
      const updated = numberChanged || pageChanged ? sortQuestions(patched) : patched;
      const generation =
        numberChanged && docRef.current?.generation
          ? {
              ...docRef.current.generation,
              pairs: sortMockPairs(docRef.current.generation.pairs, updated),
            }
          : undefined;
      persist(updated, generation);
      return updated;
    });
  }

  async function readCrop(question: Question, layout: CropLayout): Promise<Question> {
    const path = question.source_block?.image_path;
    const cropDataUrl = path ? figureUrlsRef.current[path] : undefined;
    if (!cropDataUrl) throw new Error("The printed crop for this question is unavailable.");
    const mode =
      pagesRef.current.find((item) => item.page_index === (question.page ?? -1))?.read_mode ??
      "text";
    const hint = audienceMeta.notes?.trim();
    const loaded = await readStoredCrop({
      question,
      layout,
      contentMode: mode,
      documentId: id,
      cropDataUrl,
      ...(hint ? { hint } : {}),
      read: (request) => runReadCrop({ data: request }),
      saveFigure: (data) => runSaveFigure({ data }),
    });
    if (Object.keys(loaded.urls).length) {
      const urls = { ...figureUrlsRef.current, ...loaded.urls };
      figureUrlsRef.current = urls;
      setFigureUrls(urls);
    }
    return loaded.question;
  }

  async function refreshFigures() {
    const loaded = await runGet({ data: { id } });
    if (loaded) {
      questionsRevRef.current = loaded.document.questions_rev;
      setFigureUrls(loaded.figureUrls);
    }
  }

  async function reviewGenerated(questionId: string, status: "reviewed" | "rejected") {
    setQuestions((current) => {
      const updated = updateQuestionById(current, questionId, (question) =>
        withGeneratedStatus(question, status),
      );
      persist(updated);
      return updated;
    });
  }

  async function regenerateQuestion(questionId: string) {
    try {
      const result = await runRegenerateQuestion({ data: { documentId: id, questionId } });
      setQuestions(result.questions);
      questionsRef.current = result.questions;
      await refreshFigures();
      toast.success("A new question was generated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not regenerate that question.");
    }
  }

  async function regenerateFigure(questionId: string) {
    const before = questionsRef.current.find((question) => question.id === questionId);
    try {
      const result = await runRegenerateFigure({ data: { documentId: id, questionId } });
      if (
        before &&
        (result.question.stem !== before.stem ||
          result.question.answer_keys.join() !== before.answer_keys.join())
      ) {
        throw new Error("Figure regeneration changed the question.");
      }
      const updated = updateQuestionById(questionsRef.current, questionId, () => result.question);
      questionsRef.current = updated;
      setQuestions(updated);
      await refreshFigures();
      toast.success("Figure redrawn.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not redraw that figure.");
    }
  }

  const pasteFigure = useCallback(
    async (file: File) => {
      const dataUrl = await fileToDataUrl(file);
      const saved = await runSaveFigure({
        data: { documentId: id, dataUrl, filename: pastedFigureFilename(file.type) },
      });
      setFigureUrls((current) => {
        const urls = { ...current, [saved.path]: dataUrl };
        figureUrlsRef.current = urls;
        return urls;
      });
      return saved.path;
    },
    [id, runSaveFigure],
  );

  const live = useRef({
    patchQuestion,
    deleteQuestion,
    addQuestion,
    readCrop,
    reviewGenerated,
    regenerateQuestion,
    regenerateFigure,
  });
  live.current = {
    patchQuestion,
    deleteQuestion,
    addQuestion,
    readCrop,
    reviewGenerated,
    regenerateQuestion,
    regenerateFigure,
  };

  const onQuestionChange = useCallback((next: Question) => {
    live.current.patchQuestion(next);
  }, []);
  const onDeleteQuestion = useCallback((questionId: string) => {
    live.current.deleteQuestion(questionId);
  }, []);
  const onAddQuestion = useCallback((input: NewQuestionInput) => {
    return live.current.addQuestion(input);
  }, []);
  const onReadCrop = useCallback((question: Question, layout: CropLayout) => {
    return live.current.readCrop(question, layout);
  }, []);
  const onReviewGenerated = useCallback(
    (questionId: string, status: "reviewed" | "rejected") => {
      void live.current.reviewGenerated(questionId, status);
    },
    [],
  );
  const onRegenerateGenerated = useCallback((questionId: string) => {
    void live.current.regenerateQuestion(questionId);
  }, []);
  const onRegenerateFigure = useCallback((questionId: string) => {
    void live.current.regenerateFigure(questionId);
  }, []);
  const resolveFigure = useCallback((path: string) => figureUrls[path], [figureUrls]);

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
        resolveFigure={resolveFigure}
        onApprovalChange={solution.approve}
        onQuestionChange={onQuestionChange}
        onDelete={onDeleteQuestion}
        onAddQuestion={onAddQuestion}
        onRegenerate={solution.regenerate}
        onPasteFigure={pasteFigure}
        solutionAudience={audience}
        queuedIds={solution.queuedIds}
        promptReveal={solution.promptReveal}
        promptStore={solution.prompts}
        onReviewGenerated={onReviewGenerated}
        onRegenerateGenerated={onRegenerateGenerated}
        onRegenerateFigure={onRegenerateFigure}
        generatingIds={solution.generatingIds}
        onReadCrop={onReadCrop}
        contentModeForPage={(page) =>
          pagesRef.current.find((item) => item.page_index === page)?.read_mode ?? "text"
        }
      />
    </div>
  );
}

function LibraryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listLocalDocuments);
  const deleteFn = useServerFn(deleteLocalDocument);
  const exportFn = useServerFn(exportLocalDocument);
  const pushFn = useServerFn(pushLocalDocument);
  const createMockFn = useServerFn(createAiMockFromSource);
  const getFn = useServerFn(getLocalDocument);
  const saveFn = useServerFn(saveLocalDocument);
  const generateFn = useServerFn(generateMockQuestion);
  const catalogFn = useServerFn(getLocalCatalog);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creatingMockFor, setCreatingMockFor] = useState<string | null>(null);
  const [resumingMockId, setResumingMockId] = useState<string | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
    page_count: number;
    question_count: number;
  } | null>(null);
  const [mockBlueprint, setMockBlueprint] = useState<{
    sourceId: string;
    slots: { skill: string; count: number }[];
    gaps: string[];
    harder: boolean;
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

  async function pushPaper(id: string, title: string) {
    setPushingId(id);
    try {
      const result = await pushFn({ data: { id } });
      void queryClient.invalidateQueries({ queryKey: ["local-documents"] });
      if (result.complete) {
        toast.success(
          result.skipped > 0
            ? `"${result.title || title}" is on exam-prep. ${result.pushed} updated, ${result.skipped} already saved.`
            : `Pushed "${result.title || title}" (${result.total} questions) to exam-prep.`,
        );
      } else {
        toast.error(result.error ?? "Push stopped before every question was saved.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not push that paper.");
      void queryClient.invalidateQueries({ queryKey: ["local-documents"] });
    } finally {
      setPushingId(null);
    }
  }

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

  async function startMockFromSource(
    sourceId: string,
    options?: { slots: { skill: string; count: number }[]; difficultyStep: 0 | 1 },
  ) {
    setCreatingMockFor(sourceId);
    try {
      const created = await createMockFn({
        data: options
          ? { sourceId, slots: options.slots, difficultyStep: options.difficultyStep }
          : { sourceId },
      });
      void queryClient.invalidateQueries({ queryKey: ["local-documents"] });
      const mix = created.document.generation?.blueprint
        ?.slice(0, 6)
        .map((slot) => `${slot.count} ${slot.skill.replaceAll("_", " ")}`)
        .join(", ");
      toast.success(
        mix
          ? `AI mock draft created (${mix}). Generating on the comparison screen.`
          : "AI mock draft created — generating on the comparison screen.",
      );
      void navigate({ to: "/compare/$mockId", params: { mockId: created.document.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start AI mock generation.");
    } finally {
      setCreatingMockFor(null);
    }
  }

  async function prepareMockFromSource(sourceId: string) {
    setCreatingMockFor(sourceId);
    try {
      const loaded = await getFn({ data: { id: sourceId } });
      const questions = loaded?.questions ?? [];
      if (!questions.length) {
        await startMockFromSource(sourceId);
        return;
      }
      const paper = blueprintFromQuestions(
        questions.map((question) => ({
          number: question.number,
          stem: question.stem,
          instructions: question.instructions,
          type: question.type,
          figureCount: question.figures.length,
          optionImageCount: question.options.filter((option) => option.image_path).length,
          optionTexts: question.options.map((option) => option.text),
          passage: question.passage,
        })),
      );
      if (!paper.slots.length) {
        await startMockFromSource(sourceId);
        return;
      }
      setMockBlueprint({
        sourceId,
        slots: paper.slots.map((slot) => ({ skill: slot.skill, count: slot.count })),
        gaps: numberGaps(questions.map((question) => question.number ?? "")),
        harder: false,
      });
    } catch {
      await startMockFromSource(sourceId);
    } finally {
      setCreatingMockFor(null);
    }
  }

  function confirmMockBlueprint() {
    const draft = mockBlueprint;
    if (!draft) return;
    setMockBlueprint(null);
    void startMockFromSource(draft.sourceId, {
      slots: draft.slots,
      difficultyStep: draft.harder ? 1 : 0,
    });
  }

  async function resumeInstructionMock(mockId: string) {
    setResumingMockId(mockId);
    try {
      const loaded = await getFn({ data: { id: mockId } });
      if (!loaded?.document.generation) {
        throw new Error("No generation state found for this mock.");
      }
      const catalog = await catalogFn();
      const subjectName =
        catalog.subjects.find((s) => s.id === loaded.document.subject_id)?.name ?? null;
      const standardName =
        catalog.standards.find((s) => s.id === loaded.document.standard_id)?.name ?? null;
      const streamName =
        catalog.streams.find((s) => s.id === loaded.document.stream_id)?.name ?? null;
      const topicsById: Record<number, string> = {};
      for (const topic of catalog.topics) {
        topicsById[topic.id] = topic.name;
      }

      const result = await resumeMockPaperGeneration({
        mockId,
        document: loaded.document,
        questions: loaded.questions,
        catalogNames: {
          subject: subjectName,
          standard: standardName,
          stream: streamName,
          topicsById,
        },
        runGenerate: generateFn,
        runSave: saveFn,
      });
      void queryClient.invalidateQueries({ queryKey: ["local-documents"] });
      if (result.completed) {
        toast.success(`AI mock complete — ${result.questions.length} questions.`);
      } else {
        toast.message("Generation paused again. You can resume later.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not resume generation.");
      void queryClient.invalidateQueries({ queryKey: ["local-documents"] });
    } finally {
      setResumingMockId(null);
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h1 className="text-4xl">Your library</h1>
            <p className="mt-2 text-muted-foreground">
              Papers stored in local SQLite on this computer. Open one to keep adding pages, or
              generate an AI mock.
            </p>
          </div>
          <Button asChild>
            <Link to="/mock-new">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              New AI Mock Paper
            </Link>
          </Button>
        </div>

        {papers.isLoading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : !papers.data?.length ? (
          <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground">
              Nothing saved yet. Convert a paper on the home page.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to="/" search={{ id: undefined }}>
                  Convert a paper
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/mock-new">New AI Mock Paper</Link>
              </Button>
            </div>
          </div>
        ) : (
          <ul className="mt-8 space-y-4">
            {papers.data.map((paper) => {
              const open = openId === paper.id;
              const incompleteMock =
                paper.kind === "ai_mock" && isMockGenerationIncomplete(paper.generation);
              const genTotal = mockGenerationTotal(paper.generation);
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
                          documentKindLabel(paper.kind),
                          paper.year,
                          `${paper.question_count} question${paper.question_count === 1 ? "" : "s"}`,
                          paper.kind === "ai_mock" && genTotal
                            ? `gen ${paper.generation?.cursor ?? 0}/${genTotal}`
                            : null,
                          paper.push_status === "complete"
                            ? "on exam-prep"
                            : paper.push_total > 0
                              ? `exam-prep ${paper.push_synced}/${paper.push_total}`
                              : null,
                          paper.kind !== "ai_mock"
                            ? `${paper.page_count} page${paper.page_count === 1 ? "" : "s"}`
                            : null,
                          new Date(paper.updated_at).toLocaleDateString(),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {paper.kind === "ai_mock" && paper.generation?.status === "failed" ? (
                        <p className="mt-1 text-xs text-destructive">
                          Generation paused: {paper.generation.last_error ?? "unknown error"}
                        </p>
                      ) : null}
                      {paper.push_status === "incomplete" && paper.push_error ? (
                        <p className="mt-1 text-xs text-destructive">{paper.push_error}</p>
                      ) : null}
                    </div>
                    <Badge variant="outline">{documentKindBadge(paper.kind)}</Badge>

                    {paper.kind === "ai_mock" ? (
                      <>
                        {paper.source_document_id ? (
                          <Button variant="outline" size="sm" asChild>
                            <Link to="/compare/$mockId" params={{ mockId: paper.id }}>
                              <Columns2 className="h-4 w-4" aria-hidden="true" />
                              {incompleteMock ? "Resume / Compare" : "Compare"}
                            </Link>
                          </Button>
                        ) : incompleteMock ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={resumingMockId === paper.id}
                            onClick={() => void resumeInstructionMock(paper.id)}
                          >
                            {resumingMockId === paper.id ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                Resuming…
                              </>
                            ) : (
                              <>
                                <Sparkles className="h-4 w-4" aria-hidden="true" />
                                Resume generation
                              </>
                            )}
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          creatingMockFor === paper.id ||
                          paper.question_count === 0 ||
                          mockBlueprint?.sourceId === paper.id
                        }
                        onClick={() => void prepareMockFromSource(paper.id)}
                      >
                        {creatingMockFor === paper.id ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            Starting…
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" aria-hidden="true" />
                            Generate AI Mock
                          </>
                        )}
                      </Button>
                    )}

                    {paper.kind !== "ai_mock" ? (
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/" search={{ id: paper.id }}>
                          Continue
                        </Link>
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void download(paper.id, paper.title)}
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      JSON
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        pushingId === paper.id ||
                        paper.question_count === 0 ||
                        paper.standard_id == null
                      }
                      title={
                        paper.standard_id == null ? "Choose 5th or 8th before pushing." : undefined
                      }
                      onClick={() => void pushPaper(paper.id, paper.title)}
                    >
                      {pushingId === paper.id ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          Pushing…
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4" aria-hidden="true" />
                          {paper.push_status === "incomplete" || paper.push_status === "in_progress"
                            ? "Resume push"
                            : "Push"}
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setOpenId(open ? null : paper.id)}
                    >
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

      <Dialog
        open={mockBlueprint != null}
        onOpenChange={(open) => {
          if (!open) setMockBlueprint(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate AI Mock</DialogTitle>
            <DialogDescription>
              Each count is how many new questions to write for that skill. Confirm uses these
              counts. Cancel leaves the paper unchanged.
            </DialogDescription>
          </DialogHeader>
          {mockBlueprint?.gaps.length ? (
            <p className="text-sm text-muted-foreground">
              Missing question numbers: {mockBlueprint.gaps.join(", ")}
            </p>
          ) : null}
          <ul className="max-h-64 space-y-3 overflow-y-auto">
            {mockBlueprint?.slots.map((slot, index) => (
              <li key={slot.skill} className="flex items-center gap-3">
                <Label className="mr-auto capitalize" htmlFor={`blueprint-count-${slot.skill}`}>
                  {slot.skill.replaceAll("_", " ")}
                </Label>
                <Input
                  id={`blueprint-count-${slot.skill}`}
                  className="w-20"
                  type="number"
                  min={1}
                  max={80}
                  value={slot.count}
                  onChange={(event) => {
                    const next = Math.round(Number(event.target.value));
                    if (!Number.isFinite(next)) return;
                    const count = Math.min(80, Math.max(1, next));
                    setMockBlueprint((current) =>
                      current
                        ? {
                            ...current,
                            slots: current.slots.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, count } : item,
                            ),
                          }
                        : current,
                    );
                  }}
                />
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mockBlueprint?.harder ?? false}
              onChange={(event) =>
                setMockBlueprint((current) =>
                  current ? { ...current, harder: event.target.checked } : current,
                )
              }
            />
            One step harder
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMockBlueprint(null)}>
              Cancel
            </Button>
            <Button onClick={confirmMockBlueprint} disabled={creatingMockFor != null}>
              Generate AI Mock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              , and any figure images stored on this computer. This cannot be undone.
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
