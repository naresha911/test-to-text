import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { createLocalImageAssetStore } from "@/lib/assets/store";
import { type AiGenerationContext } from "@/lib/ai-generation-log";
import { parseMockGeneration, type MockGenerationState } from "@/lib/document-types";
import { commandCodeApiKey, omniroutersApiKey } from "@/lib/generation/chat-provider";
import {
  completeGenerationChat,
  DEFAULT_MOCK_MODEL,
  MOCK_MODEL_FALLBACKS,
  type GenerationChatMessage,
} from "@/lib/generation/chat-transport";
import { completeExamChat, type ExamImage } from "@/lib/generation/exam-chat";
import { expandSlots } from "@/lib/generation/agents/paper-architect";
import { sourceAgent } from "@/lib/generation/agents/source-agents";
import { difficultyBiasFor, loadExemplars } from "@/lib/generation/agents/question-author";
import { skillAuthorPlan } from "@/lib/generation/skills/author-plan";
import {
  applyPromptOverrides,
  skillAuthorPrompt,
  skillDifficultyGuidance,
} from "@/lib/generation/skill-prompts";
import { buildSearchQuery } from "@/lib/generation/web-search";
import { SYSTEM_PROMPT } from "@/lib/generation/generation-system-prompt";
import { skillByType } from "@/lib/question-taxonomy";
import {
  emptyGenerationItem,
  parseGenerationItem,
  type GenerationItem,
} from "@/lib/generation/job-types";
import { runGenerationItem } from "@/lib/generation/orchestrator";
import { buildGrammarUserPrompt } from "@/lib/generation/textual/prompt";
import { redrawMirrorFigure } from "@/lib/generation/visual/assets";
import { attachModelFigures } from "@/lib/generation/visual/model-figures";
import {
  getDocument,
  listAppliedPromptOverrides,
  readLocalImageDataUrl,
  updateDocument,
} from "@/lib/local-db";
import {
  assertMockQuestionComplete,
  buildFromInstructionsUserPrompt,
  buildFromSourceUserPrompt,
  finalizeMockQuestion,
  parseGradeFromStandardName,
  type MockPaperAudience,
} from "@/lib/mock-paper";
import { emptyQuestion, type Question } from "@/lib/question-schema";
import { toSourceQuestionRecord } from "@/lib/source/source-record";

export { DEFAULT_MOCK_MODEL, MOCK_MODEL_FALLBACKS };

const OptionSchema = z.object({
  key: z.string(),
  text: z.string(),
  is_correct: z.boolean().nullable().optional(),
  image_path: z.string().nullable().optional(),
  image_description: z.string().nullable().optional(),
});

const QuestionInputSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    number: z.string().nullable(),
    type: z.string(),
    stem: z.string(),
    instructions: z.string().nullable().optional(),
    passage: z.string().nullable().optional(),
    assertion: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    options: z.array(OptionSchema).default([]),
    blanks: z.array(z.string()).default([]),
    match_pairs: z.array(z.object({ left: z.string(), right: z.string() })).default([]),
    sub_questions: z.array(QuestionInputSchema).default([]),
    answer_keys: z.array(z.string()).default([]),
    answer_text: z.string().nullable().optional(),
    answer_boolean: z.boolean().nullable().optional(),
    hint: z.string().nullable().optional(),
    explanation: z.string().nullable().optional(),
    marks: z.number().nullable().optional(),
    section: z.string().nullable().optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).nullable().optional(),
    tags: z.array(z.string()).default([]),
    figures: z
      .array(
        z.object({
          description: z.string(),
          caption: z.string().nullable().optional(),
          image_path: z.string().nullable().optional(),
        }),
      )
      .default([]),
    page: z.number().nullable().optional(),
    confidence: z.number().nullable().optional(),
    approved: z.boolean().optional(),
  }),
);

const AudienceSchema = z.object({
  subject: z.string().max(200).nullable().optional(),
  exam: z.string().max(200).nullable().optional(),
  notes: z.string().max(600).nullable().optional(),
  standard: z.string().max(200).nullable().optional(),
  stream: z.string().max(200).nullable().optional(),
  difficulty: z.string().max(40).nullable().optional(),
  topic: z.string().max(200).nullable().optional(),
});

