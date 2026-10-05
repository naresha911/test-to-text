import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { GenerationProgress } from "@/components/mock/GenerationProgress";
import { AddQuestionForm, type NewQuestionInput } from "@/components/questions/AddQuestionForm";
import { QuestionCard } from "@/components/questions/QuestionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  isMockGenerationIncomplete,
  isPaperChangedError,
  mockGenerationTotal,
  type DocumentMeta,
  type MockGenerationState,
} from "@/lib/document-types";
import { getLocalCatalog, getLocalDocument, saveLocalDocument } from "@/lib/local-store.functions";
import { resumeMockPaperGeneration } from "@/lib/mock-paper-client";
import {
  generateMockQuestion,
  regenerateMockFigure,
  regenerateMockQuestion,
} from "@/lib/mock-paper.functions";
import { sortMockPairs, sortQuestions } from "@/lib/question-order";
import {
  createManualQuestion,
  findQuestionById,
  removeQuestionById,
  updateQuestionById,
  withGeneratedStatus,
  type Question,
} from "@/lib/question-schema";

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
  const regenerateQuestionFn = useServerFn(regenerateMockQuestion);
  const regenerateFigureFn = useServerFn(regenerateMockFigure);
  const catalogFn = useServerFn(getLocalCatalog);

  const [pairIndex, setPairIndex] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [mockDoc, setMockDoc] = useState<DocumentMeta | null>(null);
  const [mockQuestions, setMockQuestions] = useState<Question[]>([]);
  const [sourceDoc, setSourceDoc] = useState<DocumentMeta | null>(null);
  const [sourceQuestions, setSourceQuestions] = useState<Question[]>([]);
  const [sourceFigures, setSourceFigures] = useState<Record<string, string>>({});
  const [mockFigures, setMockFigures] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const autoStartedRef = useRef(false);
  const mockDocRef = useRef(mockDoc);
  const mockQuestionsRef = useRef(mockQuestions);
  const questionsRevRef = useRef(0);
  const saveChain = useRef(Promise.resolve());
  mockDocRef.current = mockDoc;
  mockQuestionsRef.current = mockQuestions;

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
    const sorted = sortQuestions(mock.questions);
    const generation = mock.document.generation
      ? {
          ...mock.document.generation,
          pairs: sortMockPairs(mock.document.generation.pairs, sorted),
        }
      : mock.document.generation;
    const document = { ...mock.document, generation };
    mockDocRef.current = document;
    mockQuestionsRef.current = sorted;
    questionsRevRef.current = mock.document.questions_rev;
    setMockDoc(document);
    setMockQuestions(sorted);
    setMockFigures(mock.figureUrls);

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
  const pairs = useMemo(
    () => sortMockPairs(generation?.pairs ?? [], mockQuestions),
    [generation, mockQuestions],
  );
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

  function saveMock(nextQuestions: Question[], nextGeneration?: MockGenerationState | null) {
    const document = mockDocRef.current;
    if (!document) return;
    const generation =
      nextGeneration === undefined
        ? document.generation
        : nextGeneration
          ? { ...nextGeneration, pairs: sortMockPairs(nextGeneration.pairs, nextQuestions) }
          : null;
    const nextDoc = { ...document, generation };
    mockDocRef.current = nextDoc;
    mockQuestionsRef.current = nextQuestions;
    setMockDoc(nextDoc);
    setMockQuestions(nextQuestions);
    const run = saveChain.current.then(async () => {
      try {
        const saved = await saveFn({
          data: {
            id: mockId,
            patch:
              nextGeneration === undefined
                ? { questions: mockQuestionsRef.current, questions_rev: questionsRevRef.current }
                : {
                    questions: mockQuestionsRef.current,
                    generation: mockDocRef.current?.generation ?? generation,
                    questions_rev: questionsRevRef.current,
                  },
          },
        });
        if (saved) questionsRevRef.current = saved.questions_rev;
      } catch (error) {
        if (!isPaperChangedError(error)) {
          toast.error("Could not autosave locally.");
          return;
        }
        await reload();
        toast.error("This paper changed on disk, so it was reloaded.");
      }
    });
    saveChain.current = run.then(
      () => undefined,
      () => undefined,
    );
  }

  function addQuestion(input: NewQuestionInput): string {
    const doc = mockDocRef.current;
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
      approval_status: "draft",
      approved: false,
    });
    const updated = sortQuestions([...mockQuestionsRef.current, created]);
    const generation = doc?.generation
      ? {
          ...doc.generation,
          pairs: [
            ...doc.generation.pairs,
            { source_question_id: null, mock_question_id: created.id },
          ],
        }
      : null;
    saveMock(updated, generation);
    const ordered = sortMockPairs(generation?.pairs ?? [], updated);
    const index = ordered.findIndex((pair) => pair.mock_question_id === created.id);
    setFocusId(created.id);
    setPairIndex(index >= 0 ? index : 0);
    void queryClient.invalidateQueries({ queryKey: ["local-documents"] });
    toast.success(`Question ${created.number} added.`);
    return created.id;
  }

  function deleteMockQuestion(questionId: string) {
    const updated = removeQuestionById(mockQuestionsRef.current, questionId);
    const generation = mockDocRef.current?.generation
      ? {
          ...mockDocRef.current.generation,
          pairs: mockDocRef.current.generation.pairs.filter(
            (pair) => pair.mock_question_id !== questionId,
          ),
        }
      : null;
    saveMock(updated, generation);
    setFocusId(null);
    void queryClient.invalidateQueries({ queryKey: ["local-documents"] });
    toast.success("Question deleted.");
  }

  function patchMockQuestion(next: Question) {
    const current = mockQuestionsRef.current;
    const previous = findQuestionById(current, next.id);
    const patched = updateQuestionById(current, next.id, () => next);
    const numberChanged = (previous?.number ?? null) !== (next.number ?? null);
    const pageChanged = (previous?.page ?? null) !== (next.page ?? null);
    const updated = numberChanged || pageChanged ? sortQuestions(patched) : patched;
    const generation = mockDocRef.current?.generation ?? null;
    saveMock(updated, numberChanged ? generation : undefined);
    if (numberChanged && generation) {
      const ordered = sortMockPairs(generation.pairs, updated);
      const index = ordered.findIndex((pair) => pair.mock_question_id === next.id);
      if (index >= 0) setPairIndex(index);
    }
  }

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
      const catalogOptions = {
        subjects: (catalog.data?.subjects ?? []).map((subject) => ({
          id: subject.id,
          name: subject.name,
        })),
        topics: (catalog.data?.topics ?? []).map((topic) => ({
          id: topic.id,
          name: topic.name,
        })),
      };

      const result = await resumeMockPaperGeneration({
        mockId,
        document: { ...mockDoc, questions_rev: questionsRevRef.current },
        questions: mockQuestions,
        sourceQuestions,
        catalogNames: {
          subject: subjectName,
          standard: standardName,
          stream: streamName,
          topicsById,
        },
        catalogOptions,
        runGenerate: generateFn,
        runSave: saveFn,
        onProgress: ({ questions, generation: nextGen, questions_rev }) => {
          const sorted = sortQuestions(questions);
          const nextGeneration = {
            ...(nextGen as MockGenerationState),
            pairs: sortMockPairs(nextGen.pairs, sorted),
          };
          mockQuestionsRef.current = sorted;
          questionsRevRef.current = questions_rev;
          setMockQuestions(sorted);
          setMockDoc((current) => {
            const next = current ? { ...current, generation: nextGeneration } : current;
            mockDocRef.current = next;
            return next;
          });
          if (nextGeneration.pairs.length) {
            setPairIndex(nextGeneration.pairs.length - 1);
          }
        },
      });
      const sortedResult = sortQuestions(result.questions);
      mockQuestionsRef.current = sortedResult;
      questionsRevRef.current = result.questions_rev;
      setMockQuestions(sortedResult);
      setMockDoc((current) => {
        const next = current
          ? {
              ...current,
              generation: {
                ...result.generation,
                pairs: sortMockPairs(result.generation.pairs, sortedResult),
              },
            }
          : current;
        mockDocRef.current = next;
        return next;
      });
      const fresh = await getFn({ data: { id: mockId } });
      if (fresh) {
        const sortedFresh = sortQuestions(fresh.questions);
        mockQuestionsRef.current = sortedFresh;
        questionsRevRef.current = fresh.document.questions_rev;
        setMockQuestions(sortedFresh);
        setMockFigures(fresh.figureUrls);
      }
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
            This mock was generated from instructions only — side-by-side comparison is not
            available.
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

        <div className="mt-4 space-y-2">
          <GenerationProgress
            generation={generation}
            total={totalPlanned}
            generating={generating}
          />
          {generation?.strategy ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">
                {generation.strategy === "rewrite" ? "Copyright-Safe Rewrite" : "Write New"}
              </Badge>
            </div>
          ) : null}
        </div>

        <div className="mt-6">
          <AddQuestionForm questions={mockQuestions} onAdd={addQuestion} />
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
                onClick={() => {
                  setFocusId(null);
                  setPairIndex((i) => Math.max(0, i - 1));
                }}
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
                onClick={() => {
                  setFocusId(null);
                  setPairIndex((i) => Math.min(pairs.length - 1, i + 1));
                }}
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
                  <QuestionCard
                    key={mockQuestion.id}
                    question={mockQuestion}
                    index={pairIndex}
                    startEditing={mockQuestion.id === focusId}
                    resolve={(path) => mockFigures[path]}
                    onChange={patchMockQuestion}
                    onDelete={deleteMockQuestion}
                    onReviewGenerated={(questionId, status) => {
                      const updated = updateQuestionById(
                        mockQuestionsRef.current,
                        questionId,
                        (question) => withGeneratedStatus(question, status),
                      );
                      saveMock(updated);
                    }}
                    onRegenerateGenerated={(questionId) => {
                      return regenerateQuestionFn({ data: { documentId: mockId, questionId } })
                        .then(async (result) => {
                          mockQuestionsRef.current = result.questions;
                          setMockQuestions(result.questions);
                          setMockDoc((current) => {
                            const next = current
                              ? { ...current, generation: result.generation }
                              : current;
                            mockDocRef.current = next;
                            return next;
                          });
                          const fresh = await getFn({ data: { id: mockId } });
                          if (fresh) {
                            const sortedFresh = sortQuestions(fresh.questions);
                            mockQuestionsRef.current = sortedFresh;
                            questionsRevRef.current = fresh.document.questions_rev;
                            setMockQuestions(sortedFresh);
                            setMockFigures(fresh.figureUrls);
                          }
                          toast.success("A new question was generated.");
                        })
                        .catch((error: unknown) => {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "Could not regenerate that question.",
                          );
                        });
                    }}
                    onRegenerateFigure={(questionId) => {
                      const before = mockQuestion;
                      return regenerateFigureFn({ data: { documentId: mockId, questionId } })
                        .then(async (result) => {
                          if (
                            result.question.stem !== before.stem ||
                            result.question.answer_keys.join() !== before.answer_keys.join()
                          ) {
                            throw new Error("Figure regeneration changed the question.");
                          }
                          const updated = updateQuestionById(
                            mockQuestionsRef.current,
                            questionId,
                            () => result.question,
                          );
                          mockQuestionsRef.current = updated;
                          setMockQuestions(updated);
                          const fresh = await getFn({ data: { id: mockId } });
                          if (fresh) {
                            const sortedFresh = sortQuestions(fresh.questions);
                            mockQuestionsRef.current = sortedFresh;
                            questionsRevRef.current = fresh.document.questions_rev;
                            setMockQuestions(sortedFresh);
                            setMockFigures(fresh.figureUrls);
                          }
                          toast.success("Figure redrawn.");
                        })
                        .catch((error: unknown) => {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "Could not redraw that figure.",
                          );
                        });
                    }}
                  />
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
