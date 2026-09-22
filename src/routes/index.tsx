import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileJson, ImagePlus, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { PageReview } from "@/components/questions/PageReview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import type { Catalog, DocumentKind, DocumentMeta, PageRecord } from "@/lib/document-types";
import { extractPage } from "@/lib/extract.functions";
import { generateForApprovedQuestion } from "@/lib/hint-solution-client";
import { generateHintSolution } from "@/lib/hint-solution.functions";
import { cropFigure, preparePageImage } from "@/lib/image-utils";
import {
  appendLocalPage,
  createLocalDocument,
  exportLocalDocument,
  getLocalCatalog,
  getLocalDocument,
  markLocalPageOcr,
  removeLocalPage,
  saveLocalDocument,
  saveLocalFigure,
} from "@/lib/local-store.functions";
import { sortQuestions } from "@/lib/question-order";
import {
  QUESTION_TYPE_LABELS,
  updateQuestionById,
  type Question,
  type QuestionType,
} from "@/lib/question-schema";
import {
  DEFAULT_READER_SETTINGS,
  READER_LABELS,
  loadReaderSettings,
} from "@/lib/reader-settings";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search["id"] === "string" ? search["id"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "PaperParse — question paper images to structured JSON" },
      {
        name: "description",
        content:
          "Upload question paper or practice test images and get exam-prep JSON with LaTeX and diagram crops.",
      },
    ],
  }),
  component: HomePage,
});

const emptyMeta = (
  kind: DocumentKind = "past_paper",
): Omit<DocumentMeta, "id" | "created_at" | "updated_at"> => ({
  kind,
  title: "",
  year: null,
  standard_id: null,
  stream_id: null,
  subject_id: null,
  duration_minutes: null,
  total_marks: null,
  difficulty: null,
  exam: "",
  notes: "",
  source: "",
  description: "",
  section_timing: false,
  negative_marking: true,
  allow_pause: true,
  max_attempts: 1,
  default_marks: 1,
  default_negative_marks: 0,
});

