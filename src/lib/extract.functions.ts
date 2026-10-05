import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  chatCompletionBody,
  commandCodeApiKey,
  completeChatWithFallback,
  generationChatTargets,
  omniroutersApiKey,
} from "@/lib/generation/chat-provider";
import { COMMAND_CODE_VISION_MODELS } from "@/lib/generation/vision-models";
import { structureOcrText as structureOcrTextOffline } from "@/lib/ocr-structure";
import { normalizeQuestion, type Question } from "@/lib/question-schema";
import { openOcrHealthy } from "@/lib/reader/openocr";
import { attachFigures } from "@/lib/reader/parse-blocks";
import { stripFigures } from "@/lib/reading/clean-page";
import { CROP_LAYOUTS, oneCropQuestion, structureCropText } from "@/lib/reading/crop-layout";
import { readLayoutRegions } from "@/lib/reading/layout-reader";
import { inlineStackedFractions } from "@/lib/reading/math-text";
import { CONTENT_MODES } from "@/lib/reading/mode";
import { readExamPage } from "@/lib/reading/pipeline";
import { ocrSpaceText, optiicText, readPrintedText } from "@/lib/reading/text-reader";

export const READER_ENGINES = ["openocr", "lovable", "openrouter", "optiic", "ocrspace"] as const;
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
  engine: z.enum(READER_ENGINES).default("openocr"),
  /** Optional reader key supplied by the browser for self-hosted/local use. */
  apiKey: z.string().max(1000).optional(),
  /** Browser OCR.space key used when OpenOCR falls back to that service. */
  ocrSpaceKey: z.string().max(1000).optional(),
  /** Browser Optiic key used when OpenOCR falls back to that service. */
  optiicKey: z.string().max(1000).optional(),
  /** Model id, only used by the OpenRouter engine. */
  model: z.string().min(2).max(120).optional(),
  /** Text or Graphics for this Read pages click. Text never crops figures. */
  contentMode: z.enum(CONTENT_MODES).default("text"),
});

const StructureInputSchema = z.object({
  text: z.string().min(1).max(1_000_000),
  page: z.number().int().min(0),
  hint: z.string().max(600).optional(),
  model: z.string().min(2).max(120).optional(),
  apiKey: z.string().max(1000).optional(),
});

