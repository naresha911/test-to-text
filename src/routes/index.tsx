import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Download,
  FileJson,
  ImagePlus,
  Library,
  Loader2,
  LogOut,
  ScanText,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageReview } from "@/components/questions/PageReview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { extractPage } from "@/lib/extract.functions";
import { cropFigure, preparePageImage } from "@/lib/image-utils";
import {
  QUESTION_TYPE_LABELS,
  buildExport,
  type Question,
  type QuestionType,
} from "@/lib/question-schema";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PaperParse — question paper images to structured JSON" },
      {
        name: "description",
        content:
          "Upload question paper or practice test images and get clean JSON: MCQs, assertions, fill in the blanks, true/false, comprehension, LaTeX equations and diagram crops.",
      },
      { property: "og:title", content: "PaperParse — question papers to structured JSON" },
      {
        property: "og:description",
        content:
          "AI reads your scanned exam pages and returns renderable, downloadable JSON with LaTeX math and cropped diagrams.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

type Page = { name: string; dataUrl: string; blob: Blob };

function HomePage() {
  const { session, loading } = useAuth();
  const runExtract = useServerFn(extractPage);
  const fileInput = useRef<HTMLInputElement>(null);

  const [pages, setPages] = useState<Page[]>([]);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [exam, setExam] = useState("");
  const [hint, setHint] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [figureUrls, setFigureUrls] = useState<Record<string, string>>({});
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<QuestionType | "all">("all");

  const counts = useMemo(() => {
    const map = new Map<QuestionType, number>();
    for (const question of questions) map.set(question.type, (map.get(question.type) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [questions]);

  const visible = useMemo(
    () => (filter === "all" ? questions : questions.filter((q) => q.type === filter)),
    [questions, filter],
  );

  function setApproved(questionId: string, approved: boolean) {
    setQuestions((current) =>
      current.map((question) => (question.id === questionId ? { ...question, approved } : question)),
    );
    setSavedId(null);
  }

  const addFiles = useCallback(async (list: FileList | null) => {
    if (!list?.length) return;
    const images = [...list].filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      toast.error("Please choose image files (JPG, PNG, HEIC exports or screenshots).");
      return;
    }
    try {
      const prepared = await Promise.all(
        images.map(async (file) => ({ name: file.name, ...(await preparePageImage(file)) })),
      );
      setPages((current) => [...current, ...prepared]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read those images.");
    }
  }, []);

  async function handleExtract() {
    if (!session) return;
    if (!pages.length) {
      toast.error("Add at least one page image first.");
      return;
    }

    setQuestions([]);
    setFigureUrls({});
    setImagePaths([]);
    setSavedId(null);
    setProgress({ done: 0, total: pages.length });

    const folder = `${session.user.id}/${crypto.randomUUID()}`;
    const collected: Question[] = [];
    const urls: Record<string, string> = {};
    const storedPages: string[] = [];
    let failed = 0;

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index]!;
      const pagePath = `${folder}/page-${index + 1}.jpg`;
      const upload = await supabase.storage
        .from("paper-images")
        .upload(pagePath, page.blob, { contentType: "image/jpeg", upsert: true });
      if (!upload.error) storedPages.push(pagePath);

      try {
        const result = await runExtract({
          data: {
            imageDataUrl: page.dataUrl,
            page: index,
            ...(hint.trim() ? { hint: hint.trim() } : {}),
          },
        });

        for (const question of result.questions) {
          for (const [figureIndex, figure] of question.figures.entries()) {
            if (!figure.bbox) continue;
            const crop = await cropFigure(page.dataUrl, figure.bbox);
            if (!crop) continue;
            const figurePath = `${folder}/p${index + 1}-fig-${collected.length + 1}-${figureIndex + 1}.jpg`;
            const figureUpload = await supabase.storage
              .from("paper-images")
              .upload(figurePath, crop, { contentType: "image/jpeg", upsert: true });
            if (figureUpload.error) continue;
            figure.image_path = figurePath;
            urls[figurePath] = URL.createObjectURL(crop);
          }
          collected.push(question);
        }

        if (!result.questions.length) failed += 1;
      } catch (error) {
        failed += 1;
        const raw = error instanceof Error ? error.message : "";
        if (raw.includes("AI_CREDITS")) {
          toast.error(
            raw.replace(/^.*AI_CREDITS:\s*/, "") ||
              "The AI reading credits for this workspace are used up.",
          );
          setProgress(null);
          setQuestions([...collected]);
          setImagePaths([...storedPages]);
          return;
        }
        toast.error(raw || `Page ${index + 1} could not be read.`);
      }


      setProgress({ done: index + 1, total: pages.length });
      setQuestions([...collected]);
      setFigureUrls({ ...urls });
      setImagePaths([...storedPages]);
    }

    setProgress(null);
    if (collected.length) {
      toast.success(
        `Found ${collected.length} question${collected.length === 1 ? "" : "s"}${
          failed ? ` — ${failed} page(s) returned nothing` : ""
        }.`,
      );
    } else {
      toast.error("No questions were found. Try a sharper or more zoomed-in photo.");
    }
  }

  function handleDownload() {
    const payload = buildExport(
      {
        title: title.trim() || "Untitled paper",
        subject: subject.trim() || null,
        exam: exam.trim() || null,
        notes: hint.trim() || null,
      },
      questions,
      savedId ?? undefined,
    );
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(title.trim() || "question-paper").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleSave() {
    if (!session || !questions.length) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("papers")
      .insert({
        user_id: session.user.id,
        title: title.trim() || "Untitled paper",
        subject: subject.trim() || null,
        exam: exam.trim() || null,
        notes: hint.trim() || null,
        image_paths: imagePaths,
        questions: JSON.parse(JSON.stringify(questions)),
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      toast.error("Could not save this paper. Please try again.");
      return;
    }
    setSavedId(data.id);
    toast.success("Saved to your library.");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-primary">
            <ScanText className="h-5 w-5" aria-hidden="true" />
            <span className="font-display text-xl">PaperParse</span>
          </Link>
          <nav className="ml-auto flex items-center gap-2">
            {session ? (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/library">
                    <Library className="h-4 w-4" aria-hidden="true" />
                    Library
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void supabase.auth.signOut();
                  }}
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </Button>
              </>
            ) : (
              <Button size="sm" asChild>
                <Link to="/auth">Sign in</Link>
              </Button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10">
        <section className="max-w-2xl">
          <h1 className="text-4xl leading-tight sm:text-5xl">
            Turn question paper photos into <span className="ink-underline">structured JSON</span>
          </h1>
          <p className="mt-4 text-muted-foreground">
            Upload scanned pages of a question paper, practice test or aptitude test. Equations come
            back as LaTeX, figures come back described and cropped, and every question is typed —
            multiple choice, assertion and reason, fill in the blanks, true or false, comprehension,
            matching and more.
          </p>
        </section>

        {!session ? (
          <div className="mt-8 rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-paper)]">
            <h2 className="text-xl">Sign in to start</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Papers, page scans and diagram crops are stored privately against your account.
            </p>
            <Button className="mt-4" asChild>
              <Link to="/auth">Sign in or create an account</Link>
            </Button>
          </div>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
            <aside className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-paper)]">
                <h2 className="text-lg">1. Add pages</h2>
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
                    {pages.map((page, index) => (
                      <li key={page.name + index} className="relative">
                        <img
                          src={page.dataUrl}
                          alt={`Page ${index + 1}`}
                          className="h-24 w-full rounded border border-border object-cover"
                        />
                        <span className="absolute bottom-1 left-1 rounded bg-background/80 px-1 text-[10px]">
                          {index + 1}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove page ${index + 1}`}
                          onClick={() =>
                            setPages((current) => current.filter((_, i) => i !== index))
                          }
                          className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-paper)]">
                <h2 className="text-lg">2. Describe the paper</h2>
                <div className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      placeholder="Term 1 mock test"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="subject">Subject</Label>
                      <Input
                        id="subject"
                        placeholder="Maths"
                        value={subject}
                        onChange={(event) => setSubject(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="exam">Exam</Label>
                      <Input
                        id="exam"
                        placeholder="CBSE X"
                        value={exam}
                        onChange={(event) => setExam(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hint">Notes for the reader (optional)</Label>
                    <Textarea
                      id="hint"
                      rows={3}
                      placeholder="Answer key is on the last page. Section B is assertion and reason."
                      value={hint}
                      onChange={(event) => setHint(event.target.value)}
                    />
                  </div>
                </div>

                <Button
                  className="mt-4 w-full"
                  onClick={() => void handleExtract()}
                  disabled={!!progress || !pages.length}
                >
                  {progress ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  )}
                  {progress ? `Reading page ${progress.done + 1} of ${progress.total}` : "Convert to JSON"}
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
                  <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-paper)]">
                    <div className="mr-auto">
                      <p className="font-display text-2xl leading-none">
                        {questions.length} question{questions.length === 1 ? "" : "s"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {counts.map(([type, count]) => `${QUESTION_TYPE_LABELS[type]} ${count}`).join(" · ")}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleDownload}>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Download JSON
                    </Button>
                    <Button size="sm" onClick={() => void handleSave()} disabled={saving || !!savedId}>
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <FileJson className="h-4 w-4" aria-hidden="true" />
                      )}
                      {savedId ? "Saved" : "Save to library"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setQuestions([]);
                        setSavedId(null);
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Clear
                    </Button>
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
                    Each question is rendered in the layout that matches its type, with equations
                    typeset from LaTeX and figures shown as cropped images. Then download the JSON
                    or save it to your library.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
