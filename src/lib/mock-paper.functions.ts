import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { createLocalImageAssetStore } from "@/lib/assets/store";
import { parseMockGeneration, type MockGenerationState } from "@/lib/document-types";
import {
  chatCompletionBody,
  completeChatWithFallback,
  generationChatTargets,
  omniroutersApiKey,
} from "@/lib/generation/chat-provider";
import { completeExamChat, type ExamImage } from "@/lib/generation/exam-chat";
import { detectSkill } from "@/lib/generation/skill-detect";
import { skillAuthorPlan } from "@/lib/generation/skills/author-plan";
import { skillAuthorPrompt, skillDifficultyGuidance } from "@/lib/generation/skill-prompts";
import { buildSearchQuery } from "@/lib/generation/web-search";
import { skillByType } from "@/lib/question-taxonomy";
import {
  emptyGenerationItem,
  parseGenerationItem,
  type GenerationItem,
} from "@/lib/generation/job-types";
import { runGenerationItem } from "@/lib/generation/orchestrator";
import { buildGrammarUserPrompt } from "@/lib/generation/textual/prompt";
import { redrawMirrorFigure } from "@/lib/generation/visual/assets";
import { getDocument, readLocalImageDataUrl, updateDocument } from "@/lib/local-db";
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

/** OpenRouter fallback when OmniRouters is unset or fails. models[] lets OpenRouter try the next free route. */
export const DEFAULT_MOCK_MODEL = "google/gemma-4-26b-a4b-it:free";
export const MOCK_MODEL_FALLBACKS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
] as const;

const OptionSchema = z.object({
  key: z.string(),
  text: z.string(),
  is_correct: z.boolean().nullable().optional(),
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
  total: z.number().int().min(1).max(80),
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
  model: z.string().min(2).max(120).optional(),
  documentId: z.string().min(1),
  sourceDocumentId: z.string().min(1).nullable().optional(),
  jobId: z.string().min(1).optional(),
  item: z.unknown().optional(),
  generation: z.unknown().optional(),
  savedQuestions: z.array(z.unknown()).optional(),
  existingQuestion: z.unknown().optional(),
  questions_rev: z.number().int().nonnegative(),
});

const SYSTEM_PROMPT = `You are an expert exam-paper author creating ORIGINAL mock questions for students.

GOALS
- Transform the skill, pattern, and difficulty of the source (or follow teacher instructions).
- Respect student STANDARD / grade, SOURCE difficulty, learning INTENT, and other metadata in the prompt.
- Avoid copyright infringement: never copy distinctive wording, passages, numbers, or option text â€” invent new ones.
- If the source is OCR-damaged or incomplete, infer the intended skill and invent a correct new question at an appropriate level.

LEVELING
- Aim questions at the student's stated standard (e.g. Class 6).
- You MAY stretch slightly harder â€” at most about +2 grades (Class 6 â†’ up to ~Class 8) when the source is hard or stretch is useful for practice.
- Never jump far above that band (no Class 11 methods for a Class 6 paper).
- Mirror source difficulty (easy/medium/hard) unless leveling rules say otherwise. Always set output "difficulty".

OUTPUT
- Return ONLY one JSON object (no markdown fences, no prose).
- Shape matches the app Question schema.
- Example for a normal MCQ:
  {"number":"1","type":"mcq","stem":"...","passage":null,"options":[{"key":"A","text":"...","is_correct":true}],"sub_questions":[],"answer_keys":["A"],"hint":"...","explanation":"...","marks":1,"difficulty":"medium","tags":[],"figures":[]}
- Example for comprehension (passage is REQUIRED â€” never omit):
  {"number":"3","type":"comprehension","stem":"Read the passage and answer the questions.","passage":"A full original multi-sentence passage invented by you...","options":[],"sub_questions":[{"number":"3.1","type":"mcq","stem":"...","options":[{"key":"A","text":"...","is_correct":true}],"sub_questions":[],"answer_keys":["A"],"hint":"...","explanation":"...","marks":1,"difficulty":"medium"}],"answer_keys":[],"hint":null,"explanation":null,"marks":null,"difficulty":"medium","tags":[],"figures":[]}

RULES
1. Always include correct answers for the type (answer_keys / is_correct / blanks / answer_text / answer_boolean / match_pairs).
2. Always include hint and explanation on answerable items (each sub_question for comprehension).
3. Math/chemistry/logic notation must use LaTeX: $...$ or $$...$$.
4. COMPREHENSION: when the source is comprehension (or you choose that type), you MUST set type to "comprehension", write a NEW non-empty "passage", and include one or more "sub_questions" based on that passage. Sub-question count may differ. Never return sub_questions alone without a passage. Passage reading level must fit the student standard.
5. Diagram questions: invent a new figure and describe it in figures[].description. When source images are attached, look at them and invent a different figure of the same kind. Do not copy the source image onto the new question.
6. Prefer the same broad type as the source when generating from a source question, unless the source type is unknown or broken.
7. Preserve learning intent (same concept family) while changing surface details.`;

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

