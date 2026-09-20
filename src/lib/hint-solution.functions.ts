import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildQuestionPromptPayload,
  type SolutionAudience,
} from "@/lib/question-context";
import { type HintSolutionResult } from "@/lib/hint-solution";
import { emptyQuestion, type Question } from "@/lib/question-schema";

/** Prefer free OpenRouter routes; models[] lets OpenRouter fall back if one is down. */
export const DEFAULT_SOLUTION_MODEL = "google/gemma-4-26b-a4b-it:free";
export const SOLUTION_MODEL_FALLBACKS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
] as const;

const OptionSchema = z.object({
  key: z.string(),
  text: z.string(),
  is_correct: z.boolean().nullable().optional(),
});

const QuestionInputSchema = z.object({
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
  sub_questions: z.array(z.unknown()).default([]),
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
});

const InputSchema = z.object({
  question: QuestionInputSchema,
  parentPassage: z.string().max(20000).nullable().optional(),
  /** When true, overwrite existing hint and explanation. */
  force: z.boolean().optional().default(false),
  audience: z
    .object({
      subject: z.string().max(200).nullable().optional(),
      exam: z.string().max(200).nullable().optional(),
      notes: z.string().max(600).nullable().optional(),
    })
    .optional(),
  model: z.string().min(2).max(120).optional(),
});

const SYSTEM_PROMPT = `You are an expert exam tutor. Given one structured question (already reviewed by a human), you write a learner hint and a full solution.

RULES
1. HINT: a short nudge only. Point toward the method or a key idea. NEVER state the final answer, correct option letter, numeric result, or true/false value.
2. EXPLANATION (solution): a full worked solution with clear reasoning suited to the exam audience (school / board / competitive as indicated). Use step-by-step language a student can follow. End with the final answer clearly labelled.
3. Mathematics, chemistry and logic notation MUST be LaTeX: inline $...$ and display $$...$$.
4. Use every relevant context provided (passage for comprehension, assertion/reason, options, figure descriptions, match columns). Do not invent a different question.
5. Fill missing answer fields when you can determine them:
   - MCQ / multi_select: answer_keys (option keys) and options[].is_correct
   - true_false: answer_boolean
   - fill_blank: blanks[] in order
   - short_answer / long_answer / numerical: answer_text
   - match_the_following: match_pairs with completed right sides when solvable
6. If the stem or options look OCR-garbled, still solve the intended question from context, but do NOT return a rewritten stem — the human editor owns the text.
7. Return ONLY JSON. No prose, no markdown fences.

OUTPUT SHAPE
{"hint":"...","explanation":"...","answer_keys":["A"],"answer_text":null,"answer_boolean":null,"options":[{"key":"A","text":"...","is_correct":true}],"blanks":[],"match_pairs":[{"left":"...","right":"..."}]}`;

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
      max_tokens: 4000,
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
      throw new Error(
        `AI_CREDITS: ${message || `${options.label} has no credits left.`}`,
      );
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

function asQuestion(raw: z.infer<typeof QuestionInputSchema>): Question {
  return emptyQuestion({
    id: raw.id,
    number: raw.number,
    type: raw.type as Question["type"],
    stem: raw.stem,
    instructions: raw.instructions ?? null,
    passage: raw.passage ?? null,
    assertion: raw.assertion ?? null,
    reason: raw.reason ?? null,
    options: (raw.options ?? []).map((option) => ({
      key: option.key,
      text: option.text,
      is_correct: option.is_correct ?? null,
    })),
    blanks: raw.blanks ?? [],
    match_pairs: raw.match_pairs ?? [],
    answer_keys: raw.answer_keys ?? [],
    answer_text: raw.answer_text ?? null,
    answer_boolean: raw.answer_boolean ?? null,
    hint: raw.hint ?? null,
    explanation: raw.explanation ?? null,
    marks: raw.marks ?? null,
    section: raw.section ?? null,
    difficulty: raw.difficulty ?? null,
    tags: raw.tags ?? [],
    page: raw.page ?? null,
    confidence: raw.confidence ?? null,
    approved: raw.approved === true,
    figures: (raw.figures ?? []).map((f) => ({
      description: f.description,
      caption: f.caption ?? null,
    })),
    sub_questions: [],
  });
}