function HomePage() {
  const { id: searchId } = Route.useSearch();
  const navigate = useNavigate();
  const runExtract = useServerFn(extractPage);
  const runHintSolution = useServerFn(generateHintSolution);
  const runCreate = useServerFn(createLocalDocument);
  const runGet = useServerFn(getLocalDocument);
  const runSave = useServerFn(saveLocalDocument);
  const runAppendPage = useServerFn(appendLocalPage);
  const runRemovePage = useServerFn(removeLocalPage);
  const runSaveFigure = useServerFn(saveLocalFigure);
  const runMarkOcr = useServerFn(markLocalPageOcr);
  const runCatalog = useServerFn(getLocalCatalog);
  const runExport = useServerFn(exportLocalDocument);
  const fileInput = useRef<HTMLInputElement>(null);

  const [documentId, setDocumentId] = useState<string | null>(searchId ?? null);
  const documentIdRef = useRef<string | null>(searchId ?? null);
  documentIdRef.current = documentId;
  const [meta, setMeta] = useState(emptyMeta());
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [figureUrls, setFigureUrls] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<Catalog>({
    standards: [],
    subjects: [],
    topics: [],
    streams: [],
  });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState<QuestionType | "all">("all");
  const [reader, setReader] = useState(DEFAULT_READER_SETTINGS);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(() => new Set());
  const [loadingDoc, setLoadingDoc] = useState(!!searchId);
  const questionsRef = useRef(questions);
  questionsRef.current = questions;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setReader(loadReaderSettings()), []);

  useEffect(() => {
    void runCatalog().then(setCatalog).catch(() => undefined);
  }, [runCatalog]);

  useEffect(() => {
    if (!searchId) {
      setLoadingDoc(false);
      return;
    }
    setLoadingDoc(true);
    void runGet({ data: { id: searchId } })
      .then((loaded) => {
        if (!loaded) {
          toast.error("That paper was not found on this machine.");
          return;
        }
        setDocumentId(loaded.document.id);
        const { id: _id, created_at: _c, updated_at: _u, ...rest } = loaded.document;
        setMeta({
          ...rest,
          exam: rest.exam ?? "",
          notes: rest.notes ?? "",
          source: rest.source ?? "",
          description: rest.description ?? "",
        });
        setPages(loaded.pages);
        setQuestions(loaded.questions);
        setFigureUrls(loaded.figureUrls);
      })
      .catch(() => toast.error("Could not open the saved paper."))
      .finally(() => setLoadingDoc(false));
  }, [searchId, runGet]);

  const persist = useCallback(
    (id: string, nextQuestions?: Question[], nextMeta?: typeof meta) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const m = nextMeta ?? metaRef.current;
        void runSave({
          data: {
            id,
            patch: {
              ...m,
              exam: m.exam || null,
              notes: m.notes || null,
              source: m.source || null,
              description: m.description || null,
              questions: nextQuestions ?? questionsRef.current,
            },
          },
        }).catch(() => toast.error("Could not autosave locally."));
      }, 400);
    },
    [runSave],
  );

  async function ensureDocument(): Promise<string> {
    if (documentIdRef.current) return documentIdRef.current;
    const created = await runCreate({
      data: {
        kind: metaRef.current.kind,
        title: metaRef.current.title.trim() || undefined,
      },
    });
    documentIdRef.current = created.id;
    setDocumentId(created.id);
    void navigate({ to: "/", search: { id: created.id }, replace: true });
    persist(created.id, questionsRef.current, metaRef.current);
    return created.id;
  }

  const counts = useMemo(() => {
    const map = new Map<QuestionType, number>();
    for (const question of questions) map.set(question.type, (map.get(question.type) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [questions]);

  const visible = useMemo(
    () => (filter === "all" ? questions : questions.filter((q) => q.type === filter)),
    [questions, filter],
  );

  const paperTotals = useMemo(() => {
    const marks = questions.reduce((sum, q) => sum + (q.marks ?? meta.default_marks ?? 1), 0);
    const sections = [...new Set(questions.map((q) => q.section?.trim() || "General"))];
    const approved = questions.filter((q) => q.approved).length;
    return { marks, sections, approved };
  }, [questions, meta.default_marks]);

  const audience = useMemo(
    () => ({
      subject: catalog.subjects.find((s) => s.id === meta.subject_id)?.name ?? null,
      exam: meta.exam || null,
      notes: meta.notes || null,
    }),
    [catalog.subjects, meta.subject_id, meta.exam, meta.notes],
  );

  function patchMeta(partial: Partial<typeof meta>) {
    setMeta((current) => {
      const next = { ...current, ...partial };
      if (documentId) persist(documentId, undefined, next);
      return next;
    });
  }

  function patchQuestion(next: Question) {
    setQuestions((current) => {
      const updated = updateQuestionById(current, next.id, () => next);
      if (documentId) persist(documentId, updated);
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
        audience,
        runGenerate: runHintSolution,
        onProgress: (ids) => {
          requested = ids;
          setGeneratingIds((current) => {
            const next = new Set(current);
            for (const id of ids) next.add(id);
            return next;
          });
        },
      });
      if (result.generatedIds.length) {
        setQuestions(result.questions);
        if (documentId) persist(documentId, result.questions);
        toast.success(force ? "Hint and solution regenerated." : "Hint and solution ready.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not generate hint and solution.",
      );
    } finally {
      if (requested.length) {
        setGeneratingIds((current) => {
          const next = new Set(current);
          for (const id of requested) next.delete(id);
          return next;
        });
      }
    }
  }

  function setApproved(questionId: string, approved: boolean) {
    setQuestions((current) => {
      const updated = updateQuestionById(current, questionId, (question) => ({
        ...question,
        approved,
      }));
      if (documentId) persist(documentId, updated);
      return updated;
    });
    if (approved) void runGeneration(questionId, false);
  }

  const addFiles = useCallback(async (list: FileList | null) => {
    if (!list?.length) return;
    const images = [...list].filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      toast.error("Please choose image files (JPG, PNG, HEIC exports or screenshots).");
      return;
    }
    try {
      const id = await ensureDocument();
      for (const file of images) {
        const prepared = await preparePageImage(file);
        const page = await runAppendPage({
          data: { documentId: id, dataUrl: prepared.dataUrl, originalName: file.name },
        });
        setPages((current) => [...current, page]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read those images.");
    }
  }, [runAppendPage]);

  async function removeUploadedPage(page: PageRecord) {
    if (progress) return;
    try {
      await runRemovePage({ data: { pageId: page.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove that page.");
      return;
    }
    const removedIndex = page.page_index;
    setPages((current) =>
      current
        .filter((item) => item.id !== page.id)
        .sort((a, b) => a.page_index - b.page_index)
        .map((item, index) => ({ ...item, page_index: index })),
    );
    setQuestions((current) => {
      const next = reindexQuestionsAfterPageRemoval(current, removedIndex);
      if (documentId) persist(documentId, next);
      return next;
    });
    toast.success(`Removed page ${removedIndex + 1}.`);
  }

  async function handleExtract() {
    if (!pages.length) {
      toast.error("Add at least one page image first.");
      return;
    }
    const id = await ensureDocument();
    const toRead = pages.filter((p) => p.dataUrl);
    if (!toRead.length) {
      toast.error("No page images available to read.");
      return;
    }

    setProgress({ done: 0, total: toRead.length });
    const collected = [...questionsRef.current];
    const urls = { ...figureUrls };
    let failed = 0;
    let configurationError: string | null = null;

    for (let i = 0; i < toRead.length; i += 1) {
      const page = toRead[i]!;
      if (page.ocr_status === "done") {
        setProgress({ done: i + 1, total: toRead.length });
        continue;
      }
      try {
        const apiKey = reader.apiKeys?.[reader.engine]?.trim();
        const result = await runExtract({
          data: {
            imageDataUrl: page.dataUrl!,
            page: page.page_index,
            engine: reader.engine,
            model: reader.model,
            ...(apiKey ? { apiKey } : {}),
            ...(meta.notes?.trim() ? { hint: meta.notes.trim() } : {}),
          },
        });

        for (const question of result.questions) {
          question.standard_id = meta.standard_id;
          question.stream_id = meta.stream_id;
          question.subject_id = meta.subject_id;
          question.year = meta.year;
          question.source = meta.source || meta.exam || null;
          if (question.marks == null) question.marks = meta.default_marks;
          if (question.negative_marks == null) question.negative_marks = meta.default_negative_marks;
          if (!question.difficulty) question.difficulty = meta.difficulty;

          for (const [figureIndex, figure] of question.figures.entries()) {
            if (!figure.bbox || !page.dataUrl) continue;
            const crop = await cropFigure(page.dataUrl, figure.bbox);
            if (!crop) continue;
            const dataUrl = await blobToDataUrl(crop);
            const saved = await runSaveFigure({
              data: {
                documentId: id,
                dataUrl,
                filename: `p${page.page_index + 1}-fig-${collected.length + 1}-${figureIndex + 1}.jpg`,
              },
            });
            figure.image_path = saved.path;
            urls[saved.path] = dataUrl;
          }
          collected.push(question);
        }
        if (!result.questions.length) failed += 1;
        setPages((current) =>
          current.map((p) => (p.id === page.id ? { ...p, ocr_status: "done" } : p)),
        );
        void runMarkOcr({ data: { pageId: page.id, status: "done" } });
      } catch (error) {
        failed += 1;
        const raw = error instanceof Error ? error.message : "";
        if (raw.includes("AI_CREDITS")) {
          toast.error(
            raw.replace(/^.*AI_CREDITS:\s*/, "") ||
            "The AI reading credits for this workspace are used up.",
          );
          break;
        }
        toast.error(raw || `Page ${page.page_index + 1} could not be read.`);
      }

      setProgress({ done: i + 1, total: toRead.length });
      const sorted = sortQuestions(collected);
      setQuestions(sorted);
      setFigureUrls({ ...urls });
      persist(id, sorted);
    }

    setProgress(null);
    const sorted = sortQuestions(collected);
    setQuestions(sorted);
    persist(id, sorted);
    if (sorted.length) {
      const failedNote = failed ? ` — ${failed} page(s) returned nothing` : "";
      toast.success(
        `Now ${sorted.length} question${sorted.length === 1 ? "" : "s"} in sequence${failedNote}.`,
      );
    } else {
      toast.error("No questions were found. Try a sharper or more zoomed-in photo.");
    }
  }

  async function handleDownload() {
    const id = documentId ?? (await ensureDocument());
    persist(id, questionsRef.current);
    await new Promise((r) => setTimeout(r, 500));
    try {
      const payload = await runExport({ data: { id } });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(meta.title.trim() || "question-paper").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not build JSON.");
    }
  }

  const streams = catalog.streams.filter(
    (s) => meta.standard_id == null || s.standard_id == null || s.standard_id === meta.standard_id,
  );

  if (loadingDoc) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="mx-auto max-w-6xl px-4 py-10">
        <section className="max-w-2xl">
          <h1 className="text-4xl leading-tight sm:text-5xl">
            Turn question paper photos into <span className="ink-underline">exam JSON</span>
          </h1>
          <p className="mt-4 text-muted-foreground">
            Work is saved on this machine. Upload more images any time. Download JSON keyed to the
            exam-prep database tables.
          </p>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-paper)]">
              <h2 className="text-lg">1. Paper or practice test</h2>
              <div className="mt-3 space-y-3">
                <div className="flex gap-2">
                  {(["past_paper", "practice_test"] as const).map((kind) => (
                    <Button
                      key={kind}
                      type="button"
                      size="sm"
                      variant={meta.kind === kind ? "default" : "outline"}
                      onClick={() => patchMeta({ kind })}
                    >
                      {kind === "past_paper" ? "Past paper" : "Practice test"}
                    </Button>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="title">
                    {meta.kind === "practice_test" ? "Practice test name" : "Paper title"}
                  </Label>
                  <Input
                    id="title"
                    placeholder={
                      meta.kind === "practice_test" ? "Algebra weekly drill" : "Board exam 2024"
                    }
                    value={meta.title}
                    onChange={(event) => patchMeta({ title: event.target.value })}
                  />
                </div>
                {meta.kind === "past_paper" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="year">Year</Label>
                    <Input
                      id="year"
                      type="number"
                      placeholder="2024"
                      value={meta.year ?? ""}
                      onChange={(event) =>
                        patchMeta({
                          year: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      rows={2}
                      value={meta.description ?? ""}
                      onChange={(event) => patchMeta({ description: event.target.value })}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="standard">Standard</Label>
                    <select
                      id="standard"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={meta.standard_id ?? ""}
                      onChange={(event) =>
                        patchMeta({
                          standard_id: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                    >
                      <option value="">Unset (import catalog)</option>
                      {catalog.standards.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="stream">Stream</Label>
                    <select
                      id="stream"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={meta.stream_id ?? ""}
                      onChange={(event) =>
                        patchMeta({
                          stream_id: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                    >
                      <option value="">Unset</option>
                      {streams.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="subject">Subject</Label>
                    <select
                      id="subject"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={meta.subject_id ?? ""}
                      onChange={(event) =>
                        patchMeta({
                          subject_id: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                    >
                      <option value="">Unset</option>
                      {catalog.subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="exam">Exam / source</Label>
                    <Input
                      id="exam"
                      placeholder="CBSE"
                      value={meta.exam ?? ""}
                      onChange={(event) =>
                        patchMeta({ exam: event.target.value, source: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="duration">Duration (min)</Label>
                    <Input
                      id="duration"
                      type="number"
                      value={meta.duration_minutes ?? ""}
                      onChange={(event) =>
                        patchMeta({
                          duration_minutes:
                            event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="difficulty">Paper difficulty</Label>
                    <select
                      id="difficulty"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={meta.difficulty ?? ""}
                      onChange={(event) =>
                        patchMeta({
                          difficulty: (event.target.value || null) as DocumentMeta["difficulty"],
                        })
                      }
                    >
                      <option value="">Unset</option>
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="dmarks">Default marks</Label>
                    <Input
                      id="dmarks"
                      type="number"
                      value={meta.default_marks ?? ""}
                      onChange={(event) =>
                        patchMeta({
                          default_marks:
                            event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="dneg">Default negative</Label>
                    <Input
                      id="dneg"
                      type="number"
                      value={meta.default_negative_marks ?? ""}
                      onChange={(event) =>
                        patchMeta({
                          default_negative_marks:
                            event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hint">Notes for the reader (optional)</Label>
                  <Textarea
                    id="hint"
                    rows={3}
                    placeholder="Answer key is on the last page. Section B is assertion and reason."
                    value={meta.notes ?? ""}
                    onChange={(event) => patchMeta({ notes: event.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-paper)]">
              <h2 className="text-lg">2. Add pages</h2>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void addFiles(event.dataTransfer.files);
                }}
                className="mt-3 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-secondary/40 px-4 py-8 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                <ImagePlus className="h-6 w-6" aria-hidden="true" />
                Drop images here or click to browse
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  void addFiles(event.target.files);
                  event.target.value = "";
                }}
              />

              {pages.length ? (
                <ul className="mt-3 grid grid-cols-3 gap-2">
                  {pages.map((page) => (
                    <li key={page.id} className="relative">
                      {page.dataUrl ? (
                        <img
                          src={page.dataUrl}
                          alt={`Page ${page.page_index + 1}`}
                          className="h-24 w-full rounded border border-border object-cover"
                        />
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded border text-xs">
                          Page {page.page_index + 1}
                        </div>
                      )}
                      <span className="absolute bottom-1 left-1 rounded bg-background/80 px-1 text-[10px]">
                        {page.page_index + 1}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove page ${page.page_index + 1}`}
                        disabled={!!progress}
                        onClick={() => void removeUploadedPage(page)}
                        className="absolute -top-1.5 -right-1.5 z-10 rounded-full bg-destructive p-0.5 text-destructive-foreground disabled:opacity-50"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="mt-4 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                Reader: <span className="text-foreground">{READER_LABELS[reader.engine]}</span>
              </p>

              <Button
                className="mt-2 w-full"
                onClick={() => void handleExtract()}
                disabled={!!progress || !pages.length}
              >
                {progress ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                )}
                {progress ? `Reading page ${progress.done + 1} of ${progress.total}` : "Read new pages"}
              </Button>
              {progress ? (
                <Progress
                  className="mt-3"
                  value={(progress.done / Math.max(1, progress.total)) * 100}
                />
              ) : null}
            </div>
          </aside>

          <section>
            {questions.length ? (
              <>
                <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-paper)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="mr-auto">
                      <p className="font-display text-2xl leading-none">
                        {questions.length} question{questions.length === 1 ? "" : "s"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {paperTotals.approved} approved · {paperTotals.marks} marks ·{" "}
                        {paperTotals.sections.join(", ")}
                        {meta.duration_minutes ? ` · ${meta.duration_minutes} min` : ""}
                        {meta.difficulty ? ` · ${meta.difficulty}` : ""}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void handleDownload()}>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Download JSON
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setQuestions([]);
                        if (documentId) persist(documentId, []);
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Clear questions
                    </Button>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setFilter("all")}>
                    <Badge variant={filter === "all" ? "default" : "outline"}>
                      All {questions.length}
                    </Badge>
                  </button>
                  {counts.map(([type, count]) => (
                    <button key={type} type="button" onClick={() => setFilter(type)}>
                      <Badge variant={filter === type ? "default" : "outline"}>
                        {QUESTION_TYPE_LABELS[type]} {count}
                      </Badge>
                    </button>
                  ))}
                </div>

                <PageReview
                  questions={visible}
                  pageUrls={pages.map((page) => page.dataUrl)}
                  resolveFigure={(path) => figureUrls[path]}
                  onApprovalChange={setApproved}
                  onQuestionChange={patchQuestion}
                  onRegenerate={(questionId) => void runGeneration(questionId, true)}
                  generatingIds={generatingIds}
                />
              </>
            ) : (
              <div
                className={cn(
                  "paper-sheet flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-border px-6 text-center",
                )}
              >
                <FileJson className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <h2 className="mt-4 text-2xl">Your parsed paper appears here</h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Create a past paper or practice test, add images, then read pages. Work stays in
                  local SQLite until you download exam-prep JSON.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function reindexQuestionsAfterPageRemoval(questions: Question[], removedIndex: number): Question[] {
  const shift = (page: number | null | undefined): number | null => {
    if (page == null || page < removedIndex) return page ?? null;
    if (page === removedIndex) return null;
    return page - 1;
  };

  return questions.map((question) => ({
    ...question,
    page: shift(question.page),
    figures: question.figures.map((figure) => ({
      ...figure,
      page: shift(figure.page),
    })),
    sub_questions: reindexQuestionsAfterPageRemoval(question.sub_questions, removedIndex),
  }));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not encode figure"));
    reader.readAsDataURL(blob);
  });
}