async function callChat(options: {
  url: string;
  headers: Record<string, string>;
  model?: string | null;
  models?: string[];
  messages: { role: "system" | "user"; content: string | unknown[] }[];
  label: string;
}): Promise<string> {
  const response = await fetch(options.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(
      chatCompletionBody({
        model: options.model,
        models: options.models,
        messages: options.messages,
        maxTokens: 6000,
      }),
    ),
  });

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    let message = body;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
      message = parsed.error?.message ?? parsed.message ?? body;
    } catch {
      /* keep raw */
    }
    if (response.status === 429) {
      throw new Error(`${options.label} is busy or rate limited. Wait a moment and try again.`);
    }
    if (response.status === 401) {
      throw new Error(`${options.label} rejected the API key. Check the key in Settings.`);
    }
    if (response.status === 402 || response.status === 403) {
      throw new Error(`AI_CREDITS: ${message || `${options.label} has no credits left.`}`);
    }
    throw new Error(message || `${options.label} failed (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
        };
        text += chunk.choices?.[0]?.delta?.content ?? "";
      } catch {
        /* ignore keep-alive */
      }
    }
  }

  return text;
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

const LOVABLE_MOCK_MODEL = "google/gemini-3.8-flash";

async function executeMockGeneration(
  data: z.infer<typeof InputSchema>,
): Promise<{ question: Question; item: GenerationItem; questions_rev: number }> {
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
  if (data.mode === "from_source" && !data.sourceQuestion) {
    throw new Error("Source question is required for from_source generation.");
  }
  const sourceQuestion = data.mode === "from_source" ? asQuestion(data.sourceQuestion) : null;
  const jobId = data.jobId ?? data.documentId;
  const item =
    parseGenerationItem(data.item) ??
    emptyGenerationItem({
      jobId,
      sequence: data.index,
      sourceQuestionId: data.sourceQuestionId ?? sourceQuestion?.id ?? null,
    });

  async function completeChat(
    messages: { role: "system" | "user"; content: string | unknown[] }[],
  ): Promise<string> {
    const targets = generationChatTargets({
      omniroutersKey,
      openRouterKey,
      lovableKey,
      requestedModel: data.model,
      omniroutersModel: process.env["OMNIROUTERS_MODEL"],
      omniroutersBaseUrl: process.env["OMNIROUTERS_BASE_URL"],
      openRouterModel: DEFAULT_MOCK_MODEL,
      openRouterFallbacks: MOCK_MODEL_FALLBACKS,
      lovableModel: LOVABLE_MOCK_MODEL,
    });
    return completeChatWithFallback(
      targets,
      (target) =>
        callChat({
          url: target.url,
          headers: target.headers,
          model: target.model,
          ...(target.models ? { models: target.models } : {}),
          messages,
          label: target.label,
        }),
      "No AI key is configured for mock papers. Add OMNIROUTERS_API_KEY, OPENROUTER_API_KEY, or LOVABLE_API_KEY in .env.local (or Lovable project secrets), then restart the server.",
    );
  }

  let savedQuestions = Array.isArray(data.savedQuestions)
    ? (data.savedQuestions as Question[])
    : [];
  let generationState = parseMockGeneration(data.generation);
  let questionsRev = data.questions_rev;
  const authorInstructions =
    data.mode === "from_source"
      ? data.instructions?.trim() || generationState?.instructions?.trim() || null
      : null;

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
    instructions: data.mode === "from_instructions" ? (data.instructions ?? null) : null,
    authorInstructions,
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
    assetStore: createLocalImageAssetStore(),
    callGrammarModel: async (spec) => {
      const text = await completeChat([
        {
          role: "system",
          content: "You write original grammar questions. Return one JSON object and nothing else.",
        },
        { role: "user", content: buildGrammarUserPrompt(spec, authorInstructions) },
      ]);
      const parsed = extractJson(text);
      if (!parsed) throw new Error("The grammar model returned unreadable output. Try again.");
      return parsed;
    },
    callLegacyModel: async () => {
      let userContent: string;
      let sourceType: Question["type"] | null = null;
      let sourceDifficulty: Question["difficulty"] | null = null;
      const skill = detectSkill({
        stem: sourceQuestion?.stem,
        instructions: data.mode === "from_source" ? sourceQuestion?.instructions : data.instructions,
        type: sourceQuestion?.type,
        figureCount: sourceQuestion?.figures.length ?? 0,
        optionImageCount:
          sourceQuestion?.options.filter((option) => option.image_path).length ?? 0,
        optionTexts: sourceQuestion?.options.map((option) => option.text) ?? [],
        passage: sourceQuestion?.passage,
      });
      const grade = parseGradeFromStandardName(audience?.standard ?? null);
      const difficultyStep = generationState?.difficulty_step ?? 0;
      const plan = skillAuthorPlan({ skill, grade, difficultyStep, hasImages: false });
      const wantsImages = plan?.requiresImages === true || skillByType(skill)?.visual === true;
      const images = wantsImages && sourceQuestion ? await questionImages(sourceQuestion) : [];
      const skillNote =
        plan?.systemAddendum ??
        [skillAuthorPrompt(skill), skillDifficultyGuidance(skill, grade, difficultyStep)]
          .filter(Boolean)
          .join("\n");
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
        });
      } else {
        const instructions = data.instructions?.trim();
        if (!instructions)
          throw new Error("Instructions are required for from_instructions generation.");
        userContent = buildFromInstructionsUserPrompt({
          instructions,
          index: data.index,
          total: data.total,
          previousStems: data.previousStems ?? [],
          ...(audience ? { audience } : {}),
        });
      }
      const authorBlock = authorInstructions
        ? `\n\nADDITIONAL INSTRUCTIONS (must follow for this question):\n${authorInstructions}`
        : "";
      const chat = await completeExamChat({
        messages: [
          {
            role: "system",
            content: `${skillNote ? `${SYSTEM_PROMPT}\n\n${skillNote}` : SYSTEM_PROMPT}${authorBlock}`,
          },
          { role: "user", content: userContent },
        ],
        images,
        searchQuery: buildSearchQuery({
          stem: sourceQuestion?.stem ?? data.instructions,
          subject: audience?.subject,
          exam: audience?.exam,
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
      });
      if (!chat.accepted) {
        throw new Error("The mock model did not return a usable question stem. Try again.");
      }
      const parsed = extractJson(chat.text);
      if (!parsed) throw new Error("The mock model returned unreadable output. Try again.");
      const question = finalizeMockQuestion(parsed, {
        number,
        sourceQuestionId: data.sourceQuestionId ?? null,
        generationJobId: jobId,
        sourceType,
        sourceDifficulty,
        ...(data.catalog
          ? {
              catalog: {
                subject_id: data.catalog.subject_id ?? null,
                topic_id: data.catalog.topic_id ?? null,
                standard_id: data.catalog.standard_id ?? null,
                stream_id: data.catalog.stream_id ?? null,
              },
            }
          : {}),
      });
      if (!question.stem.trim() && !question.passage?.trim() && !question.assertion?.trim()) {
        throw new Error("The mock model did not return a usable question stem. Try again.");
      }
      assertMockQuestionComplete(question, sourceType);
      return question;
    },
    describeSourceFigure: async () => {
      const figure = sourceQuestion?.figures.find((entry) => entry.image_path);
      if (!figure?.image_path) return null;
      const dataUrl = await readLocalImageDataUrl(figure.image_path);
      if (!dataUrl || (!omniroutersKey && !openRouterKey && !lovableKey)) return null;
      try {
        const text = await completeChat([
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
        ]);
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
      const saved = await updateDocument(data.documentId, {
        questions: savedQuestions,
        generation: generationState,
        questions_rev: questionsRev,
      });
      if (saved) questionsRev = saved.questions_rev;
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
      questions_rev: loaded.document.questions_rev,
      audience: {
        exam: loaded.document.exam,
        notes: loaded.document.notes,
      },
    });

    const questions = loaded.questions.map((entry) =>
      entry.id === current.id ? generated.question : entry,
    );
    const nextGeneration: MockGenerationState = {
      ...generation,
      job_id: jobId,
      pairs: generation.pairs.map((pair) =>
        pair.mock_question_id === current.id
          ? { ...pair, mock_question_id: generated.question.id }
          : pair,
      ),
      items: (generation.items ?? []).map((entry) =>
        entry.candidate_question_id === current.id ? generated.item : entry,
      ),
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
