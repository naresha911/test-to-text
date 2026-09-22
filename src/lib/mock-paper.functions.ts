import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  assertMockQuestionComplete,
  buildFromInstructionsUserPrompt,
  buildFromSourceUserPrompt,
  finalizeMockQuestion,
  type MockPaperAudience,
} from "@/lib/mock-paper";
import { emptyQuestion, type Question } from "@/lib/question-schema";

/** Prefer free OpenRouter routes; models[] lets OpenRouter fall back if one is down. */
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
    match_pairs: z
      .array(z.object({ left: z.string(), right: z.string() }))
      .default([]),
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
});

const SYSTEM_PROMPT = `You are an expert exam-paper author creating ORIGINAL mock questions for students.

GOALS
- Transform the skill, pattern, and difficulty of the source (or follow teacher instructions).
- Respect student STANDARD / grade, SOURCE difficulty, learning INTENT, and other metadata in the prompt.
- Avoid copyright infringement: never copy distinctive wording, passages, numbers, or option text — invent new ones.
- If the source is OCR-damaged or incomplete, infer the intended skill and invent a correct new question at an appropriate level.

LEVELING
- Aim questions at the student's stated standard (e.g. Class 6).
- You MAY stretch slightly harder — at most about +2 grades (Class 6 → up to ~Class 8) when the source is hard or stretch is useful for practice.
- Never jump far above that band (no Class 11 methods for a Class 6 paper).
- Mirror source difficulty (easy/medium/hard) unless leveling rules say otherwise. Always set output "difficulty".

OUTPUT
- Return ONLY one JSON object (no markdown fences, no prose).
- Shape matches the app Question schema.
- Example for a normal MCQ:
  {"number":"1","type":"mcq","stem":"...","passage":null,"options":[{"key":"A","text":"...","is_correct":true}],"sub_questions":[],"answer_keys":["A"],"hint":"...","explanation":"...","marks":1,"difficulty":"medium","tags":[],"figures":[]}
- Example for comprehension (passage is REQUIRED — never omit):
  {"number":"3","type":"comprehension","stem":"Read the passage and answer the questions.","passage":"A full original multi-sentence passage invented by you...","options":[],"sub_questions":[{"number":"3.1","type":"mcq","stem":"...","options":[{"key":"A","text":"...","is_correct":true}],"sub_questions":[],"answer_keys":["A"],"hint":"...","explanation":"...","marks":1,"difficulty":"medium"}],"answer_keys":[],"hint":null,"explanation":null,"marks":null,"difficulty":"medium","tags":[],"figures":[]}

RULES
1. Always include correct answers for the type (answer_keys / is_correct / blanks / answer_text / answer_boolean / match_pairs).
2. Always include hint and explanation on answerable items (each sub_question for comprehension).
3. Math/chemistry/logic notation must use LaTeX: $...$ or $$...$$.
4. COMPREHENSION: when the source is comprehension (or you choose that type), you MUST set type to "comprehension", write a NEW non-empty "passage", and include one or more "sub_questions" based on that passage. Sub-question count may differ. Never return sub_questions alone without a passage. Passage reading level must fit the student standard.
5. Diagram questions: invent a new figure; put all visual detail in figures[].description (no image bytes).
6. Prefer the same broad type as the source when generating from a source question, unless the source type is unknown or broken.
7. Preserve learning intent (same concept family) while changing surface details.`;

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
  model: string;
  models?: string[];
  messages: { role: "system" | "user"; content: string }[];
  label: string;
}): Promise<string> {
  const response = await fetch(options.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify({
      model: options.model,
      ...(options.models?.length ? { models: options.models } : {}),
      stream: true,
      max_tokens: 6000,
      messages: options.messages,
    }),
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
    tags: Array.isArray(r["tags"]) ? r["tags"].filter((t): t is string => typeof t === "string") : [],
    figures: Array.isArray(r["figures"])
      ? r["figures"].map((f) => {
          const ff = (f ?? {}) as Record<string, unknown>;
          return {
            description: typeof ff["description"] === "string" ? ff["description"] : "",
            caption: typeof ff["caption"] === "string" ? ff["caption"] : null,
          };
        })
      : [],
    page: typeof r["page"] === "number" ? r["page"] : null,
    confidence: typeof r["confidence"] === "number" ? r["confidence"] : null,
    approved: r["approved"] === true,
    sub_questions: subRaw.map((sub) => asQuestion(sub)),
  });
}

export const generateMockQuestion = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<Question> => {
    const openRouterKey = process.env["OPENROUTER_API_KEY"];
    const lovableKey = process.env["LOVABLE_API_KEY"];
    if (!openRouterKey && !lovableKey) {
      throw new Error(
        "No AI key is configured for mock papers. Add OPENROUTER_API_KEY or LOVABLE_API_KEY in .env.local (or Lovable project secrets), then restart the server.",
      );
    }

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
    let userContent: string;
    let sourceType: Question["type"] | null = null;
    let sourceDifficulty: Question["difficulty"] | null = null;

    if (data.mode === "from_source") {
      if (!data.sourceQuestion) {
        throw new Error("Source question is required for from_source generation.");
      }
      const sourceQuestion = asQuestion(data.sourceQuestion);
      sourceType = sourceQuestion.type;
      sourceDifficulty = sourceQuestion.difficulty ?? null;
      // Prefer question-level difficulty over paper-level when both exist.
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
      });
    } else {
      const instructions = data.instructions?.trim();
      if (!instructions) {
        throw new Error("Instructions are required for from_instructions generation.");
      }
      userContent = buildFromInstructionsUserPrompt({
        instructions,
        index: data.index,
        total: data.total,
        previousStems: data.previousStems ?? [],
        ...(audience ? { audience } : {}),
      });
    }

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: userContent },
    ];

    async function viaOpenRouter(): Promise<string> {
      const model = data.model?.trim() || DEFAULT_MOCK_MODEL;
      const models = [
        model,
        ...MOCK_MODEL_FALLBACKS.filter((candidate) => candidate !== model),
      ];
      return callChat({
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: { Authorization: `Bearer ${openRouterKey}` },
        model,
        models,
        messages,
        label: "OpenRouter",
      });
    }

    async function viaLovable(): Promise<string> {
      return callChat({
        url: "https://ai.gateway.lovable.dev/v1/chat/completions",
        headers: {
          "Lovable-API-Key": lovableKey ?? "",
          "X-Lovable-AIG-SDK": "fetch",
        },
        model: "google/gemini-3.8-flash",
        messages,
        label: "The built-in AI reader",
      });
    }

    let text: string;
    if (openRouterKey) {
      try {
        text = await viaOpenRouter();
      } catch (openRouterError) {
        if (lovableKey) {
          try {
            text = await viaLovable();
          } catch (lovableError) {
            const openRouterMessage =
              openRouterError instanceof Error
                ? openRouterError.message
                : String(openRouterError);
            const lovableMessage =
              lovableError instanceof Error ? lovableError.message : String(lovableError);
            throw new Error(
              `OpenRouter failed (${openRouterMessage}). Lovable fallback also failed: ${lovableMessage}`,
            );
          }
        } else {
          throw openRouterError;
        }
      }
    } else {
      text = await viaLovable();
    }

    const parsed = extractJson(text);
    if (!parsed) {
      throw new Error("The mock model returned unreadable output. Try again.");
    }

    const question = finalizeMockQuestion(parsed, {
      number,
      sourceQuestionId: data.sourceQuestionId ?? null,
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
  });