const SYSTEM_PROMPT = `You are an exam-paper digitiser. You read a scanned or photographed page of a question paper, practice test or intelligence test and return it as structured JSON.

RULES
1. Transcribe faithfully. Never invent questions, options or answers that are not printed on the page.
2. Mathematics, chemistry and logic notation MUST be LaTeX: inline as $...$ and display as $$...$$. Example: "Solve $x^2 - 5x + 6 = 0$". Never describe an equation in words when it is printed as notation.
   - Stacked fraction: $\\frac{2}{3}$. Mixed number: $2\\frac{1}{3}$ (the whole number sits beside the fraction).
   - Operators are \\times and \\div.
   - Degree: $90^{\\circ}$. Square unit: $3600\\text{ cm}^{2}$.
   - A percent in a sentence stays 25%. A percent inside a formula is $25\\%$.
   Never write 2 1/3, cm2, or a bare number when the page prints a degree or a superscript.
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

function questionsFromText(text: string, page: number): Question[] {
  const parsed = extractJson(text) as { questions?: unknown[] } | null;
  const list = Array.isArray(parsed?.questions) ? parsed.questions : [];
  return list.map((q) => normalizeQuestion(q, page));
}

/** Prefer model JSON, then the numbered-question splitter on the original OCR text. */
function resolvedQuestions(
  structured: { text: string } | { questions: Question[] },
  pageText: string,
  page: number,
): { questions: Question[]; raw: string } {
  if (!("questions" in structured)) {
    const parsed = questionsFromText(structured.text, page);
    if (parsed.length) return { questions: parsed, raw: "" };
  } else if (structured.questions.length) {
    return { questions: structured.questions, raw: "" };
  }

  const offline = structureOcrTextOffline(pageText, page);
  return { questions: offline, raw: offline.length ? "" : pageText.slice(0, 2000) };
}

/** Structure plain-text OCR output. OmniRouters first, then OpenRouter, then the built-in reader. */
async function structurePlainText(
  pageText: string,
  options: {
    page: number;
    hint?: string | undefined;
    omniroutersKey?: string | undefined;
    openRouterKey?: string | undefined;
    lovableKey?: string | undefined;
    model?: string | undefined;
  },
): Promise<{ text: string } | { questions: Question[] }> {
  const messages = structureTextMessages(pageText, options.hint);
  const targets = generationChatTargets({
    omniroutersKey: options.omniroutersKey,
    openRouterKey: options.openRouterKey,
    lovableKey: options.lovableKey,
    commandCodeKey: commandCodeApiKey(),
    commandCodeBaseUrl: process.env["COMMANDCODE_BASE_URL"],
    requestedModel: options.model,
    omniroutersModel: process.env["OMNIROUTERS_MODEL"],
    omniroutersBaseUrl: process.env["OMNIROUTERS_BASE_URL"],
    openRouterModel: options.model?.trim() || DEFAULT_OPENROUTER_MODEL,
    openRouterFallbacks: [],
    lovableModel: "google/gemini-3.8-flash",
  });
  if (targets.length === 0) {
    return { questions: structureOcrTextOffline(pageText, options.page) };
  }
  try {
    const text = await completeChatWithFallback(
      targets,
      (target) =>
        callChat({
          url: target.url,
          headers: target.headers,
          model: target.model,
          ...(target.models ? { models: target.models } : {}),
          messages,
          label: target.label,
          maxTokens: 12000,
        }),
      "No AI key is configured to clean up OCR text.",
    );
    return { text };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
  return { questions: structureOcrTextOffline(pageText, options.page) };
}

/** Read the page image when plain OCR has already dropped fraction bars. */
async function digitisePageImage(
  imageDataUrl: string,
  options: {
    page: number;
    hint?: string | undefined;
    omniroutersKey?: string | undefined;
    openRouterKey?: string | undefined;
    lovableKey?: string | undefined;
    model?: string | undefined;
  },
): Promise<Question[] | null> {
  const omniroutersModel = process.env["OMNIROUTERS_MODEL"];
  const omniroutersBaseUrl = process.env["OMNIROUTERS_BASE_URL"];
  const targets = generationChatTargets({
    openRouterModel: options.model?.trim() || DEFAULT_OPENROUTER_MODEL,
    openRouterFallbacks: [],
    lovableModel: "google/gemini-3.8-flash",
    commandCodeKey: commandCodeApiKey(),
    commandCodeBaseUrl: process.env["COMMANDCODE_BASE_URL"],
    commandCodeModels: COMMAND_CODE_VISION_MODELS,
    ...(options.omniroutersKey ? { omniroutersKey: options.omniroutersKey } : {}),
    ...(options.openRouterKey ? { openRouterKey: options.openRouterKey } : {}),
    ...(options.lovableKey ? { lovableKey: options.lovableKey } : {}),
    ...(options.model ? { requestedModel: options.model } : {}),
    ...(omniroutersModel ? { omniroutersModel } : {}),
    ...(omniroutersBaseUrl ? { omniroutersBaseUrl } : {}),
  });
  if (targets.length === 0) return null;
  const text = await completeChatWithFallback(
    targets,
    (target) =>
      callChat({
        url: target.url,
        headers: target.headers,
        model: target.model,
        ...(target.models ? { models: target.models } : {}),
        messages: visionMessages(imageDataUrl, options.hint),
        label: target.label,
        maxTokens: 12000,
      }),
    "No AI key is configured to read this page.",
  );
  const questions = questionsFromText(text, options.page);
  return questions.length ? questions : null;
}

type ChatMessage = {
  role: "system" | "user";
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
};

/** Streamed chat completion, consumed server-side so long pages don't hit request timeouts. */
async function callChat(options: {
  url: string;
  headers: Record<string, string>;
  model?: string | null;
  models?: string[];
  messages: ChatMessage[];
  label: string;
  maxTokens?: number;
}): Promise<string> {
  const response = await fetch(options.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify(
      chatCompletionBody({
        model: options.model,
        models: options.models,
        messages: options.messages,
        maxTokens: options.maxTokens ?? 12000,
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
      /* keep raw body */
    }
    if (response.status === 429) {
      throw new Error(
        `${options.label} is busy or rate limited right now. Wait a moment and try this page again.`,
      );
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

/** Shared prompt used after a plain-text OCR engine (OCR.space / Optiic) returns raw text. */
function structureTextMessages(pageText: string, hint?: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Below is the raw OCR text of one page, in reading order. Structure it using the rules above. Leave "figures" empty. Do not estimate coordinates, and do not describe how a figure should be drawn. If several numbered questions share one passage, case, or directions, return one comprehension question: put the shared text in "passage" and each numbered item in "sub_questions" with its own options. Do not copy the passage into every stem, and do not invent a separate question for the passage itself.${
        hint ? `\nContext from the user: ${hint}` : ""
      }\n\n---\n${pageText}`,
    },
  ];
}

