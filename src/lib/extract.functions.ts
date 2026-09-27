import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { structureOcrText as structureOcrTextOffline } from "@/lib/ocr-structure";
import { normalizeQuestion, type Question } from "@/lib/question-schema";
import { readOpenOcrPage, openOcrHealthy } from "@/lib/reader/openocr";
import { attachFigures, type TextLineBox } from "@/lib/reader/parse-blocks";
import type { RawReaderResult } from "@/lib/reader/types";

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
  /** Model id, only used by the OpenRouter engine. */
  model: z.string().min(2).max(120).optional(),
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

/** Structure plain-text OCR output, with the same model fallback used by the image readers. */
async function structurePlainText(
  pageText: string,
  options: {
    page: number;
    hint?: string | undefined;
    openRouterKey?: string | undefined;
    lovableKey?: string | undefined;
    model?: string | undefined;
  },
): Promise<{ text: string } | { questions: Question[] }> {
  const messages = structureTextMessages(pageText, options.hint);
  try {
    if (options.openRouterKey) {
      return {
        text: await callChat({
          url: "https://openrouter.ai/api/v1/chat/completions",
          headers: { Authorization: `Bearer ${options.openRouterKey}` },
          model: options.model?.trim() || DEFAULT_OPENROUTER_MODEL,
          messages,
          label: "OpenRouter",
          maxTokens: 12000,
        }),
      };
    }
    if (options.lovableKey) {
      return {
        text: await callChat({
          url: "https://ai.gateway.lovable.dev/v1/chat/completions",
          headers: { "Lovable-API-Key": options.lovableKey, "X-Lovable-AIG-SDK": "fetch" },
          model: "google/gemini-3.8-flash",
          messages,
          label: "The built-in AI reader",
        }),
      };
    }
  } catch (error) {
    if (options.lovableKey && options.openRouterKey) {
      try {
        return {
          text: await callChat({
            url: "https://ai.gateway.lovable.dev/v1/chat/completions",
            headers: { "Lovable-API-Key": options.lovableKey, "X-Lovable-AIG-SDK": "fetch" },
            model: "google/gemini-3.8-flash",
            messages,
            label: "The built-in AI reader",
          }),
        };
      } catch {
        /* fall through to offline structuring */
      }
    }
    if (!(error instanceof Error)) throw error;
  }
  return { questions: structureOcrTextOffline(pageText, options.page) };
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

/** OCR.space free tier: one image, at most 1 MB, plain text only. */
const OCR_SPACE_MAX_BYTES = 1_000_000;

function ocrMessage(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(" ").trim();
  return (value ?? "").trim();
}

/** OCR.space returns plain text. Pass image size to also collect line boxes for figure placement. */
async function ocrSpaceText(
  apiKey: string,
  imageDataUrl: string,
  size?: { width: number; height: number },
): Promise<{ text: string; lines: TextLineBox[] }> {
  const blob = dataUrlToBlob(imageDataUrl);
  if (blob.size > OCR_SPACE_MAX_BYTES) {
    throw new Error("This page is over the OCR.space free limit of 1 MB.");
  }

  const formData = new FormData();
  formData.append("file", blob, "page.jpg");
  formData.append("language", "eng");
  formData.append("OCREngine", "2");
  formData.append("detectOrientation", "true");
  formData.append("isOverlayRequired", size ? "true" : "false");
  formData.append("scale", size ? "false" : "true");

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: apiKey },
    body: formData,
  });

  const body = await response.text();
  type OcrSpaceWord = { Left?: number; Top?: number; Width?: number; Height?: number };
  type OcrSpaceLine = { LineText?: string; Words?: OcrSpaceWord[] };
  type OcrSpaceResult = {
    ParsedText?: string;
    ErrorMessage?: string | string[];
    TextOverlay?: { Lines?: OcrSpaceLine[] };
  };
  type OcrSpacePayload = {
    ParsedResults?: OcrSpaceResult[];
    IsErroredOnProcessing?: boolean;
    ErrorMessage?: string | string[] | null;
    ErrorDetails?: string | null;
    OCRExitCode?: number;
  };

  let payload: OcrSpacePayload | null = null;
  try {
    payload = JSON.parse(body) as OcrSpacePayload;
  } catch {
    /* plain-text response */
  }

  const detail = (
    ocrMessage(payload?.ErrorMessage) ||
    ocrMessage(payload?.ParsedResults?.[0]?.ErrorMessage) ||
    (payload?.ErrorDetails ?? "") ||
    body
  )
    .trim()
    .slice(0, 300);
  const lower = detail.toLowerCase();

  if (!response.ok) {
    if (response.status === 429 || lower.includes("limit") || lower.includes("quota")) {
      throw new Error(
        detail ||
          "OCR.space has hit its free usage limit for now. Wait and try again, or switch reader in Settings.",
      );
    }
    if (response.status === 401 || response.status === 403 || lower.includes("api key")) {
      throw new Error("OCR.space rejected the saved API key. Check the free key in Settings.");
    }
    if (lower.includes("file size") || lower.includes("too large")) {
      throw new Error("This page is over the OCR.space free limit of 1 MB.");
    }
    throw new Error(detail || `OCR.space failed (${response.status}).`);
  }

  if (payload?.IsErroredOnProcessing || payload?.OCRExitCode === 3 || payload?.OCRExitCode === 4) {
    if (lower.includes("file size") || lower.includes("too large") || lower.includes("1 mb")) {
      throw new Error("This page is over the OCR.space free limit of 1 MB.");
    }
    if (lower.includes("api key") || lower.includes("apikey")) {
      throw new Error("OCR.space rejected the saved API key. Check the free key in Settings.");
    }
    if (lower.includes("limit") || lower.includes("quota")) {
      throw new Error(
        detail ||
          "OCR.space has hit its free usage limit for now. Wait and try again, or switch reader in Settings.",
      );
    }
    throw new Error(detail || "OCR.space could not read this page.");
  }

  const text = (payload?.ParsedResults ?? [])
    .map((result) => result.ParsedText ?? "")
    .join("\n")
    .trim();
  if (!text) throw new Error("OCR.space found no text on this page.");
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const lines: TextLineBox[] = [];
  if (width > 0 && height > 0) {
    for (const result of payload?.ParsedResults ?? []) {
      for (const line of result.TextOverlay?.Lines ?? []) {
        const words = line.Words ?? [];
        if (!words.length) continue;
        const left = Math.min(...words.map((word) => word.Left ?? 0));
        const top = Math.min(...words.map((word) => word.Top ?? 0));
        const right = Math.max(...words.map((word) => (word.Left ?? 0) + (word.Width ?? 0)));
        const bottom = Math.max(...words.map((word) => (word.Top ?? 0) + (word.Height ?? 0)));
        lines.push({
          text: line.LineText ?? "",
          bbox: [left / width, top / height, (right - left) / width, (bottom - top) / height],
        });
      }
    }
  }
  return { text, lines };
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
  formData.append("apiKey", apiKey);
  formData.append("image", blob, "page.jpg");
  formData.append("mode", "ocr");

  const response = await fetch("https://api.optiic.dev/process", {
    method: "POST",
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
        detail ||
          "Optiic has hit its usage limit for now. Wait and try again, or switch reader in Settings.",
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

const FIGURE_PLAN =
  /we'?ll add a figure|we need bbox|need to define bbox|coordinate system|let's (?:try to )?approximate|x\s*=\s*0 is (?:the )?left edge/i;

function usableStems(questions: Question[]): Question[] {
  return questions.filter(
    (question) => question.stem.trim().length >= 8 && !FIGURE_PLAN.test(question.stem),
  );
}

function withoutModelFigures(questions: Question[]): Question[] {
  return questions.map((question) => ({
    ...question,
    figures: [],
    sub_questions: withoutModelFigures(question.sub_questions),
  }));
}

async function readOpenOcrExtraction(options: {
  imageDataUrl: string;
  page: number;
  hint?: string;
  lovableKey?: string;
  openRouterKey?: string;
  ocrSpaceKey?: string;
  optiicKey?: string;
  model?: string;
}): Promise<{ questions: Question[]; raw: string }> {
  let layout: RawReaderResult | null = null;
  let layoutError: Error | null = null;
  try {
    layout = await readOpenOcrPage(options.imageDataUrl);
  } catch (error) {
    layoutError = error instanceof Error ? error : new Error(String(error));
  }

  const image =
    layout?.page_jpeg_base64 != null
      ? `data:image/jpeg;base64,${layout.page_jpeg_base64}`
      : options.imageDataUrl;
  const width = layout?.jpeg_width || layout?.page_width || 0;
  const height = layout?.jpeg_height || layout?.page_height || 0;
  const size = width > 0 && height > 0 ? { width, height } : undefined;

  let pageText = "";
  let lines: TextLineBox[] = [];
  let textSource = "local";
  let textError: Error | null = null;

  if (options.ocrSpaceKey) {
    try {
      const reading = await ocrSpaceText(options.ocrSpaceKey, image, size);
      pageText = reading.text;
      lines = reading.lines;
      textSource = "ocrspace";
    } catch (error) {
      textError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (!pageText.trim() && options.optiicKey) {
    try {
      pageText = await optiicText(options.optiicKey, image);
      textSource = "optiic";
    } catch (error) {
      textError = textError ?? (error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (!pageText.trim() && layout) {
    pageText = layout.blocks
      .filter((block) => block.type === "text" || block.type === "formula")
      .map((block) => block.text?.trim() || block.latex?.trim() || "")
      .filter(Boolean)
      .join("\n");
    textSource = "local";
  }
  if (!pageText.trim()) {
    throw new Error(
      textError?.message ??
        layoutError?.message ??
        "No printed text could be read. Keep an OCR.space or Optiic key in Settings, and start the local service with npm run ocr so diagram boxes can be cropped.",
    );
  }

  let questions = structureOcrTextOffline(pageText, options.page);
  if (!usableStems(questions).length && (options.openRouterKey || options.lovableKey)) {
    try {
      const structured = await structurePlainText(pageText, {
        page: options.page,
        ...(options.hint ? { hint: options.hint } : {}),
        ...(options.openRouterKey ? { openRouterKey: options.openRouterKey } : {}),
        ...(options.lovableKey ? { lovableKey: options.lovableKey } : {}),
        ...(options.model ? { model: options.model } : {}),
      });
      const resolved = usableStems(resolvedQuestions(structured, pageText, options.page).questions);
      if (resolved.length) questions = resolved;
    } catch {
      /* The printed OCR text is still split locally. */
    }
  }

  const reader = {
    reader_id: "openocr",
    reader_version: layout ? `${layout.reader_version}+${textSource}` : textSource,
  };
  const plain = withoutModelFigures(questions);
  questions = layout
    ? attachFigures(plain, layout.blocks, reader, lines)
    : plain.map((question) => ({ ...question, ...reader }));
  if (!usableStems(questions).length) {
    throw new Error(
      "The page was read, but the text could not be split into questions. Try the page again.",
    );
  }
  return { questions, raw: "" };
}

export const extractPage = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: Question[]; raw: string }> => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const openRouterKey = process.env["OPENROUTER_API_KEY"];
    const optiicKey = process.env["OPTIIC_API_KEY"];
    const ocrSpaceKey = process.env["OCR_SPACE_API_KEY"];
    const suppliedApiKey = data.apiKey?.trim();

    // A browser-supplied key is scoped to the selected engine. Environment keys remain
    // the default for deployments that configure readers server-side.
    const effectiveOpenRouterKey =
      data.engine === "openrouter" ? suppliedApiKey || openRouterKey : openRouterKey;
    const effectiveOptiicKey = data.engine === "optiic" ? suppliedApiKey || optiicKey : optiicKey;
    const effectiveOcrSpaceKey =
      data.engine === "ocrspace" ? suppliedApiKey || ocrSpaceKey : ocrSpaceKey;

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

    if (data.engine === "openocr") {
      return readOpenOcrExtraction({
        imageDataUrl: data.imageDataUrl,
        page: data.page,
        ...(data.hint ? { hint: data.hint } : {}),
        ...(lovableKey ? { lovableKey } : {}),
        ...(effectiveOpenRouterKey ? { openRouterKey: effectiveOpenRouterKey } : {}),
        ...(ocrSpaceKey ? { ocrSpaceKey } : {}),
        ...(optiicKey ? { optiicKey } : {}),
        ...(data.model ? { model: data.model } : {}),
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
        openRouterKey: effectiveOpenRouterKey,
        lovableKey,
        model: data.model,
      });
      return resolvedQuestions(structured, pageText, data.page);
    } else {
      if (!lovableKey) throw new Error("AI is not configured for this project.");
      text = await lovable(visionMessages(data.imageDataUrl, data.hint));
    }

    const questions = questionsFromText(text, data.page);

    return {
      questions,
      raw: questions.length ? "" : text.slice(0, 2000),
    };
  });

export const structureOcrText = createServerFn({ method: "POST" })
  .validator((input: unknown) => StructureInputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: Question[]; raw: string }> => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const openRouterKey = process.env["OPENROUTER_API_KEY"];
    const suppliedApiKey = data.apiKey?.trim();
    const structured = await structurePlainText(data.text, {
      page: data.page,
      hint: data.hint,
      openRouterKey: suppliedApiKey || openRouterKey,
      lovableKey,
      model: data.model,
    });

    return resolvedQuestions(structured, data.text, data.page);
  });

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