const InputSchema = z.object({
  mode: z.enum(["from_source", "from_instructions"]),
  sourceQuestion: QuestionInputSchema.optional(),
  instructions: z.string().max(8000).nullable().optional(),
  index: z.number().int().min(0),
  total: z.number().int().min(1),
  number: z.string().max(40).optional(),
  sourceQuestionId: z.string().nullable().optional(),
  previousStems: z.array(z.string().max(400)).max(12).optional(),
  audience: AudienceSchema.optional(),
  catalog: z
    .object({
      subject_id: z.number().int().nullable().optional(),
      topic_id: z.number().int().nullable().optional(),
      standard_id: z.number().int().nullable().optional(),
      stream_id: z.number().int().nullable().optional(),
    })
    .optional(),
  strategy: z.enum(["rewrite", "write_new"]).optional(),
  /** Forced skill for a full-syllabus slot (added to the instructions). */
  skill: z.string().min(1).max(80).optional(),
  pattern_subtype: z.string().max(60).nullable().optional(),
  catalogOptions: z
    .object({
      subjects: z
        .array(z.object({ id: z.number().int(), name: z.string().min(1).max(200) }))
        .max(200)
        .optional(),
      topics: z
        .array(z.object({ id: z.number().int(), name: z.string().min(1).max(300) }))
        .max(500)
        .optional(),
    })
    .optional(),
  model: z.string().min(2).max(120).optional(),
  documentId: z.string().min(1),
  sourceDocumentId: z.string().min(1).nullable().optional(),
  jobId: z.string().min(1).optional(),
  item: z.unknown().optional(),
  generation: z.unknown().optional(),
  savedQuestions: z.array(z.unknown()).optional(),
  existingQuestion: z.unknown().optional(),
  /** Regeneration keeps the old question until the new one is ready, so checkpoints must not rewrite the list. */
  checkpointQuestions: z.boolean().optional(),
  questions_rev: z.number().int().nonnegative(),
});

// The authoring system prompt lives in a plain module so server code can share it.

/** Skills a vision pass may name for a figure whose stem carries no clue. */
const FIGURE_SKILLS = new Set<string>([
  "mirror_image",
  "water_image",
  "embedded_figure",
  "figure_pattern",
  "figure_analogy",
  "figure_series",
  "venn_diagram",
  "missing_number_figure",
  "figure_identity",
]);

const CLASSIFY_FIGURE_PROMPT =
  'Name the non-verbal reasoning skill this exam figure belongs to. Return JSON {"skill":"..."} with exactly one of: mirror_image, water_image, embedded_figure, figure_pattern, figure_analogy, figure_series, venn_diagram, missing_number_figure, figure_identity, other. mirror_image = a mirror reflection or a figure with a vertical mirror line drawn beside it. water_image = a reflection in water, or a horizontal mirror line drawn below or beside the figure. embedded_figure = find a shape hidden inside another. figure_pattern = complete a matrix or pattern of figures. figure_analogy = A is to B as C is to ?. figure_series = the next figure in a sequence. venn_diagram = set relationships in circles. missing_number_figure = a diagram with a missing number. figure_identity = choose the identical or rotated copy of a figure. Judge only from the picture.';

async function questionImages(question: Question): Promise<ExamImage[]> {
  const labeled: { path: string; label: string }[] = [];
  question.figures.forEach((figure, index) => {
    if (figure.image_path) {
      labeled.push({
        path: figure.image_path,
        label: figure.caption?.trim() || figure.description.trim() || `Figure ${index + 1}`,
      });
    }
  });
  question.options.forEach((option) => {
    if (option.image_path) labeled.push({ path: option.image_path, label: `Option ${option.key}` });
  });
  const images: ExamImage[] = [];
  for (const item of labeled.slice(0, 6)) {
    const dataUrl = await readLocalImageDataUrl(item.path);
    if (dataUrl) images.push({ dataUrl, label: item.label });
  }
  return images;
}

function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