function parseResult(raw: unknown, source: Question): HintSolutionResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);

  const options = arr(r["options"]).map((o, i) => {
    const oo = (o ?? {}) as Record<string, unknown>;
    const fallback = source.options[i];
    return {
      key: str(oo["key"]) ?? fallback?.key ?? String.fromCharCode(65 + i),
      text: str(oo["text"]) ?? fallback?.text ?? "",
      is_correct:
        typeof oo["is_correct"] === "boolean"
          ? (oo["is_correct"] as boolean)
          : (fallback?.is_correct ?? null),
    };
  });

  return {
    hint: str(r["hint"]),
    explanation: str(r["explanation"]),
    answer_keys: arr(r["answer_keys"]).filter((k): k is string => typeof k === "string"),
    answer_text: str(r["answer_text"]),
    answer_boolean:
      typeof r["answer_boolean"] === "boolean" ? (r["answer_boolean"] as boolean) : null,
    options: options.length ? options : source.options.map((o) => ({ ...o, is_correct: o.is_correct ?? null })),
    blanks: arr(r["blanks"]).map((b) => (typeof b === "string" ? b : "")),
    match_pairs: arr(r["match_pairs"]).map((p, i) => {
      const pp = (p ?? {}) as Record<string, unknown>;
      const fallback = source.match_pairs[i];
      return {
        left: str(pp["left"]) ?? fallback?.left ?? "",
        right: str(pp["right"]) ?? fallback?.right ?? "",
      };
    }),
  };
}

export const generateHintSolution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<HintSolutionResult> => {
    const openRouterKey = process.env["OPENROUTER_API_KEY"];
    const lovableKey = process.env["LOVABLE_API_KEY"];
    if (!openRouterKey && !lovableKey) {
      throw new Error(
        "No AI key is configured for hints and solutions. Add OPENROUTER_API_KEY or LOVABLE_API_KEY in .env.local (or Lovable project secrets), then restart the server.",
      );
    }

    const question = asQuestion(data.question);
    if (!data.force && question.hint?.trim() && question.explanation?.trim()) {
      return {
        hint: question.hint,
        explanation: question.explanation,
        answer_keys: question.answer_keys,
        answer_text: question.answer_text ?? null,
        answer_boolean: question.answer_boolean ?? null,
        options: question.options.map((o) => ({
          key: o.key,
          text: o.text,
          is_correct: o.is_correct ?? null,
        })),
        blanks: question.blanks,
        match_pairs: question.match_pairs,
      };
    }

    const audience: SolutionAudience | undefined = data.audience
      ? {
          subject: data.audience.subject ?? null,
          exam: data.audience.exam ?? null,
          notes: data.audience.notes ?? null,
        }
      : undefined;
    const payload = buildQuestionPromptPayload(question, {
      parentPassage: data.parentPassage ?? null,
      ...(audience ? { audience } : {}),
    });

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: `${data.force ? "Regenerate" : "Generate"} hint and solution for this question.\n\n${payload}`,
      },
    ];

    async function viaOpenRouter(): Promise<string> {
      const model = data.model?.trim() || DEFAULT_SOLUTION_MODEL;
      const models = [
        model,
        ...SOLUTION_MODEL_FALLBACKS.filter((candidate) => candidate !== model),
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

    // Prefer OpenRouter free models when that key exists; otherwise use Lovable.
    let text: string;
    if (openRouterKey) {
      try {
        text = await viaOpenRouter();
      } catch (error) {
        if (lovableKey) {
          try {
            text = await viaLovable();
          } catch {
            throw error;
          }
        } else {
          throw error;
        }
      }
    } else {
      text = await viaLovable();
    }

    const parsed = extractJson(text);
    if (!parsed) {
      throw new Error("The solution model returned unreadable output. Try again.");
    }
    const result = parseResult(parsed, question);
    if (!result.hint && !result.explanation) {
      throw new Error("The solution model did not return a hint or solution. Try again.");
    }
    return result;
  });
