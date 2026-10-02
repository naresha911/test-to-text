import { readOpenOcrPage } from "@/lib/reader/openocr";
import type { TextLineBox } from "@/lib/reader/parse-blocks";

/** OCR.space free tier: one image, at most 1 MB, plain text only. */
const OCR_SPACE_MAX_BYTES = 1_000_000;

export type PageTranscript = {
  text: string;
  lines: TextLineBox[];
  source: string;
  /** Image the words were read from. Layout uses the same pixels. */
  imageDataUrl: string;
};

/**
 * Read printed words. OCR.space, then Optiic, then the local text service.
 * This does not look for diagrams and does not build questions.
 */
export async function readPrintedText(options: {
  imageDataUrl: string;
  ocrSpaceKey?: string;
  optiicKey?: string;
}): Promise<PageTranscript> {
  let image = options.imageDataUrl;
  let localText = "";
  let localError: Error | null = null;
  let size: { width: number; height: number } | undefined;

  try {
    const local = await readOpenOcrPage(options.imageDataUrl);
    if (local.page_jpeg_base64) image = `data:image/jpeg;base64,${local.page_jpeg_base64}`;
    const width = local.jpeg_width || local.page_width || 0;
    const height = local.jpeg_height || local.page_height || 0;
    if (width > 0 && height > 0) size = { width, height };
    localText = local.blocks
      .filter((block) => block.type === "text" || block.type === "formula")
      .map((block) => block.text?.trim() || block.latex?.trim() || "")
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    localError = error instanceof Error ? error : new Error(String(error));
  }

  let textError: Error | null = null;

  if (options.ocrSpaceKey) {
    try {
      const reading = await ocrSpaceText(options.ocrSpaceKey, image, size);
      return { text: reading.text, lines: reading.lines, source: "ocrspace", imageDataUrl: image };
    } catch (error) {
      textError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (options.optiicKey) {
    try {
      const text = await optiicText(options.optiicKey, image);
      return { text, lines: [], source: "optiic", imageDataUrl: image };
    } catch (error) {
      textError = textError ?? (error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (localText.trim()) {
    return { text: localText, lines: [], source: "local", imageDataUrl: image };
  }

  throw new Error(
    textError?.message ??
      localError?.message ??
      "No printed text could be read. Keep an OCR.space or Optiic key in Settings.",
  );
}

export async function ocrSpaceText(
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

export async function optiicText(apiKey: string, imageDataUrl: string): Promise<string> {
  const blob = dataUrlToBlob(imageDataUrl);
  const formData = new FormData();
  formData.append("apiKey", apiKey);
  formData.append("image", blob, "page.jpg");
  formData.append("mode", "ocr");

  const response = await fetch("https://api.optiic.dev/process", {
    method: "POST",
    body: formData,
  });

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

function ocrMessage(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(" ").trim();
  return (value ?? "").trim();
}

function dataUrlToBlob(dataUrl: string): Blob {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
  const mimeMatch = dataUrl.match(/^data:([^;]+);/);
  const type = mimeMatch?.[1] ?? "image/jpeg";
  return new Blob([Buffer.from(base64, "base64")], { type });
}