export const extractPage = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: Question[]; raw: string }> => {
    const omniroutersKey = omniroutersApiKey();
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const openRouterKey = process.env["OPENROUTER_API_KEY"];
    const optiicKey = process.env["OPTIIC_API_KEY"];
    const ocrSpaceKey = process.env["OCR_SPACE_API_KEY"];
    const suppliedApiKey = data.apiKey?.trim();
    const suppliedOcrSpaceKey = data.ocrSpaceKey?.trim();
    const suppliedOptiicKey = data.optiicKey?.trim();

    // A browser-supplied key is scoped to the selected engine. OpenOCR also reads
    // the saved OCR.space and Optiic keys, because those services are its fallbacks.
    // Environment keys remain the default when the browser did not supply one.
    const effectiveOpenRouterKey =
      data.engine === "openrouter" ? suppliedApiKey || openRouterKey : openRouterKey;
    const effectiveOptiicKey =
      data.engine === "optiic"
        ? suppliedApiKey || optiicKey
        : data.engine === "openocr"
          ? suppliedOptiicKey || optiicKey
          : optiicKey;
    const effectiveOcrSpaceKey =
      data.engine === "ocrspace"
        ? suppliedApiKey || ocrSpaceKey
        : data.engine === "openocr"
          ? suppliedOcrSpaceKey || ocrSpaceKey
          : ocrSpaceKey;

    const openRouter = (messages: ChatMessage[]) =>
      callChat({
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: { Authorization: `Bearer ${effectiveOpenRouterKey}` },
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

    const asText = (result: { questions: Question[]; raw: string }) =>
      data.contentMode === "text"
        ? { ...result, questions: stripFigures(result.questions) }
        : result;

    if (data.engine === "openocr") {
      return readExamPage({
        imageDataUrl: data.imageDataUrl,
        page: data.page,
        mode: data.contentMode,
        ...(data.hint ? { hint: data.hint } : {}),
        ...(effectiveOcrSpaceKey ? { ocrSpaceKey: effectiveOcrSpaceKey } : {}),
        ...(effectiveOptiicKey ? { optiicKey: effectiveOptiicKey } : {}),
        structureWithModel: async (pageText) => {
          if (!omniroutersKey && !lovableKey && !effectiveOpenRouterKey) return null;
          const structured = await structurePlainText(pageText, {
            page: data.page,
            ...(data.hint ? { hint: data.hint } : {}),
            ...(omniroutersKey ? { omniroutersKey } : {}),
            ...(effectiveOpenRouterKey ? { openRouterKey: effectiveOpenRouterKey } : {}),
            ...(lovableKey ? { lovableKey } : {}),
            ...(data.model ? { model: data.model } : {}),
          });
          return resolvedQuestions(structured, pageText, data.page).questions;
        },
        digitisePage: (imageDataUrl) =>
          digitisePageImage(imageDataUrl, {
            page: data.page,
            ...(data.hint ? { hint: data.hint } : {}),
            ...(omniroutersKey ? { omniroutersKey } : {}),
            ...(effectiveOpenRouterKey ? { openRouterKey: effectiveOpenRouterKey } : {}),
            ...(lovableKey ? { lovableKey } : {}),
            ...(data.model ? { model: data.model } : {}),
          }),
      });
    }

    let text: string;

    if (data.engine === "openrouter") {
      if (!effectiveOpenRouterKey) {
        throw new Error("No OpenRouter API key is saved yet. Add it in Settings, then try again.");
      }
      text = await openRouter(visionMessages(data.imageDataUrl, data.hint));
    } else if (data.engine === "optiic" || data.engine === "ocrspace") {
      const pageText =
        data.engine === "ocrspace"
          ? await (async () => {
              if (!effectiveOcrSpaceKey) {
                throw new Error(
                  "No OCR.space API key is saved yet. Add a free key in Settings, then try again.",
                );
              }
              return (await ocrSpaceText(effectiveOcrSpaceKey, data.imageDataUrl)).text;
            })()
          : await (async () => {
              if (!effectiveOptiicKey) {
                throw new Error(
                  "No Optiic API key is saved yet. Add it in Settings, then try again.",
                );
              }
              return optiicText(effectiveOptiicKey, data.imageDataUrl);
            })();

      const structured = await structurePlainText(pageText, {
        page: data.page,
        hint: data.hint,
        omniroutersKey,
        openRouterKey: effectiveOpenRouterKey,
        lovableKey,
        model: data.model,
      });
      return asText(resolvedQuestions(structured, pageText, data.page));
    } else {
      if (!lovableKey) throw new Error("AI is not configured for this project.");
      text = await lovable(visionMessages(data.imageDataUrl, data.hint));
    }

    const questions = questionsFromText(text, data.page);

    return asText({
      questions,
      raw: questions.length ? "" : text.slice(0, 2000),
    });
  });

export const structureOcrText = createServerFn({ method: "POST" })
  .validator((input: unknown) => StructureInputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: Question[]; raw: string }> => {
    const omniroutersKey = omniroutersApiKey();
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const openRouterKey = process.env["OPENROUTER_API_KEY"];
    const suppliedApiKey = data.apiKey?.trim();
    const structured = await structurePlainText(data.text, {
      page: data.page,
      hint: data.hint,
      omniroutersKey,
      openRouterKey: suppliedApiKey || openRouterKey,
      lovableKey,
      model: data.model,
    });

    return resolvedQuestions(structured, data.text, data.page);
  });

