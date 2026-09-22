import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { QuestionCard } from "@/components/questions/QuestionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  isMockGenerationIncomplete,
  mockGenerationTotal,
  type DocumentMeta,
  type MockGenerationState,
} from "@/lib/document-types";
import { getLocalCatalog, getLocalDocument, saveLocalDocument } from "@/lib/local-store.functions";
import { resumeMockPaperGeneration } from "@/lib/mock-paper-client";
import { generateMockQuestion } from "@/lib/mock-paper.functions";
import type { Question } from "@/lib/question-schema";

export const Route = createFileRoute("/compare/$mockId")({
  head: () => ({
    meta: [
      { title: "Compare AI Mock — PaperParse" },
      {
        name: "description",
        content: "Side-by-side comparison of the original paper and the AI mock paper.",
      },
    ],
  }),
  component: ComparePage,
});

function ComparePage() {
  const { mockId } = Route.useParams();
  const queryClient = useQueryClient();
  const getFn = useServerFn(getLocalDocument);
  const saveFn = useServerFn(saveLocalDocument);
  const generateFn = useServerFn(generateMockQuestion);
  const catalogFn = useServerFn(getLocalCatalog);

  const [pairIndex, setPairIndex] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [mockDoc, setMockDoc] = useState<DocumentMeta | null>(null);
  const [mockQuestions, setMockQuestions] = useState<Question[]>([]);
  const [sourceDoc, setSourceDoc] = useState<DocumentMeta | null>(null);
  const [sourceQuestions, setSourceQuestions] = useState<Question[]>([]);
  const [sourceFigures, setSourceFigures] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const autoStartedRef = useRef(false);

  const catalog = useQuery({
    queryKey: ["local-catalog"],
    queryFn: () => catalogFn(),
  });

  async function reload() {
    const mock = await getFn({ data: { id: mockId } });
    if (!mock || mock.document.kind !== "ai_mock") {
      setReady(true);
      setMockDoc(null);
      return;
    }
    setMockDoc(mock.document);
    setMockQuestions(mock.questions);

    if (mock.document.source_document_id) {
      const source = await getFn({ data: { id: mock.document.source_document_id } });
      if (source) {
        setSourceDoc(source.document);
        setSourceQuestions(source.questions);
        setSourceFigures(source.figureUrls);
      } else {
        setSourceDoc(null);
        setSourceQuestions([]);
        setSourceFigures({});
      }
    } else {
      setSourceDoc(null);
      setSourceQuestions([]);
      setSourceFigures({});
    }
    setReady(true);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when mockId changes
  }, [mockId]);

  const generation = mockDoc?.generation ?? null;
  const pairs = generation?.pairs ?? [];
  const totalPlanned = mockGenerationTotal(generation);
  const incomplete = isMockGenerationIncomplete(generation);

  const activePair = pairs[pairIndex] ?? null;
  const sourceQuestion = useMemo(() => {
    if (!activePair?.source_question_id) return null;
    return sourceQuestions.find((q) => q.id === activePair.source_question_id) ?? null;
  }, [activePair, sourceQuestions]);
  const mockQuestion = useMemo(() => {
    if (!activePair) return null;
    return mockQuestions.find((q) => q.id === activePair.mock_question_id) ?? null;
  }, [activePair, mockQuestions]);

  useEffect(() => {
    if (pairIndex >= pairs.length && pairs.length > 0) {
      setPairIndex(pairs.length - 1);
    }
  }, [pairIndex, pairs.length]);

  async function runResume() {
    if (!mockDoc?.generation) return;
    setGenerating(true);
    try {
      const subjectName =
        catalog.data?.subjects.find((s) => s.id === mockDoc.subject_id)?.name ?? null;
      const standardName =
        catalog.data?.standards.find((s) => s.id === mockDoc.standard_id)?.name ?? null;
      const streamName =
        catalog.data?.streams.find((s) => s.id === mockDoc.stream_id)?.name ?? null;
      const topicsById: Record<number, string> = {};
      for (const topic of catalog.data?.topics ?? []) {
        topicsById[topic.id] = topic.name;
      }

      const result = await resumeMockPaperGeneration({
        mockId,
        document: mockDoc,
        questions: mockQuestions,
        sourceQuestions,
        catalogNames: {
          subject: subjectName,
          standard: standardName,
          stream: streamName,
          topicsById,
        },
        runGenerate: generateFn,
        runSave: saveFn,
        onProgress: ({ questions, generation: nextGen }) => {
          setMockQuestions(questions);
          setMockDoc((current) =>
            current ? { ...current, generation: nextGen as MockGenerationState } : current,
          );
          if (nextGen.pairs.length) {
            setPairIndex(nextGen.pairs.length - 1);
          }
        },
      });
      setMockQuestions(result.questions);
      setMockDoc((current) =>
        current ? { ...current, generation: result.generation } : current,
      );
      void queryClient.invalidateQueries({ queryKey: ["local-documents"] });
      if (result.completed) {
        toast.success("AI mock generation complete.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Generation failed. You can resume.");
      await reload();
    } finally {
      setGenerating(false);
    }
  }

  // Auto-start if pending when landing from Generate.
  useEffect(() => {
    if (!ready || !mockDoc?.generation || generating) return;
    if (!mockDoc.source_document_id) return;
    if (mockDoc.generation.status !== "pending") return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    void runResume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mockDoc?.id]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!mockDoc) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-muted-foreground">That AI mock was not found.</p>
          <Button className="mt-4" asChild>
            <Link to="/library">Back to library</Link>
          </Button>
        </main>
      </div>
    );
  }

  if (!mockDoc.source_document_id) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-3xl">{mockDoc.title}</h1>
          <p className="mt-2 text-muted-foreground">
            This mock was generated from instructions only — side-by-side comparison is not available.
          </p>
          <Button className="mt-4" asChild>
            <Link to="/library">Back to library</Link>
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto min-w-0">
            <h1 className="truncate text-3xl">{mockDoc.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Comparing with {sourceDoc?.title ?? "source paper"}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/library">Library</Link>
          </Button>
          {incomplete ? (
            <Button size="sm" disabled={generating} onClick={() => void runResume()}>
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  {generation?.status === "failed" ? "Resume generation" : "Continue generation"}
                </>
              )}
            </Button>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">
            {generation?.cursor ?? 0}/{totalPlanned} generated
          </Badge>
          <Badge variant="secondary" className="capitalize">
            {generation?.status ?? "unknown"}
          </Badge>
          {generation?.last_error ? (
            <span className="text-destructive">{generation.last_error}</span>
          ) : null}
        </div>

        {pairs.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
            {generating
              ? "Generating the first mock question…"
              : "No paired questions yet. Start or resume generation."}
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={pairIndex <= 0}
                onClick={() => setPairIndex((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </Button>
              <span className="text-sm font-medium">
                Pair {pairIndex + 1} of {pairs.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pairIndex >= pairs.length - 1}
                onClick={() => setPairIndex((i) => Math.min(pairs.length - 1, i + 1))}
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <section>
                <h2 className="mb-3 text-lg font-semibold">Original</h2>
                {sourceQuestion ? (
                  <QuestionCard
                    question={sourceQuestion}
                    index={pairIndex}
                    resolve={(path) => sourceFigures[path]}
                  />
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                    Source question missing (deleted or remapped).
                  </p>
                )}
              </section>
              <section>
                <h2 className="mb-3 text-lg font-semibold">AI Mock</h2>
                {mockQuestion ? (
                  <QuestionCard question={mockQuestion} index={pairIndex} />
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                    Mock question not found for this pair.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