function asQuestion(raw: unknown): Question {
  const r = (raw ?? {}) as Record<string, unknown>;
  const options = Array.isArray(r["options"]) ? r["options"] : [];
  const subRaw = Array.isArray(r["sub_questions"]) ? r["sub_questions"] : [];
  return emptyQuestion({
    id: typeof r["id"] === "string" ? r["id"] : crypto.randomUUID(),
    number: typeof r["number"] === "string" ? r["number"] : null,
    type: (typeof r["type"] === "string" ? r["type"] : "unknown") as Question["type"],
    stem: typeof r["stem"] === "string" ? r["stem"] : "",
    instructions: typeof r["instructions"] === "string" ? r["instructions"] : null,
    passage: typeof r["passage"] === "string" ? r["passage"] : null,
    assertion: typeof r["assertion"] === "string" ? r["assertion"] : null,
    reason: typeof r["reason"] === "string" ? r["reason"] : null,
    options: options.map((o, i) => {
      const oo = (o ?? {}) as Record<string, unknown>;
      return {
        key: typeof oo["key"] === "string" ? oo["key"] : String.fromCharCode(65 + i),
        text: typeof oo["text"] === "string" ? oo["text"] : "",
        is_correct: typeof oo["is_correct"] === "boolean" ? oo["is_correct"] : null,
        image_path: typeof oo["image_path"] === "string" ? oo["image_path"] : null,
        image_description:
          typeof oo["image_description"] === "string" ? oo["image_description"] : null,
      };
    }),
    blanks: Array.isArray(r["blanks"])
      ? r["blanks"].map((b) => (typeof b === "string" ? b : ""))
      : [],
    match_pairs: Array.isArray(r["match_pairs"])
      ? r["match_pairs"].map((p) => {
          const pp = (p ?? {}) as Record<string, unknown>;
          return {
            left: typeof pp["left"] === "string" ? pp["left"] : "",
            right: typeof pp["right"] === "string" ? pp["right"] : "",
          };
        })
      : [],
    answer_keys: Array.isArray(r["answer_keys"])
      ? r["answer_keys"].filter((k): k is string => typeof k === "string")
      : [],
    answer_text: typeof r["answer_text"] === "string" ? r["answer_text"] : null,
    answer_boolean: typeof r["answer_boolean"] === "boolean" ? r["answer_boolean"] : null,
    hint: typeof r["hint"] === "string" ? r["hint"] : null,
    explanation: typeof r["explanation"] === "string" ? r["explanation"] : null,
    marks: typeof r["marks"] === "number" ? r["marks"] : null,
    section: typeof r["section"] === "string" ? r["section"] : null,
    difficulty:
      r["difficulty"] === "easy" || r["difficulty"] === "medium" || r["difficulty"] === "hard"
        ? r["difficulty"]
        : null,
    tags: Array.isArray(r["tags"])
      ? r["tags"].filter((t): t is string => typeof t === "string")
      : [],
    figures: Array.isArray(r["figures"])
      ? r["figures"].map((f) => {
          const ff = (f ?? {}) as Record<string, unknown>;
          const rawBbox = ff["bbox"];
          const bbox =
            Array.isArray(rawBbox) &&
            rawBbox.length === 4 &&
            rawBbox.every((value) => typeof value === "number")
              ? (rawBbox as [number, number, number, number])
              : null;
          return {
            description: typeof ff["description"] === "string" ? ff["description"] : "",
            caption: typeof ff["caption"] === "string" ? ff["caption"] : null,
            image_path: typeof ff["image_path"] === "string" ? ff["image_path"] : null,
            bbox,
            page: typeof ff["page"] === "number" ? ff["page"] : null,
          };
        })
      : [],
    page: typeof r["page"] === "number" ? r["page"] : null,
    confidence: typeof r["confidence"] === "number" ? r["confidence"] : null,
    approved: r["approved"] === true,
    sub_questions: subRaw.map((sub) => asQuestion(sub)),
  });
}

/** Resolve a model-returned catalog name to its id (exact, case-insensitive). */
function matchCatalogId(
  options: { id: number; name: string }[] | undefined,
  value: unknown,
): number | null {
  if (!options?.length || typeof value !== "string") return null;
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  const hit = options.find((option) => option.name.trim().toLowerCase() === needle);
  return hit?.id ?? null;
}