const CropInputSchema = z.object({
  imageDataUrl: z.string().min(32),
  page: z.number().int().min(0),
  layout: z.enum(CROP_LAYOUTS),
  contentMode: z.enum(CONTENT_MODES).default("text"),
  number: z.string().max(40).nullable().optional(),
  engine: z.enum(READER_ENGINES).default("openocr"),
  apiKey: z.string().max(1000).optional(),
  ocrSpaceKey: z.string().max(1000).optional(),
  optiicKey: z.string().max(1000).optional(),
  model: z.string().min(2).max(120).optional(),
  hint: z.string().max(600).optional(),
});

/** Read one question image. Equations uses the vision model. Every other layout uses text OCR. */
export const readQuestionCrop = createServerFn({ method: "POST" })
  .validator((input: unknown) => CropInputSchema.parse(input))
  .handler(async ({ data }): Promise<{ question: Question }> => {
    const number = data.number ?? null;
    if (data.layout === "equations") {
      const question = await readEquationCrop(data, number);
      return { question: presentCrop(question, data.contentMode) };
    }

    const ocrSpaceKey = data.ocrSpaceKey?.trim() || process.env["OCR_SPACE_API_KEY"];
    const optiicKey = data.optiicKey?.trim() || process.env["OPTIIC_API_KEY"];
    const transcript = await readPrintedText({
      imageDataUrl: data.imageDataUrl,
      ...(ocrSpaceKey ? { ocrSpaceKey } : {}),
      ...(optiicKey ? { optiicKey } : {}),
    });
    const recovered = transcript.words?.length ? inlineStackedFractions(transcript.words) : null;
    const text =
      recovered &&
      recovered.length >= transcript.text.length * 0.6 &&
      numberedHeads(recovered) >= numberedHeads(transcript.text)
        ? recovered
        : transcript.text;
    const structured = structureCropText(text, data.layout, data.page, number);
    if (!structured) throw new Error("This crop could not be read with that layout.");

    let question: Question = { ...structured, reader_id: "crop", reader_version: data.layout };
    if (data.contentMode === "graphics") {
      try {
        const regions = await readLayoutRegions(transcript.imageDataUrl);
        const [withFigures] = attachFigures([question], regions, {
          reader_id: "crop",
          reader_version: `${data.layout}+layout`,
        });
        if (withFigures) question = withFigures;
      } catch {
        /* The words still stand when the diagram service is unavailable. */
      }
    }
    return { question: presentCrop(question, data.contentMode) };
  });

async function readEquationCrop(
  data: z.infer<typeof CropInputSchema>,
  number: string | null,
): Promise<Question> {
  const omniroutersKey = omniroutersApiKey();
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const openRouterFromEnv = process.env["OPENROUTER_API_KEY"];
  const openRouterKey =
    data.engine === "openrouter" ? data.apiKey?.trim() || openRouterFromEnv : openRouterFromEnv;
  const hint = [
    "This image is one printed question, including its choices. Return exactly one question. Write mathematics as LaTeX.",
    data.hint?.trim(),
  ]
    .filter(Boolean)
    .join(" ");
  const questions = await digitisePageImage(data.imageDataUrl, {
    page: data.page,
    ...(hint ? { hint } : {}),
    ...(omniroutersKey ? { omniroutersKey } : {}),
    ...(openRouterKey ? { openRouterKey } : {}),
    ...(lovableKey ? { lovableKey } : {}),
    ...(data.model ? { model: data.model } : {}),
  });
  const question = oneCropQuestion(questions ?? [], number);
  if (!question) {
    throw new Error("Equations could not be read from this crop. Check the AI key in Settings.");
  }
  return { ...question, reader_id: "crop", reader_version: "equations" };
}

function presentCrop(question: Question, mode: "text" | "graphics"): Question {
  if (mode !== "text") return question;
  const [stripped] = stripFigures([question]);
  return stripped ?? question;
}

function numberedHeads(text: string): number {
  return text.split("\n").filter((line) => /^\s*\(?\d{1,3}\s*[.)]/.test(line)).length;
}

/** Reports which reader keys are configured, without ever revealing their values. */
export const getReaderStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    openocr: boolean;
    lovable: boolean;
    openrouter: boolean;
    optiic: boolean;
    ocrspace: boolean;
  }> => ({
    openocr: await openOcrHealthy(),
    lovable: !!process.env["LOVABLE_API_KEY"],
    openrouter: !!process.env["OPENROUTER_API_KEY"],
    optiic: !!process.env["OPTIIC_API_KEY"],
    ocrspace: !!process.env["OCR_SPACE_API_KEY"],
  }),
);