import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { structureOcrText } from "@/lib/ocr-structure";
import { normalizeQuestion, type Question } from "@/lib/question-schema";

export const READER_ENGINES = ["lovable", "openrouter", "vision", "optiic"] as const;
export type ReaderEngine = (typeof READER_ENGINES)[number];

export const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash";

const InputSchema = z.object({
  /** Full data URL of the page image, e.g. data:image/jpeg;base64,... */
  imageDataUrl: z.string().min(32),
  /** Zero-based index of the page inside the upload set. */
  page: z.number().int().min(0),
  /** Optional user hint, e.g. "CBSE class 10 maths, answers are printed at the end". */
  hint: z.string().max(600).optional(),
  /** Which reading engine to use. */
  engine: z.enum(READER_ENGINES).default("lovable"),
  /** Model id, only used by the OpenRouter engine. */
  model: z.string().min(2).max(120).optional(),
});

const SYSTEM_PROMPT = `You are an exam-paper digitiser. You read a scanned or photographed page of a question paper, practice test or intelligence test and return it as structured JSON.

RULES
1. Transcribe faithfully. Never invent questions, options or answers that are not printed on the page.
2. Mathematics, chemistry and logic notation MUST be LaTeX: inline as $...$ and display as $$...$$. Example: "Solve $x^2 - 5x + 6 = 0$". Never describe an equation in words when it is printed as notation.
3. Figures, shapes, matrices-as-pictures, graphs, circuit diagrams, pattern/sequence puzzles: add an entry to "figures" with a precise "description" a person could redraw from, and a "bbox" as [x, y, width, height] normalised 0..1 relative to the whole page, tightly around the figure.
4. Classify each question's "type" as exactly one of: mcq, multi_select, true_false, fill_blank, assertion_reason, comprehension, match_the_following, short_answer, long_answer, numerical, diagram, unknown.
   - mcq: one correct option. multi_select: more than one correct option.
   - fill_blank: put one entry in "blanks" for every blank, in order (empty string if the answer is not printed). Keep the blank in the stem as "____".
   - assertion_reason: put the assertion in "assertion", the reason in "reason", and the standard option set in "options".
   - comprehension: put the shared passage/case study in "passage" and every child question in "sub_questions".
   - match_the_following: put every printed pairing in "match_pairs" (left column item and its right column item; if the correct pairing is not printed, still list the left items with an empty right).
   - diagram: the question cannot be answered without the figure (typical for intelligence/aptitude tests).
5. Only fill "answer_keys", "answer_text", "answer_boolean" or "explanation" when the page actually prints the answer or solution.
6. Carry over "number", "marks", "section" and "instructions" exactly as printed. Set "confidence" between 0 and 1 for how sure you are of the transcription.
7. If a question is cut off at the page edge, still return what is visible and lower "confidence".
8. Return ONLY JSON. No prose, no markdown fences.

OUTPUT SHAPE
{"questions":[{"number":"12","type":"mcq","stem":"...","instructions":null,"passage":null,"assertion":null,"reason":null,"options":[{"key":"A","text":"...","is_correct":false}],"blanks":[],"match_pairs":[],"sub_questions":[],"answer_keys":[],"answer_text":null,"answer_boolean":null,"explanation":null,"marks":1,"section":"A","difficulty":null,"tags":[],"figures":[{"description":"...","caption":null,"bbox":[0.1,0.2,0.3,0.2]}],"confidence":0.95}]}`;

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

type ChatMessage = {
  role: "system" | "user";
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
};

