import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { CalibrationBanner } from "@/components/CalibrationBanner";
import { GenerationProgress } from "@/components/mock/GenerationProgress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isCheckedSkill } from "@/lib/generation/checked/registry";
import {
  SOURCE_AGENT_IDS,
  DIFFICULTIES,
  type Difficulty,
  type DocumentMeta,
  type MockGenerationState,
  type SourceAgentId,
} from "@/lib/document-types";
import { SOURCE_AGENTS } from "@/lib/generation/agents/source-agents";
import { SKILL_CATALOG } from "@/lib/question-taxonomy";
import type { Question } from "@/lib/question-schema";
import {
  createAiMockFromInstructions,
  createSyllabusPaper,
  getLocalCatalog,
  saveLocalDocument,
} from "@/lib/local-store.functions";
import { listSyllabi } from "@/lib/syllabus";
import { resumeMockPaperGeneration } from "@/lib/mock-paper-client";
import { generateMockQuestion } from "@/lib/mock-paper.functions";

export const Route = createFileRoute("/mock-new")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { mode?: "instructions" | "topic" | "syllabus"; agent?: SourceAgentId } => ({
    ...(search["mode"] === "instructions" ||
    search["mode"] === "topic" ||
    search["mode"] === "syllabus"
      ? { mode: search["mode"] }
      : {}),
    ...(search["agent"] === "past_paper" || search["agent"] === "practice_test"
      ? { agent: search["agent"] }
      : {}),
  }),
  head: () => ({
    meta: [
      { title: "New AI Mock Paper — PaperParse" },
      {
        name: "description",
        content: "Generate a completely new AI mock paper from your instructions.",
      },
    ],
  }),
  component: MockNewPage,
});

function MockNewPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const createFn = useServerFn(createAiMockFromInstructions);
  const syllabusFn = useServerFn(createSyllabusPaper);
  const catalogFn = useServerFn(getLocalCatalog);
  const saveFn = useServerFn(saveLocalDocument);
  const generateFn = useServerFn(generateMockQuestion);

  const syllabi = listSyllabi();

  const catalog = useQuery({
    queryKey: ["local-catalog"],
    queryFn: () => catalogFn(),
  });

  const [title, setTitle] = useState("AI Mock Paper");
  const [paperMode, setPaperMode] = useState<"instructions" | "topic" | "syllabus">(
    search.mode ?? "instructions",
  );
  const [agent, setAgent] = useState<SourceAgentId | null>(search.agent ?? null);
  const [drillSkill, setDrillSkill] = useState("number_series");
  const [syllabusStandardId, setSyllabusStandardId] = useState<number>(5);
  const [harder, setHarder] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [plannedCount, setPlannedCount] = useState(10);
  const [standardId, setStandardId] = useState<number | "">("");
  const [streamId, setStreamId] = useState<number | "">("");
  const [subjectId, setSubjectId] = useState<number | "">("");
  const [topicId, setTopicId] = useState<number | "">("");
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [exam, setExam] = useState("");
  const [duration, setDuration] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [liveGeneration, setLiveGeneration] = useState<{
    generation: MockGenerationState;
    total: number;
  } | null>(null);

  // A top-bar deep link can change the requested mode/agent while this page is open.
  // Absent params mean the plain form: default mode, no agent chosen.
  useEffect(() => {
    setPaperMode(search.mode ?? "instructions");
    setAgent(search.agent ?? null);
  }, [search.mode, search.agent]);

  const streams = useMemo(() => {
    const all = catalog.data?.streams ?? [];
    if (standardId === "") return all;
    return all.filter((s) => s.standard_id == null || s.standard_id === standardId);
  }, [catalog.data?.streams, standardId]);

  const topics = useMemo(() => {
    const all = catalog.data?.topics ?? [];
    if (subjectId === "") return all;
    return all.filter((t) => t.subject_id == null || t.subject_id === subjectId);
  }, [catalog.data?.topics, subjectId]);

  async function resumeFrom(created: { document: DocumentMeta; questions: Question[] }) {
    const subjectName =
      catalog.data?.subjects.find((s) => s.id === created.document.subject_id)?.name ?? null;
    const standardName =
      catalog.data?.standards.find((s) => s.id === created.document.standard_id)?.name ?? null;
    const streamName =
      catalog.data?.streams.find((s) => s.id === created.document.stream_id)?.name ?? null;
    const topicsById: Record<number, string> = {};
    for (const topic of catalog.data?.topics ?? []) {
      topicsById[topic.id] = topic.name;
    }
    const catalogOptions = catalog.data
      ? {
          subjects: catalog.data.subjects.map((s) => ({ id: s.id, name: s.name })),
          topics: topics.map((t) => ({ id: t.id, name: t.name })),
        }
      : undefined;

    setProgress("Generating questions…");
    const result = await resumeMockPaperGeneration({
      mockId: created.document.id,
      document: created.document,
      questions: created.questions,
      catalogNames: {
        subject: subjectName,
        standard: standardName,
        stream: streamName,
        topicsById,
      },
      ...(catalogOptions ? { catalogOptions } : {}),
      runGenerate: generateFn,
      runSave: saveFn,
      onProgress: ({ cursor, total, generation }) => {
        setProgress(`Generating question ${Math.min(cursor + 1, total)} of ${total}…`);
        setLiveGeneration({ generation, total });
      },
    });
    if (result.completed) {
      toast.success(`AI mock ready — ${result.questions.length} questions.`);
    } else {
      toast.message("Generation paused. Resume from the library.");
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (paperMode === "topic" && standardId === "") {
      toast.error("Choose the class, for example 5th or 8th.");
      return;
    }
    if (paperMode === "instructions" && instructions.trim().length < 10) {
      toast.error("Add clearer instructions (at least a short paragraph).");
      return;
    }
    setBusy(true);
    let mockId: string | null = null;
    try {
      if (paperMode === "syllabus") {
        setProgress("Building the paper plan…");
        const created = await syllabusFn({
          data: {
            standard_id: syllabusStandardId,
            ...(agent ? { agent } : {}),
            title: title.trim() || undefined,
          },
        });
        mockId = created.document.id;
        await resumeFrom(created);
        void navigate({ to: "/library" });
        return;
      }

      setProgress("Creating draft…");
      const created = await createFn({
        data: {
          title: title.trim() || "AI Mock Paper",
          instructions: instructions.trim(),
          planned_count: plannedCount,
          ...(paperMode === "topic"
            ? { drill_skill: drillSkill, difficulty_step: harder ? 1 : 0 }
            : {}),
          standard_id: standardId === "" ? null : standardId,
          stream_id: streamId === "" ? null : streamId,
          subject_id: subjectId === "" ? null : subjectId,
          topic_id: topicId === "" ? null : topicId,
          difficulty: difficulty === "" ? null : difficulty,
          exam: exam.trim() || null,
          duration_minutes: duration === "" ? null : duration,
        },
      });
      mockId = created.document.id;
      await resumeFrom(created);
      void navigate({ to: "/library" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate the AI mock.");
      if (mockId) {
        toast.message("Draft saved — resume generation from the library.");
        void navigate({ to: "/library" });
      }
    } finally {
      setBusy(false);
      setProgress(null);
      setLiveGeneration(null);
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-6">
          <CalibrationBanner />
        </div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
          <h1 className="text-4xl">New AI Mock Paper</h1>
        </div>
        <p className="mt-2 text-muted-foreground">
          Describe a whole paper, or practise one topic for a class. Checked topics compute the
          answer. Other topics still use the model. Generation resumes from the library if it stops.
        </p>

        <form className="mt-8 space-y-5" onSubmit={(e) => void onSubmit(e)}>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">What to generate</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="paper-mode"
                  checked={paperMode === "instructions"}
                  onChange={() => setPaperMode("instructions")}
                />
                From instructions
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="paper-mode"
                  checked={paperMode === "topic"}
                  onChange={() => setPaperMode("topic")}
                />
                One topic
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="paper-mode"
                  checked={paperMode === "syllabus"}
                  onChange={() => setPaperMode("syllabus")}
                />
                Complete paper
              </label>
            </div>
          </fieldset>

          {paperMode === "syllabus" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="syllabus-class">Class</Label>
                <select
                  id="syllabus-class"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={syllabusStandardId}
                  onChange={(e) => setSyllabusStandardId(Number(e.target.value))}
                >
                  {syllabi.map((syllabus) => (
                    <option key={syllabus.standard_id} value={syllabus.standard_id}>
                      {syllabus.label}
                      {syllabus.draft ? " (draft)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Agent</Label>
                <p className="text-xs text-muted-foreground">
                  Optional — leave unset to reference every paper in your library.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SOURCE_AGENT_IDS.map((id) => {
                    const entry = SOURCE_AGENTS[id];
                    return (
                      <label
                        key={id}
                        className={`flex cursor-pointer flex-col rounded-lg border p-3 text-sm ${
                          agent === id ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="syllabus-agent"
                            checked={agent === id}
                            onChange={() => setAgent(id)}
                          />
                          <span className="font-medium">{entry.label}</span>
                        </span>
                        <span className="mt-1 text-xs text-muted-foreground">{entry.summary}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Generates the whole paper from the syllabus: Math, General Knowledge, English and
                Intelligence. Answers are checked by a solver where possible; the rest use the model
                with reference questions from the chosen agent's memory — or your whole library when
                no agent is picked.
              </p>
            </div>
          ) : null}

          {paperMode === "topic" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="topic">Topic</Label>
                <select
                  id="topic"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={drillSkill}
                  onChange={(e) => setDrillSkill(e.target.value)}
                >
                  {SKILL_CATALOG.map((skill) => (
                    <option key={skill.skill_type} value={skill.skill_type}>
                      {skill.skill_type.replaceAll("_", " ")}
                      {isCheckedSkill(skill.skill_type) ? " (answer checked)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={harder}
                  onChange={(e) => setHarder(e.target.checked)}
                />
                One step harder, still inside the class
              </label>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="instructions">
              {paperMode === "instructions" ? "Instructions" : "Extra notes (optional)"}
            </Label>
            <Textarea
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={8}
              placeholder={
                paperMode === "topic"
                  ? "Optional. For example: word problems only, avoid decimals."
                  : "e.g. Class 10 CBSE Mathematics — algebra and geometry, mix of MCQ and short answer, medium difficulty, emphasize word problems…"
              }
              required={paperMode === "instructions"}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="count">Number of questions</Label>
              <Input
                id="count"
                type="number"
                min={1}
                max={80}
                value={plannedCount}
                onChange={(e) => setPlannedCount(Number(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="difficulty">Difficulty</Label>
              <select
                id="difficulty"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={difficulty}
                onChange={(e) => setDifficulty((e.target.value || "") as Difficulty | "")}
              >
                <option value="">AI decides</option>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="standard">{paperMode === "topic" ? "Class" : "Standard"}</Label>
              <select
                id="standard"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={standardId}
                onChange={(e) => {
                  setStandardId(e.target.value ? Number(e.target.value) : "");
                  setStreamId("");
                }}
              >
                <option value="">{paperMode === "topic" ? "Choose a class" : "Optional"}</option>
                {(catalog.data?.standards ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stream">Stream</Label>
              <select
                id="stream"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={streamId}
                onChange={(e) => setStreamId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Optional</option>
                {streams.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <select
                id="subject"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={subjectId}
                onChange={(e) => {
                  const next = e.target.value ? Number(e.target.value) : "";
                  setSubjectId(next);
                  const firstTopic =
                    next === ""
                      ? undefined
                      : (catalog.data?.topics ?? []).find((t) => t.subject_id === next);
                  setTopicId(firstTopic ? firstTopic.id : "");
                }}
              >
                <option value="">Optional</option>
                {(catalog.data?.subjects ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="topic">Topic</Label>
              <select
                id="topic"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={topicId}
                onChange={(e) => setTopicId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Optional</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="exam">Exam / board</Label>
              <Input
                id="exam"
                value={exam}
                onChange={(e) => setExam(e.target.value)}
                placeholder="CBSE / JEE / …"
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input
                id="duration"
                type="number"
                min={1}
                value={duration}
                onChange={(e) =>
                  setDuration(e.target.value === "" ? "" : Number(e.target.value) || "")
                }
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {progress ?? "Working…"}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Generate AI Mock
                </>
              )}
            </Button>
            <Button type="button" variant="ghost" asChild disabled={busy}>
              <Link to="/library">Cancel</Link>
            </Button>
          </div>

          {busy && liveGeneration ? (
            <GenerationProgress
              generation={liveGeneration.generation}
              total={liveGeneration.total}
              generating
            />
          ) : null}
        </form>
      </main>
    </div>
  );
}
