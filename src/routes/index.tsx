import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronDown,
  Download,
  FileJson,
  ImagePlus,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { PageImageViewer } from "@/components/questions/PageImageViewer";
import { PageReview } from "@/components/questions/PageReview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  isPaperChangedError,
  type Catalog,
  type DocumentKind,
  type DocumentMeta,
  type PageRecord,
} from "@/lib/document-types";
import { extractPage } from "@/lib/extract.functions";
import { generateHintSolution } from "@/lib/hint-solution.functions";
import { useSolutionGeneration } from "@/hooks/useSolutionGeneration";
import {
  cropFigure,
  OCR_SPACE_MAX_BYTES,
  preparePageImage,
  shrinkJpegUnderBytes,
} from "@/lib/image-utils";
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
import { droppedImagePaths } from "@/lib/question-images";
import { sortQuestions } from "@/lib/question-order";
import {
  QUESTION_TYPE_LABELS,
  createManualQuestion,
  findQuestionById,
  removeQuestionById,
  updateQuestionById,
  type Question,
  type QuestionType,
} from "@/lib/question-schema";
import { DEFAULT_READER_SETTINGS, READER_LABELS, loadReaderSettings } from "@/lib/reader-settings";
import type { ContentMode } from "@/lib/reading/mode";
import {
  planPageRead,
  reindexQuestionsAfterPageRemoval,
  addReadQuestions,
} from "@/lib/reading/read-plan";
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
): Omit<DocumentMeta, "id" | "created_at" | "updated_at" | "questions_rev"> => ({
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
  source_document_id: null,
  generation: null,
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
  const questionsRevRef = useRef(0);
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
  const [contentMode, setContentMode] = useState<ContentMode>("text");
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(() => new Set());
  const [forceRead, setForceRead] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(!!searchId);
  const questionsRef = useRef(questions);
  questionsRef.current = questions;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{
    id: string;
    questions?: Question[];
    meta?: typeof meta;
  } | null>(null);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  const flushSaveRef = useRef<() => Promise<boolean>>(async () => true);

  useEffect(() => {
    setReader(loadReaderSettings());
  }, []);

  useEffect(() => {
    void runCatalog()
      .then(setCatalog)
      .catch(() => undefined);
  }, [runCatalog]);

  useEffect(() => {
    setSelectedPageIds(new Set());
    setForceRead(false);
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
        const {
          id: _id,
          created_at: _c,
          updated_at: _u,
          questions_rev: loadedRev,
          ...rest
        } = loaded.document;
        questionsRevRef.current = loadedRev;
        setMeta({
          ...rest,
          exam: rest.exam ?? "",
          notes: rest.notes ?? "",
          source: rest.source ?? "",
          description: rest.description ?? "",
        });
        setPages(loaded.pages);
        const sorted = sortQuestions(loaded.questions);
        questionsRef.current = sorted;
        setQuestions(sorted);
        setFigureUrls(loaded.figureUrls);
      })
      .catch(() => toast.error("Could not open the saved paper."))
      .finally(() => setLoadingDoc(false));
  }, [searchId, runGet]);

  const flushSave = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (inFlightSaveRef.current) await inFlightSaveRef.current;

    while (pendingSaveRef.current) {
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      const m = pending.meta ?? metaRef.current;
      const nextQuestions = pending.questions ?? questionsRef.current;
      let failed = false;
      let conflicted = false;
      const write = (async () => {
        try {
          const saved = await runSave({
            data: {
              id: pending.id,
              patch: {
                ...m,
                exam: m.exam || null,
                notes: m.notes || null,
                source: m.source || null,
                description: m.description || null,
                questions: nextQuestions,
                questions_rev: questionsRevRef.current,
              },
            },
          });
          if (saved) questionsRevRef.current = saved.questions_rev;
        } catch (error) {
          if (isPaperChangedError(error)) {
            const loaded = await runGet({ data: { id: pending.id } });
            if (loaded) {
              questionsRevRef.current = loaded.document.questions_rev;
              const sorted = sortQuestions(loaded.questions);
              questionsRef.current = sorted;
              setQuestions(sorted);
              setFigureUrls(loaded.figureUrls);
            }
            // Drop the stale patch. Retrying it would delete the newer figure files.
            pendingSaveRef.current = null;
            conflicted = true;
            toast.error("This paper changed on disk, so it was reloaded.");
            return;
          }
          failed = true;
          // Keep the failed patch queued so a later persist/flush can retry.
          pendingSaveRef.current = {
            id: pending.id,
            questions: pending.questions ?? nextQuestions,
            meta: pending.meta ?? m,
          };
          toast.error("Could not autosave locally.");
        }
      })();
      inFlightSaveRef.current = write;
      try {
        await write;
      } finally {
        if (inFlightSaveRef.current === write) inFlightSaveRef.current = null;
      }
      if (failed || conflicted) return false;
    }
    return true;
  }, [runGet, runSave]);
  flushSaveRef.current = flushSave;

  const persist = useCallback(
    (
      id: string,
      nextQuestions?: Question[],
      nextMeta?: typeof meta,
      options?: { immediate?: boolean },
    ): Promise<boolean> => {
      // Merge into one pending patch so a meta keystroke cannot drop a question edit
      // (or vice versa) when the debounce timer is reset.
      const prev = pendingSaveRef.current;
      if (nextQuestions !== undefined) questionsRef.current = nextQuestions;
      if (nextMeta !== undefined) metaRef.current = nextMeta;
      const questions = nextQuestions !== undefined ? nextQuestions : prev?.questions;
      const nextPendingMeta = nextMeta !== undefined ? nextMeta : prev?.meta;
      pendingSaveRef.current = {
        id,
        ...(questions !== undefined ? { questions } : {}),
        ...(nextPendingMeta !== undefined ? { meta: nextPendingMeta } : {}),
      };
      if (options?.immediate) return flushSave();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void flushSave();
      }, 400);
      return Promise.resolve(true);
    },
    [flushSave],
  );

  // Flush pending writes when the tab hides or this page unmounts so edits are not lost.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flushSaveRef.current();
    };
    const onPageHide = () => {
      void flushSaveRef.current();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      void flushSaveRef.current();
    };
  }, []);

  async function ensureDocument(): Promise<string> {
    if (documentIdRef.current) return documentIdRef.current;
    const created = await runCreate({
      data: {
        kind: metaRef.current.kind,
        title: metaRef.current.title.trim() || undefined,
      },
    });
    documentIdRef.current = created.id;
    questionsRevRef.current = created.questions_rev;
    setDocumentId(created.id);
    void navigate({ to: "/", search: { id: created.id }, replace: true });
    persist(created.id, questionsRef.current, metaRef.current, { immediate: true });
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
    const checked = questions.filter((q) => q.source_block);
    const passedChecks = checked.filter((q) => (q.source_block?.flags.length ?? 0) === 0).length;
    return { marks, sections, approved, checked: checked.length, passedChecks };
  }, [questions, meta.default_marks]);

  const selectedAlreadyRead = pages.filter(
    (page) => selectedPageIds.has(page.id) && page.ocr_status === "done",
  ).length;
  const readPageCount = pages.filter((page) => page.ocr_status === "done").length;

  const audience = useMemo(
    () => ({
      subject: catalog.subjects.find((s) => s.id === meta.subject_id)?.name ?? null,
      exam: meta.exam || null,
      notes: meta.notes || null,
    }),
    [catalog.subjects, meta.subject_id, meta.exam, meta.notes],
  );

  const solution = useSolutionGeneration({
    questionsRef,
    setQuestions,
    runGenerate: runHintSolution,
    audience,
    save: (next) => {
      const id = documentIdRef.current;
      if (id) void persist(id, next, undefined, { immediate: true });
    },
  });

  function patchMeta(partial: Partial<typeof meta>) {
    setMeta((current) => {
      const next = { ...current, ...partial };
      if (documentId) persist(documentId, undefined, next);
      return next;
    });
  }

  function deleteQuestion(questionId: string) {
    setQuestions((current) => {
      const updated = removeQuestionById(current, questionId);
      questionsRef.current = updated;
      const savedId = documentIdRef.current;
      if (savedId) persist(savedId, updated, undefined, { immediate: true });
      return updated;
    });
    toast.success("Question deleted.");
  }

  function addQuestion(input: { number: string; type: QuestionType }): string {
    const created = createManualQuestion({
      number: input.number,
      type: input.type,
      marks: metaRef.current.default_marks,
      negative_marks: metaRef.current.default_negative_marks,
      difficulty: metaRef.current.difficulty,
      subject_id: metaRef.current.subject_id,
      standard_id: metaRef.current.standard_id,
      stream_id: metaRef.current.stream_id,
      year: metaRef.current.year,
    });
    const updated = sortQuestions([...questionsRef.current, created]);
    questionsRef.current = updated;
    setQuestions(updated);
    setFilter("all");
    const savedId = documentIdRef.current;
    if (savedId) persist(savedId, updated, undefined, { immediate: true });
    else void ensureDocument();
    toast.success(`Question ${created.number} added.`);
    return created.id;
  }

  function patchQuestion(next: Question) {
    setQuestions((current) => {
      const previous = findQuestionById(current, next.id);
      const updated = sortQuestions(updateQuestionById(current, next.id, () => next));
      questionsRef.current = updated;
      const savedId = documentIdRef.current;
      const numberChanged = (previous?.number ?? null) !== (next.number ?? null);
      const imagesRemoved = previous != null && droppedImagePaths([previous], [next]).length > 0;
      if (savedId) {
        persist(
          savedId,
          updated,
          undefined,
          numberChanged || imagesRemoved ? { immediate: true } : undefined,
        );
      }
      return updated;
    });
  }

  const addFiles = useCallback(
    async (list: FileList | null) => {
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
    },
    [runAppendPage],
  );

  async function removeSelectedPages() {
    if (progress) return;
    const selected = pages
      .filter((page) => selectedPageIds.has(page.id))
      .sort((a, b) => b.page_index - a.page_index);
    if (!selected.length) return;
    const label =
      selected.length === 1
        ? `page ${selected[0]!.page_index + 1}`
        : `${selected.length} pages`;
    if (
      !window.confirm(
        `Remove ${label} from the image viewer? The recognized questions stay. A question is removed only when you use its delete button.`,
      )
    ) {
      return;
    }

    const removedIds = new Set<string>();
    let nextQuestions = questionsRef.current;
    for (const page of selected) {
      try {
        await runRemovePage({ data: { pageId: page.id } });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not remove that page.");
        break;
      }
      removedIds.add(page.id);
      nextQuestions = reindexQuestionsAfterPageRemoval(nextQuestions, page.page_index);
    }
    if (!removedIds.size) return;

    setSelectedPageIds((current) => {
      const next = new Set(current);
      for (const id of removedIds) next.delete(id);
      return next;
    });
    setPages((current) =>
      current
        .filter((item) => !removedIds.has(item.id))
        .sort((a, b) => a.page_index - b.page_index)
        .map((item, index) => ({ ...item, page_index: index })),
    );
    questionsRef.current = nextQuestions;
    setQuestions(nextQuestions);
    const savedId = documentIdRef.current;
    if (savedId) persist(savedId, nextQuestions, undefined, { immediate: true });
    toast.success(
      removedIds.size === 1
        ? "Removed that page from the viewer. Questions were kept."
        : `Removed ${removedIds.size} pages from the viewer. Questions were kept.`,
    );
  }

  function togglePageSelected(pageId: string) {
    setSelectedPageIds((current) => {
      const next = new Set(current);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }

  async function handleExtract() {
    if (!pages.length) {
      toast.error("Add at least one page image first.");
      return;
    }
    const plan = planPageRead(pages, selectedPageIds, { force: forceRead });
    if (plan.missingImage.length) {
      const first = plan.missingImage[0]!;
      toast.error(
        plan.missingImage.length === 1
          ? `Page ${first.page_index + 1} has no image to read.`
          : `${plan.missingImage.length} pages have no image to read.`,
      );
    }
    if (!plan.toRead.length) {
      if (plan.skippedRead.length && !plan.missingImage.length) {
        toast.success(
          plan.usedAllUnread
            ? forceRead
              ? "Every page is already read. Select the pages to read them again."
              : "Every page is already read. Select pages and turn on Force read to read them again. Existing questions stay."
            : "Selected pages are already read. Turn on Force read to read them again. Existing questions stay.",
        );
      } else if (!plan.skippedRead.length && !plan.missingImage.length) {
        toast.error("Select pages that have not been read.");
      }
      return;
    }

    const id = await ensureDocument();
    const mode = contentMode;
    const modeLabel = mode === "text" ? "Text" : "Graphics";
    setProgress({ done: 0, total: plan.toRead.length });
    let collected = [...questionsRef.current];
    const urls = { ...figureUrls };
    let failed = 0;
    let readCount = 0;
    let replaced = 0;
    let aborted = false;

    for (let i = 0; i < plan.toRead.length; i += 1) {
      const page = plan.toRead[i]!;
      let pageSaved = false;
      try {
        const apiKey = reader.apiKeys?.[reader.engine]?.trim();
        const ocrSpaceKey =
          reader.engine === "openocr" ? reader.apiKeys?.ocrspace?.trim() : undefined;
        const optiicKey = reader.engine === "openocr" ? reader.apiKeys?.optiic?.trim() : undefined;
        const imageDataUrl =
          reader.engine === "ocrspace"
            ? await shrinkJpegUnderBytes(page.dataUrl!, OCR_SPACE_MAX_BYTES)
            : page.dataUrl!;
        const result = await runExtract({
          data: {
            imageDataUrl,
            page: page.page_index,
            engine: reader.engine,
            model: reader.model,
            contentMode: mode,
            ...(apiKey ? { apiKey } : {}),
            ...(ocrSpaceKey ? { ocrSpaceKey } : {}),
            ...(optiicKey ? { optiicKey } : {}),
            ...(meta.notes?.trim() ? { hint: meta.notes.trim() } : {}),
          },
        });

        if (!result.questions.length) {
          failed += 1;
          toast.error(
            page.ocr_status === "done"
              ? `Page ${page.page_index + 1} was read again, but no questions could be built. The previous questions were kept.`
              : `Page ${page.page_index + 1} was read, but no questions could be built from the text.`,
          );
        } else {
          for (const [questionIndex, question] of result.questions.entries()) {
            question.standard_id = meta.standard_id;
            question.stream_id = meta.stream_id;
            question.subject_id = meta.subject_id;
            question.year = meta.year;
            question.source = meta.source || meta.exam || null;
            if (question.marks == null) question.marks = meta.default_marks;
            if (question.negative_marks == null)
              question.negative_marks = meta.default_negative_marks;
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
                  filename: `p${page.page_index + 1}-q${questionIndex + 1}-fig-${figureIndex + 1}.jpg`,
                },
              });
              figure.image_path = saved.path;
              figure.generation_method = "cropped";
              urls[saved.path] = dataUrl;
              if (figure.role === "option_figure" && figure.caption) {
                const option = question.options.find((item) => item.key === figure.caption);
                if (option) option.image_path = saved.path;
              }
            }

            const block = question.source_block;
            if (block?.bbox && page.dataUrl) {
              const crop = await cropFigure(page.dataUrl, block.bbox);
              if (crop) {
                const dataUrl = await blobToDataUrl(crop);
                const saved = await runSaveFigure({
                  data: {
                    documentId: id,
                    dataUrl,
                    filename: `p${page.page_index + 1}-q${questionIndex + 1}-block.jpg`,
                  },
                });
                block.image_path = saved.path;
                urls[saved.path] = dataUrl;
              }
            }
          }

          collected = addReadQuestions(collected, result.questions);
          const sorted = sortQuestions(collected);
          collected = sorted;
          setQuestions(sorted);
          setFigureUrls({ ...urls });
          const saved = await persist(id, sorted, undefined, { immediate: true });
          if (!saved) {
            failed += 1;
            aborted = true;
            break;
          }
          pageSaved = true;
          await runMarkOcr({
            data: { pageId: page.id, status: "done", readMode: mode },
          });
          setPages((current) =>
            current.map((item) =>
              item.id === page.id ? { ...item, ocr_status: "done", read_mode: mode } : item,
            ),
          );
          readCount += 1;
          if (page.ocr_status === "done") replaced += 1;
        }
      } catch (error) {
        failed += 1;
        const raw = error instanceof Error ? error.message : "";
        if (pageSaved) {
          toast.error(
            raw || `Page ${page.page_index + 1} was saved, but its read status could not be saved.`,
          );
          aborted = true;
          break;
        } else if (raw.includes("AI_CREDITS")) {
          toast.error(
            raw.replace(/^.*AI_CREDITS:\s*/, "") ||
              "The AI reading credits for this workspace are used up.",
          );
          aborted = true;
          break;
        } else {
          toast.error(raw || `Page ${page.page_index + 1} could not be read.`);
        }
      }

      setProgress({ done: i + 1, total: plan.toRead.length });
    }

    setProgress(null);
    if (aborted) return;

    if (readCount) {
      const skippedNote = plan.skippedRead.length
        ? forceRead
          ? ` Skipped ${plan.skippedRead.length} already read. Select them to read again.`
          : ` Skipped ${plan.skippedRead.length} already read.`
        : "";
      const replacedNote = replaced
        ? ` Added another read of ${replaced} page${replaced === 1 ? "" : "s"}. Earlier questions were kept.`
        : "";
      const failedNote = failed ? ` ${failed} page(s) could not be read.` : "";
      toast.success(
        `Read ${readCount} page${readCount === 1 ? "" : "s"} as ${modeLabel}.${replacedNote}${skippedNote}${failedNote}`,
      );
    } else {
      toast.error(collected.length ? "No new pages were read." : "No questions were found.");
    }
  }

  async function handleDownload() {
    const id = documentId ?? (await ensureDocument());
    persist(id, questionsRef.current, undefined, { immediate: true });
    await flushSave();
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

  const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

  const standardName = catalog.standards.find((s) => s.id === meta.standard_id)?.name;
  const streamName = streams.find((s) => s.id === meta.stream_id)?.name;
  const subjectName = catalog.subjects.find((s) => s.id === meta.subject_id)?.name;
  const detailSummary = [
    standardName,
    streamName,
    subjectName,
    meta.exam || null,
    meta.duration_minutes != null ? `${meta.duration_minutes} min` : null,
    meta.difficulty,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-4">
        <Collapsible
          open={configOpen}
          onOpenChange={setConfigOpen}
          className="rounded-xl border border-border bg-card shadow-[var(--shadow-paper)]"
        >
          <section aria-label="Paper configuration" className="p-3 sm:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-end">
                <div className="shrink-0 space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Type</span>
                  <div className="flex rounded-md border border-border p-0.5">
                    {(["past_paper", "practice_test"] as const).map((kind) => (
                      <Button
                        key={kind}
                        type="button"
                        size="sm"
                        variant={meta.kind === kind ? "default" : "ghost"}
                        className="h-8"
                        onClick={() => patchMeta({ kind })}
                      >
                        {kind === "past_paper" ? "Past paper" : "Practice test"}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor="title" className="text-xs font-medium text-muted-foreground">
                    {meta.kind === "practice_test" ? "Practice test name" : "Paper title"}
                  </Label>
                  <Input
                    id="title"
                    className="h-9"
                    placeholder={
                      meta.kind === "practice_test" ? "Algebra weekly drill" : "Board exam 2024"
                    }
                    value={meta.title}
                    onChange={(event) => patchMeta({ title: event.target.value })}
                  />
                </div>

                {meta.kind === "past_paper" ? (
                  <div className="w-full space-y-1.5 sm:w-24 shrink-0">
                    <Label htmlFor="year" className="text-xs font-medium text-muted-foreground">
                      Year
                    </Label>
                    <Input
                      id="year"
                      className="h-9"
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
                  <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
                    <Label
                      htmlFor="description"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Description
                    </Label>
                    <Input
                      id="description"
                      className="h-9"
                      value={meta.description ?? ""}
                      onChange={(event) => patchMeta({ description: event.target.value })}
                    />
                  </div>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    void addFiles(event.dataTransfer.files);
                  }}
                >
                  <ImagePlus className="h-4 w-4" aria-hidden="true" />
                  Add pages
                </Button>
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
              </div>
            </div>

            {pages.length ? (
              <ul className="mt-3 flex items-start gap-2 overflow-x-auto pb-1">
                {pages.map((page) => {
                  const selected = selectedPageIds.has(page.id);
                  const badge = pageReadBadge(page);
                  return (
                    <li key={page.id} className="relative shrink-0">
                      <button
                        type="button"
                        aria-pressed={selected}
                        disabled={!!progress}
                        aria-label={
                          badge
                            ? `Page ${page.page_index + 1}, ${badge}`
                            : `Page ${page.page_index + 1}, not read`
                        }
                        onClick={() => togglePageSelected(page.id)}
                        className={cn(
                          "flex flex-col items-center gap-0.5 rounded-md p-0.5 disabled:opacity-50",
                          selected ? "ring-2 ring-primary" : "ring-1 ring-transparent",
                        )}
                      >
                        {page.dataUrl ? (
                          <img
                            src={page.dataUrl}
                            alt=""
                            className="h-12 w-9 rounded border border-border object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-9 items-center justify-center rounded border text-[10px]">
                            {page.page_index + 1}
                          </div>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {page.page_index + 1}
                        </span>
                        {badge ? (
                          <span className="whitespace-nowrap text-[10px] font-medium text-foreground">
                            {badge}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div
                className="flex h-9 items-center rounded-md border border-border p-0.5"
                role="group"
                aria-label="What these pages contain"
              >
                {(
                  [
                    ["text", "Text"],
                    ["graphics", "Graphics"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={contentMode === mode}
                    disabled={!!progress}
                    onClick={() => setContentMode(mode)}
                    className={cn(
                      "h-8 rounded px-3 text-sm disabled:opacity-50",
                      contentMode === mode
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                className="h-9"
                onClick={() => void handleExtract()}
                disabled={!!progress || !pages.length}
              >
                {progress ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                )}
                {progress
                  ? `Reading ${progress.done + 1}/${progress.total}`
                  : forceRead
                    ? "Force read"
                    : "Read pages"}
              </Button>
              <div
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm",
                  progress && "opacity-50",
                )}
              >
                <Checkbox
                  id="force-read"
                  checked={forceRead}
                  disabled={!!progress}
                  onCheckedChange={(checked) => setForceRead(checked === true)}
                />
                <label
                  htmlFor="force-read"
                  className={progress ? "cursor-not-allowed" : "cursor-pointer"}
                >
                  Force read
                </label>
              </div>
              {selectedPageIds.size ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9"
                  disabled={!!progress}
                  onClick={() => void removeSelectedPages()}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  {selectedPageIds.size === 1
                    ? "Remove page from viewer"
                    : `Remove ${selectedPageIds.size} pages from viewer`}
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {contentMode === "text"
                  ? "Words only. Diagrams are not cropped."
                  : "Words, plus diagram crops."}{" "}
                {readScopeNote(forceRead, selectedPageIds.size, selectedAlreadyRead)}
              </p>
            </div>

            {progress ? (
              <Progress
                className="mt-3"
                value={(progress.done / Math.max(1, progress.total)) * 100}
              />
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2">
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2">
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      configOpen ? "rotate-180" : "rotate-0",
                    )}
                    aria-hidden="true"
                  />
                  {configOpen ? "Hide details" : "Paper details"}
                </Button>
              </CollapsibleTrigger>
              <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                <span className="text-foreground">{READER_LABELS[reader.engine]}</span>
                {pages.length
                  ? ` · ${pages.length} page${pages.length === 1 ? "" : "s"}${
                      readPageCount ? ` · ${readPageCount} read` : ""
                    }`
                  : " · No pages yet"}
                {!configOpen && detailSummary ? ` · ${detailSummary}` : ""}
              </p>
            </div>
          </section>

          <CollapsibleContent>
            <div className="border-t border-border px-3 pb-4 pt-3 sm:px-4">
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="standard" className="text-xs text-muted-foreground">
                    Standard
                  </Label>
                  <select
                    id="standard"
                    className={selectClass}
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
                  <Label htmlFor="stream" className="text-xs text-muted-foreground">
                    Stream
                  </Label>
                  <select
                    id="stream"
                    className={selectClass}
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
                  <Label htmlFor="subject" className="text-xs text-muted-foreground">
                    Subject
                  </Label>
                  <select
                    id="subject"
                    className={selectClass}
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
                  <Label htmlFor="exam" className="text-xs text-muted-foreground">
                    Exam / source
                  </Label>
                  <Input
                    id="exam"
                    className="h-9"
                    placeholder="CBSE"
                    value={meta.exam ?? ""}
                    onChange={(event) =>
                      patchMeta({ exam: event.target.value, source: event.target.value })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="duration" className="text-xs text-muted-foreground">
                    Duration (min)
                  </Label>
                  <Input
                    id="duration"
                    className="h-9"
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
                  <Label htmlFor="difficulty" className="text-xs text-muted-foreground">
                    Difficulty
                  </Label>
                  <select
                    id="difficulty"
                    className={selectClass}
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
                  <Label htmlFor="dmarks" className="text-xs text-muted-foreground">
                    Default marks
                  </Label>
                  <Input
                    id="dmarks"
                    className="h-9"
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
                  <Label htmlFor="dneg" className="text-xs text-muted-foreground">
                    Default negative
                  </Label>
                  <Input
                    id="dneg"
                    className="h-9"
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

                <div className="space-y-1.5 sm:col-span-2 md:col-span-3 xl:col-span-4">
                  <Label htmlFor="hint" className="text-xs text-muted-foreground">
                    Notes for the reader
                  </Label>
                  <Input
                    id="hint"
                    className="h-9"
                    placeholder="Answer key is on the last page. Section B is assertion and reason."
                    value={meta.notes ?? ""}
                    onChange={(event) => patchMeta({ notes: event.target.value })}
                  />
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <aside className="flex h-[112.5vh] min-h-[840px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-paper)]">
            <PageImageViewer
              pages={pages.map((page) => ({
                id: page.id,
                pageIndex: page.page_index,
                dataUrl: page.dataUrl,
              }))}
              className="h-full min-h-0 min-w-0"
            />
          </aside>

          <section className="flex h-[112.5vh] min-h-[840px] min-w-0 flex-col overflow-x-hidden overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-paper)]">
            {questions.length ? (
              <div className="shrink-0 space-y-3 border-b border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="mr-auto min-w-0">
                    <p className="font-display text-2xl leading-none">
                      {questions.length} question{questions.length === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {paperTotals.checked
                        ? `${paperTotals.passedChecks} of ${paperTotals.checked} passed checks · `
                        : ""}
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
                </div>

                <div className="flex flex-wrap gap-2">
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
              </div>
            ) : (
              <div className="shrink-0 border-b border-border px-6 py-8 text-center">
                <FileJson className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <h2 className="mt-4 text-2xl">Your parsed paper appears here</h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Create a past paper or practice test, add images, then select pages and read them.
                  With none selected, Read pages reads every page that has not been read. Select a
                  page and turn on Force read to read it again. Existing questions stay until you delete
                  them. Or add a
                  question yourself — cards line up by question number. Work stays in local SQLite
                  until you download exam-prep JSON.
                </p>
              </div>
            )}

            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain break-words p-4">
              <PageReview
                questions={visible}
                numberingQuestions={questions}
                showImages={false}
                resolveFigure={(path) => figureUrls[path]}
                onApprovalChange={solution.approve}
                onQuestionChange={patchQuestion}
                onDelete={deleteQuestion}
                onAddQuestion={addQuestion}
                onRegenerate={solution.regenerate}
                generatingIds={solution.generatingIds}
                queuedIds={solution.queuedIds}
                promptReveal={solution.promptReveal}
                promptStore={solution.prompts}
                solutionAudience={audience}
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function readScopeNote(forceRead: boolean, selectedCount: number, alreadyRead: number): string {
  if (forceRead) {
    if (!selectedCount) {
      return "Select an already-read page to read it again. Existing questions stay.";
    }
    if (alreadyRead === 1) {
      return `${selectedCount} selected. 1 already read, so it will be read again. Existing questions stay.`;
    }
    if (alreadyRead) {
      return `${selectedCount} selected. ${alreadyRead} already read, so they will be read again. Existing questions stay.`;
    }
    return `${selectedCount} selected. None have been read yet.`;
  }
  if (selectedCount) {
    return `${selectedCount} selected${alreadyRead ? `, ${alreadyRead} already read` : ""}.`;
  }
  return "No pages selected, so this reads every page that has not been read.";
}

function pageReadBadge(page: PageRecord): string | null {
  if (page.ocr_status !== "done") return null;
  if (page.read_mode === "text") return "Read · Text";
  if (page.read_mode === "graphics") return "Read · Graphics";
  return "Read";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not encode figure"));
    reader.readAsDataURL(blob);
  });
}