/** Streamed chat completion, consumed server-side so long pages don't hit request timeouts. */
async function callChat(options: {
  url: string;
  headers: Record<string, string>;
  model: string;
  messages: ChatMessage[];
  label: string;
  maxTokens?: number;
}): Promise<string> {
  const response = await fetch(options.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify({
      model: options.model,
      stream: true,
      // Keep OpenRouter requests below the free account's affordable ceiling.
      max_tokens: options.maxTokens ?? 12000,
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
      /* keep raw body */
    }
    if (response.status === 429) {
      throw new Error(`${options.label} is busy or rate limited right now. Wait a moment and try this page again.`);
    }
    if (response.status === 401) {
      throw new Error(`${options.label} rejected the saved API key. Check the key in Settings.`);
    }
    if (response.status === 402 || response.status === 403) {
      throw new Error(
        `AI_CREDITS: ${message || `${options.label} has no credits left. Add credits or switch reader in Settings.`}`,
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
        /* ignore keep-alive / partial frames */
      }
    }
  }

  return text;
}

function visionMessages(imageDataUrl: string, hint?: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: hint ? `Digitise this page. Context from the user: ${hint}` : "Digitise this page.",
        },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

/** Shared prompt used after a plain-text OCR engine (Vision / Optiic) returns raw text. */
function structureTextMessages(pageText: string, hint?: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Below is the raw OCR text of one page, in reading order. Structure it using the rules above. It contains no figures, so leave "figures" empty unless the text clearly refers to a printed figure.${
        hint ? `\nContext from the user: ${hint}` : ""
      }\n\n---\n${pageText}`,
    },
  ];
}

/** Google Cloud Vision only returns text, so its output is structured by a language model afterwards. */
async function googleVisionText(apiKey: string, imageDataUrl: string): Promise<string> {
  const base64 = imageDataUrl.includes(",") ? imageDataUrl.split(",")[1]! : imageDataUrl;
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: { languageHints: ["en"] },
          },
        ],
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    responses?: { error?: { message?: string }; fullTextAnnotation?: { text?: string } }[];
  } | null;

  const errorMessage = payload?.error?.message ?? payload?.responses?.[0]?.error?.message;
  if (!response.ok || errorMessage) {
    throw new Error(errorMessage || `Google Cloud Vision failed (${response.status}).`);
  }

  const text = payload?.responses?.[0]?.fullTextAnnotation?.text ?? "";
  if (!text.trim()) throw new Error("Google Cloud Vision found no text on this page.");
  return text;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
  const mimeMatch = dataUrl.match(/^data:([^;]+);/);
  const type = mimeMatch?.[1] ?? "image/jpeg";
  return new Blob([Buffer.from(base64, "base64")], { type });
}

/** Optiic only returns plain text, so its output is structured by a language model afterwards. */
async function optiicText(apiKey: string, imageDataUrl: string): Promise<string> {
  const blob = dataUrlToBlob(imageDataUrl);
  const formData = new FormData();
  formData.append("image", blob, "page.jpg");
  formData.append("mode", "ocr");

  const response = await fetch("https://api.optiic.dev/process", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  // Optiic returns JSON on success but a plain-text sentence for quota / auth errors.
  const body = await response.text();
  type OptiicPayload = { text?: string; error?: { message?: string }; message?: string };
  let payload: OptiicPayload | null = null;
  try {
    payload = JSON.parse(body) as OptiicPayload;
  } catch {
    /* plain-text response */
  }

  if (!response.ok) {
    const detail = (payload?.error?.message ?? payload?.message ?? body).trim().slice(0, 300);
    if (response.status === 429) {
      throw new Error(
        detail || "Optiic has hit its usage limit for now. Wait and try again, or switch reader in Settings.",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("Optiic rejected the saved API key. Check the key in Settings.");
    }
    throw new Error(detail || `Optiic failed (${response.status}).`);
  }

  const text = payload?.text ?? "";
  if (!text.trim()) throw new Error("Optiic found no text on this page.");
  return text;
}

export const extractPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: Question[]; raw: string }> => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const openRouterKey = process.env["OPENROUTER_API_KEY"];
    const visionKey = process.env["GOOGLE_CLOUD_VISION_API_KEY"];
    const optiicKey = process.env["OPTIIC_API_KEY"];

    const openRouter = (messages: ChatMessage[]) =>
      callChat({
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: { Authorization: `Bearer ${openRouterKey}` },
        model: data.model?.trim() || DEFAULT_OPENROUTER_MODEL,
        messages,
        label: "OpenRouter",
        maxTokens: 2000,
      });

    const lovable = (messages: ChatMessage[]) =>
      callChat({
        url: "https://ai.gateway.lovable.dev/v1/chat/completions",
        headers: { "Lovable-API-Key": lovableKey ?? "", "X-Lovable-AIG-SDK": "fetch" },
        model: "google/gemini-3.8-flash",
        messages,
        label: "The built-in AI reader",
      });

    /**
     * Plain-text OCR engines need a language model to organise their text. When no model is
     * reachable (missing key or no credits) we fall back to offline structuring so the page
     * still comes back as reviewable questions.
     */
    async function structurePlainText(pageText: string): Promise<{ text: string } | { questions: Question[] }> {
      const messages = structureTextMessages(pageText, data.hint);
      try {
        if (openRouterKey) return { text: await openRouter(messages) };
        if (lovableKey) return { text: await lovable(messages) };
      } catch (error) {
        if (lovableKey && openRouterKey) {
          try {
            return { text: await lovable(messages) };
          } catch {
            /* fall through to offline structuring */
          }
        }
        if (!(error instanceof Error)) throw error;
      }
      return { questions: structureOcrText(pageText, data.page) };
    }

    let text: string;

    if (data.engine === "openrouter") {
      if (!openRouterKey) {
        throw new Error("No OpenRouter API key is saved yet. Add it in Settings, then try again.");
      }
      text = await openRouter(visionMessages(data.imageDataUrl, data.hint));
    } else if (data.engine === "vision" || data.engine === "optiic") {
      const pageText =
        data.engine === "vision"
          ? await (async () => {
              if (!visionKey) {
                throw new Error(
                  "No Google Cloud Vision API key is saved yet. Add it in Settings, then try again.",
                );
              }
              return googleVisionText(visionKey, data.imageDataUrl);
            })()
          : await (async () => {
              if (!optiicKey) {
                throw new Error("No Optiic API key is saved yet. Add it in Settings, then try again.");
              }
              return optiicText(optiicKey, data.imageDataUrl);
            })();

      const structured = await structurePlainText(pageText);
      if ("questions" in structured) return { questions: structured.questions, raw: "" };
      text = structured.text;
    } else {
      if (!lovableKey) throw new Error("AI is not configured for this project.");
      text = await lovable(visionMessages(data.imageDataUrl, data.hint));
    }

    const parsed = extractJson(text) as { questions?: unknown[] } | null;
    const list = Array.isArray(parsed?.questions) ? parsed.questions : [];

    return {
      questions: list.map((q) => normalizeQuestion(q, data.page)),
      raw: list.length ? "" : text.slice(0, 2000),
    };
  });

/** Reports which reader keys are configured, without ever revealing their values. */
export const getReaderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async (): Promise<{ lovable: boolean; openrouter: boolean; vision: boolean; optiic: boolean }> => ({
      lovable: !!process.env["LOVABLE_API_KEY"],
      openrouter: !!process.env["OPENROUTER_API_KEY"],
      vision: !!process.env["GOOGLE_CLOUD_VISION_API_KEY"],
      optiic: !!process.env["OPTIIC_API_KEY"],
    }),
  );