async function executeMockGeneration(
  data: z.infer<typeof InputSchema>,
): Promise<{ question: Question; item: GenerationItem; questions_rev: number }> {
  const commandCodeKey = commandCodeApiKey();
  const omniroutersKey = omniroutersApiKey();
  const openRouterKey = process.env["OPENROUTER_API_KEY"];
  const lovableKey = process.env["LOVABLE_API_KEY"];

  const audience: MockPaperAudience | undefined = data.audience
    ? {
        subject: data.audience.subject ?? null,
        exam: data.audience.exam ?? null,
        notes: data.audience.notes ?? null,
        standard: data.audience.standard ?? null,
        stream: data.audience.stream ?? null,
        difficulty: data.audience.difficulty ?? null,
        topic: data.audience.topic ?? null,
      }
    : undefined;

  const number = data.number?.trim() || String(data.index + 1);
  const slotSkill = data.skill?.trim() || null;
  const slotInstructions =
    data.mode === "from_instructions"
      ? [slotSkill ? `[skill:${slotSkill}]` : "", data.instructions?.trim() ?? ""]
          .filter(Boolean)
          .join("\n") || null
      : null;
  if (data.mode === "from_source" && !data.sourceQuestion) {
    throw new Error("Source question is required for from_source generation.");
  }
  const sourceQuestion = data.mode === "from_source" ? asQuestion(data.sourceQuestion) : null;
  const jobId = data.jobId ?? data.documentId;
  const strategy: "rewrite" | "write_new" = data.strategy ?? "write_new";
  // Metadata inheritance: reuse the source/document ids and ask the model to fill only gaps.
  const inheritedSubjectId = data.catalog?.subject_id ?? null;
  const inheritedTopicId = data.catalog?.topic_id ?? null;
  const needsSubjectFill =
    inheritedSubjectId == null && (data.catalogOptions?.subjects?.length ?? 0) > 0;
  const needsTopicFill = inheritedTopicId == null && (data.catalogOptions?.topics?.length ?? 0) > 0;
  const metadataCatalog =
    needsSubjectFill || needsTopicFill
      ? {
          ...(needsSubjectFill
            ? { subjects: data.catalogOptions?.subjects?.map((entry) => entry.name) ?? [] }
            : {}),
          ...(needsTopicFill
            ? { topics: data.catalogOptions?.topics?.map((entry) => entry.name) ?? [] }
            : {}),
        }
      : undefined;
  const item =
    parseGenerationItem(data.item) ??
    emptyGenerationItem({
      jobId,
      sequence: data.index,
      sourceQuestionId: data.sourceQuestionId ?? sourceQuestion?.id ?? null,
    });
  const assetStore = createLocalImageAssetStore();

  // Applied calibration edits change the skill prompt text; hydrate before authoring.
  try {
    applyPromptOverrides(await listAppliedPromptOverrides());
  } catch {
    // A missing override store still lets generation run with the static prompts.
  }

  async function completeChat(
    messages: GenerationChatMessage[],
    options?: { vision?: boolean; context?: AiGenerationContext },
  ): Promise<string> {
    return completeGenerationChat({
      messages,
      ...(options?.vision ? { vision: true } : {}),
      requestedModel: data.model?.trim() ?? null,
      ...(options?.context ? { context: options.context } : {}),
    });
  }

  let savedQuestions = Array.isArray(data.savedQuestions)
    ? (data.savedQuestions as Question[])
    : [];
  let generationState = parseMockGeneration(data.generation);
  let questionsRev = data.questions_rev;
  // The source agent (past-paper or practice-test) shapes the prompt and which
  // library memory this question draws its references from.
  const activeAgent = sourceAgent(generationState?.agent ?? null);
  const agentBlock = activeAgent ? `\n\n${activeAgent.systemAddendum}` : "";
  const authorInstructions =
    data.mode === "from_source"
      ? data.instructions?.trim() || generationState?.instructions?.trim() || null
      : null;

  // The source is read-only, so a vision-named figure skill is cached on this
  // mock's generation state. Later regenerations of the same source skip vision.
  const sourceKey = data.sourceQuestionId ?? sourceQuestion?.id ?? null;
  const cachedFigureSkill = sourceKey ? generationState?.figure_skills?.[sourceKey] : undefined;
  const sourceHasFigure = Boolean(sourceQuestion?.figures.some((figure) => figure.image_path));
  const needsFigureVision =
    sourceHasFigure &&
    !cachedFigureSkill &&
    Boolean(commandCodeKey || omniroutersKey || openRouterKey || lovableKey);

  async function classifySourceFigure(): Promise<string | null> {
    const figure = sourceQuestion?.figures.find((entry) => entry.image_path);
    if (!figure?.image_path) return null;
    const dataUrl = await readLocalImageDataUrl(figure.image_path);
    if (!dataUrl) return null;
    try {
      const text = await completeChat(
        [
          {
            role: "user",
            content: [
              { type: "text", text: CLASSIFY_FIGURE_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        {
          vision: true,
          context: {
            kind: "mock_figure",
            label: `Q${number} figure classify`,
          },
        },
      );
      const parsed = extractJson(text) as { skill?: unknown } | null;
      const skill = typeof parsed?.skill === "string" ? parsed.skill.trim().toLowerCase() : "";
      if (!FIGURE_SKILLS.has(skill)) return null;
      if (sourceKey && generationState) {
        generationState = {
          ...generationState,
          figure_skills: { ...(generationState.figure_skills ?? {}), [sourceKey]: skill },
        };
        try {
          await updateDocument(data.documentId, { generation: generationState });
        } catch {
          // The cache write is best effort; the skill still applies to this run.
        }
      }
      return skill;
    } catch {
      return null;
    }
  }

  const result = await runGenerationItem({
    item,
    jobId,
    sequence: data.index,
    documentId: data.documentId,
    source:
      sourceQuestion && data.sourceDocumentId
        ? toSourceQuestionRecord({
            documentId: data.sourceDocumentId,
            question: sourceQuestion,
          })
        : sourceQuestion
          ? toSourceQuestionRecord({ documentId: data.documentId, question: sourceQuestion })
          : null,
    instructions: slotInstructions,
    authorInstructions,
    strategy,
    number,
    audience: {
      standard: audience?.standard ?? null,
      subject: audience?.subject ?? null,
      exam: audience?.exam ?? null,
    },
    grade: parseGradeFromStandardName(audience?.standard ?? null),
    difficultyStep: generationState?.difficulty_step ?? 0,
    existingQuestion:
      data.existingQuestion && typeof data.existingQuestion === "object"
        ? (data.existingQuestion as Question)
        : null,
    assetStore,
    retrieveExamples: async (analysis) =>
      loadExemplars(
        {
          skill: analysis.skill_type,
          pattern_subtype: data.pattern_subtype ?? analysis.pattern_subtype,
          standard_id: data.catalog?.standard_id ?? null,
          subject_id: data.catalog?.subject_id ?? null,
          stream_id: data.catalog?.stream_id ?? null,
          ...(activeAgent ? { agent: activeAgent.id, kinds: [activeAgent.id] } : {}),
        },
        3,
      ),
    ...(needsFigureVision ? { classifySourceFigure } : {}),
    ...(cachedFigureSkill ? { sourceSkill: cachedFigureSkill } : {}),
    callGrammarModel: async (spec) => {
      const text = await completeChat(
        [
          {
            role: "system",
            content:
              "You write original grammar questions. Return one JSON object and nothing else.",
          },
          { role: "user", content: buildGrammarUserPrompt(spec, authorInstructions) },
        ],
        { context: { kind: "mock_grammar", label: `Q${number}` } },
      );
      const parsed = extractJson(text);
      if (!parsed) throw new Error("The grammar model returned unreadable output. Try again.");
      return parsed;
    },
    callLegacyModel: async (questionId, skill, context) => {
      let userContent: string;
      let sourceType: Question["type"] | null = null;
      let sourceDifficulty: Question["difficulty"] | null = null;
      const grade = parseGradeFromStandardName(audience?.standard ?? null);
      const difficultyStep =
        (generationState?.difficulty_step ?? 0) +
        (await difficultyBiasFor(
          {
            agent: activeAgent?.id ?? null,
            standard_id: data.catalog?.standard_id ?? null,
            subject_id: data.catalog?.subject_id ?? null,
            stream_id: data.catalog?.stream_id ?? null,
          },
          skill,
        ));
      const plan = skillAuthorPlan({ skill, grade, difficultyStep, hasImages: false });
      const wantsImages = plan?.requiresImages === true || skillByType(skill)?.visual === true;
      const images = wantsImages && sourceQuestion ? await questionImages(sourceQuestion) : [];
      let skillNote =
        plan?.systemAddendum ??
        [skillAuthorPrompt(skill), skillDifficultyGuidance(skill, grade, difficultyStep)]
          .filter(Boolean)
          .join("\n");
      if (skill === "synonym_antonym") {
        const relationText = (
          sourceQuestion?.instructions ??
          sourceQuestion?.stem ??
          ""
        ).toLowerCase();
        if (/opposite|antonym/i.test(relationText)) {
          skillNote +=
            "\n\nThis item must ask for the OPPOSITE (antonym) word. The answer is a word that means the reverse of the stem word.";
        } else if (/synonym|same meaning|similar meaning|same in meaning/i.test(relationText)) {
          skillNote +=
            "\n\nThis item must ask for the SYNONYM (same meaning) word. The answer is a word that means the same as the stem word.";
        }
      }
      if (data.mode === "from_source") {
        if (!sourceQuestion)
          throw new Error("Source question is required for from_source generation.");
        sourceType = sourceQuestion.type;
        sourceDifficulty = sourceQuestion.difficulty ?? null;
        const audienceForPrompt: MockPaperAudience | undefined = audience
          ? {
              ...audience,
              difficulty: sourceQuestion.difficulty ?? audience.difficulty ?? null,
              topic: audience.topic ?? null,
            }
          : sourceQuestion.difficulty
            ? { difficulty: sourceQuestion.difficulty }
            : undefined;
        userContent = buildFromSourceUserPrompt({
          sourceQuestion,
          index: data.index,
          total: data.total,
          ...(audienceForPrompt ? { audience: audienceForPrompt } : {}),
          ...(images.length ? { hasImages: true } : {}),
          authorInstructions,
          strategy,
          ...(metadataCatalog ? { metadataCatalog } : {}),
          ...(context.exemplars.length ? { exemplars: context.exemplars } : {}),
        });
      } else {
        const instructions =
          data.instructions?.trim() ||
          (slotSkill
            ? `Write one new ${slotSkill.replaceAll("_", " ")} question for this class.`
            : "");
        if (!instructions)
          throw new Error("Instructions are required for from_instructions generation.");
        userContent = buildFromInstructionsUserPrompt({
          instructions,
          index: data.index,
          total: data.total,
          previousStems: data.previousStems ?? [],
          ...(audience ? { audience } : {}),
          ...(context.exemplars.length ? { exemplars: context.exemplars } : {}),
        });
      }
      const authorBlock = authorInstructions
        ? `\n\nADDITIONAL INSTRUCTIONS (must follow for this question):\n${authorInstructions}`
        : "";
      const chat = await completeExamChat({
        messages: [
          {
            role: "system",
            content: `${skillNote ? `${SYSTEM_PROMPT}\n\n${skillNote}` : SYSTEM_PROMPT}${agentBlock}${authorBlock}`,
          },
          { role: "user", content: userContent },
        ],
        images,
        searchQuery: buildSearchQuery({
          stem: sourceQuestion?.stem ?? data.instructions ?? null,
          ...(audience?.subject != null ? { subject: audience.subject } : {}),
          ...(audience?.exam != null ? { exam: audience.exam } : {}),
        }),
        accept: (text) => {
          const parsed = extractJson(text);
          if (!parsed || typeof parsed !== "object") return false;
          const stem = (parsed as { stem?: unknown }).stem;
          const passage = (parsed as { passage?: unknown }).passage;
          return (
            (typeof stem === "string" && stem.trim().length > 0) ||
            (typeof passage === "string" && passage.trim().length > 0)
          );
        },
        context: { kind: "mock_author", label: `Q${number}` },
      });
      if (!chat.accepted) {
        throw new Error("The mock model did not return a usable question stem. Try again.");
      }
      const parsed = extractJson(chat.text);
      if (!parsed) throw new Error("The mock model returned unreadable output. Try again.");
      const rawMeta = parsed as Record<string, unknown>;
      const resolvedSubjectId =
        inheritedSubjectId ?? matchCatalogId(data.catalogOptions?.subjects, rawMeta["subject"]);
      const resolvedTopicId =
        inheritedTopicId ?? matchCatalogId(data.catalogOptions?.topics, rawMeta["topic"]);
      const catalog = data.catalog
        ? {
            subject_id: resolvedSubjectId,
            topic_id: resolvedTopicId,
            standard_id: data.catalog.standard_id ?? null,
            stream_id: data.catalog.stream_id ?? null,
          }
        : resolvedSubjectId != null || resolvedTopicId != null
          ? { subject_id: resolvedSubjectId, topic_id: resolvedTopicId }
          : null;
      const question = {
        ...finalizeMockQuestion(parsed, {
          number,
          sourceQuestionId: data.sourceQuestionId ?? null,
          generationJobId: jobId,
          sourceType,
          sourceDifficulty,
          strategy,
          sourceInstructions: sourceQuestion?.instructions ?? null,
          ...(catalog ? { catalog } : {}),
        }),
        id: questionId,
      };
      if (!question.stem.trim() && !question.passage?.trim() && !question.assertion?.trim()) {
        throw new Error("The mock model did not return a usable question stem. Try again.");
      }
      assertMockQuestionComplete(question, sourceType);
      return attachModelFigures({
        question,
        store: assetStore,
        documentId: data.documentId,
      });
    },
    describeSourceFigure: async () => {
      const figure = sourceQuestion?.figures.find((entry) => entry.image_path);
      if (!figure?.image_path) return null;
      const dataUrl = await readLocalImageDataUrl(figure.image_path);
      if (!dataUrl || (!commandCodeKey && !omniroutersKey && !openRouterKey && !lovableKey)) {
        return null;
      }
      try {
        const text = await completeChat(
          [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: 'Describe only the asymmetry of this figure in one sentence. Return JSON {"summary":"..."}. Do not return coordinates, SVG, or an image.',
                },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          {
            vision: true,
            context: {
              kind: "mock_figure",
              label: `Q${number} figure describe`,
            },
          },
        );
        const parsed = extractJson(text) as { summary?: string } | null;
        return parsed?.summary ?? null;
      } catch {
        return null;
      }
    },
    onCheckpoint: async ({ item: nextItem, question }) => {
      if (question) {
        const index = savedQuestions.findIndex((entry) => entry.id === question.id);
        savedQuestions =
          index >= 0
            ? savedQuestions.map((entry) => (entry.id === question.id ? question : entry))
            : [...savedQuestions, question];
      }
      if (!generationState) return;
      const items = generationState.items ?? [];
      const existing = items.some((entry) => entry.item_id === nextItem.item_id);
      generationState = {
        ...generationState,
        job_id: generationState.job_id ?? jobId,
        items: existing
          ? items.map((entry) => (entry.item_id === nextItem.item_id ? nextItem : entry))
          : [...items, nextItem],
      };
      const writeQuestions = data.checkpointQuestions !== false;
      const saved = await updateDocument(data.documentId, {
        generation: generationState,
        ...(writeQuestions ? { questions: savedQuestions, questions_rev: questionsRev } : {}),
      });
      if (saved && writeQuestions) questionsRev = saved.questions_rev;
    },
  });

  return { question: result.question, item: result.item, questions_rev: questionsRev };
}

export const generateMockQuestion = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => executeMockGeneration(data));

function replaceQuestion(questions: Question[], next: Question, previousId: string): Question[] {
  return questions.map((question) => (question.id === previousId ? next : question));
}

export const regenerateMockFigure = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ documentId: z.string().min(1), questionId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const loaded = await getDocument(data.documentId);
    if (!loaded) throw new Error("That mock paper was not found.");
    const question = loaded.questions.find((entry) => entry.id === data.questionId);
    if (!question) throw new Error("That question was not found.");
    const item = loaded.document.generation?.items?.find(
      (entry) => entry.candidate_question_id === question.id,
    );
    const stem = question.stem;
    const answerKeys = [...question.answer_keys];
    const next = await redrawMirrorFigure({
      question,
      store: createLocalImageAssetStore(),
      documentId: data.documentId,
      idempotencyKey: item?.idempotency_key ?? `${data.documentId}:${question.id}:figure`,
    });
    if (next.stem !== stem || next.answer_keys.join() !== answerKeys.join()) {
      throw new Error("Figure regeneration changed the question.");
    }
    const questions = replaceQuestion(loaded.questions, next, question.id);
    const saved = await updateDocument(data.documentId, {
      questions,
      questions_rev: loaded.document.questions_rev,
    });
    return { question: next, questions_rev: saved?.questions_rev ?? loaded.document.questions_rev };
  });

export const regenerateMockQuestion = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        documentId: z.string().min(1),
        questionId: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const loaded = await getDocument(data.documentId);
    if (!loaded?.document.generation) throw new Error("That mock has no generation job.");
    const current = loaded.questions.find((entry) => entry.id === data.questionId);
    if (!current) throw new Error("That question was not found.");
    const generation = loaded.document.generation;
    const previous = generation.items?.find((entry) => entry.candidate_question_id === current.id);
    const sequence = previous?.sequence ?? 0;
    // A syllabus mock carries no instructions, so recover this question's slot
    // to keep its skill and subject on a single-question regenerate.
    const planSlot = generation.plan ? (expandSlots(generation.plan)[sequence] ?? null) : null;
    const jobId = generation.job_id ?? data.documentId;
    const fresh = emptyGenerationItem({
      jobId,
      sequence,
      sourceQuestionId: current.source_question_id ?? previous?.source_question_id ?? null,
    });
    fresh.item_id = `${fresh.item_id}:again:${Date.now()}`;
    fresh.idempotency_key = `${fresh.idempotency_key}:again:${Date.now()}`;

    let source = null;
    if (fresh.source_question_id && loaded.document.source_document_id) {
      const sourceDoc = await getDocument(loaded.document.source_document_id);
      const sourceQuestion = sourceDoc?.questions.find(
        (entry) => entry.id === fresh.source_question_id,
      );
      if (sourceQuestion && loaded.document.source_document_id) {
        source = toSourceQuestionRecord({
          documentId: loaded.document.source_document_id,
          question: sourceQuestion,
        });
      }
    }

    const generated = await executeMockGeneration({
      mode: generation.mode,
      ...(source ? { sourceQuestion: source.question } : {}),
      instructions: generation.instructions,
      ...(planSlot ? { skill: planSlot.skill, pattern_subtype: planSlot.pattern_subtype } : {}),
      ...(generation.strategy ? { strategy: generation.strategy } : {}),
      index: sequence,
      total: Math.max(generation.items?.length ?? 1, sequence + 1),
      number: current.number ?? String(sequence + 1),
      sourceQuestionId: fresh.source_question_id,
      documentId: data.documentId,
      sourceDocumentId: loaded.document.source_document_id,
      jobId,
      item: fresh,
      generation,
      savedQuestions: loaded.questions.filter((entry) => entry.id !== current.id),
      checkpointQuestions: false,
      questions_rev: loaded.document.questions_rev,
      catalog: {
        subject_id:
          planSlot?.subject_id ?? source?.question.subject_id ?? loaded.document.subject_id,
        topic_id: source?.question.topic_id ?? loaded.document.topic_id,
        standard_id: source?.question.standard_id ?? loaded.document.standard_id,
        stream_id: source?.question.stream_id ?? loaded.document.stream_id,
      },
      audience: {
        exam: loaded.document.exam,
        notes: loaded.document.notes,
      },
    });

    const questions = loaded.questions.map((entry) =>
      entry.id === current.id ? generated.question : entry,
    );
    // Checkpoints saved the new item and any cached figure skill while the run
    // went on, so read the current state back instead of rebuilding from the
    // pre-run snapshot (which would drop them).
    const persisted = (await getDocument(data.documentId))?.document.generation ?? generation;
    const items = (persisted.items ?? []).filter(
      (entry) =>
        entry.candidate_question_id !== current.id && entry.item_id !== generated.item.item_id,
    );
    items.push(generated.item);
    const nextGeneration: MockGenerationState = {
      ...persisted,
      job_id: jobId,
      pairs: persisted.pairs.map((pair) =>
        pair.mock_question_id === current.id
          ? { ...pair, mock_question_id: generated.question.id }
          : pair,
      ),
      items,
    };
    const saved = await updateDocument(data.documentId, {
      questions,
      generation: nextGeneration,
      questions_rev: generated.questions_rev,
    });
    return {
      question: generated.question,
      generation: nextGeneration,
      questions,
      questions_rev: saved?.questions_rev ?? generated.questions_rev,
    };
  });
