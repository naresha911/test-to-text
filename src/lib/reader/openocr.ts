import type {
  RawReaderResult,
  ReaderBlock,
  ReaderBlockType,
  SourceReader,
} from "@/lib/reader/types";
import { READER_BLOCK_TYPES } from "@/lib/reader/types";

export const OPENOCR_READER_ID = "openocr";

const DEFAULT_URL = "http://127.0.0.1:8099";

export function openOcrUrl(): string {
  return (process.env["OPENOCR_URL"] || DEFAULT_URL).replace(/\/$/, "");
}

function bbox(value: unknown): ReaderBlock["bbox"] {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const nums = value.map((item) => (typeof item === "number" ? item : Number.NaN));
  if (nums.some((item) => !Number.isFinite(item))) return null;
  return nums.map((item) => Math.min(1, Math.max(0, item))) as [number, number, number, number];
}

function block(raw: unknown, index: number): ReaderBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const type = READER_BLOCK_TYPES.includes(row["type"] as ReaderBlockType)
    ? (row["type"] as ReaderBlockType)
    : "unknown";
  return {
    id: typeof row["id"] === "string" ? row["id"] : `b${index + 1}`,
    type,
    text: typeof row["text"] === "string" ? row["text"] : null,
    latex: typeof row["latex"] === "string" ? row["latex"] : null,
    bbox: bbox(row["bbox"]),
    confidence: typeof row["confidence"] === "number" ? row["confidence"] : null,
  };
}

export function parseOpenOcrPayload(raw: unknown): RawReaderResult {
  const row = (raw ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(row["blocks"])
    ? row["blocks"].map(block).filter((item): item is ReaderBlock => item != null)
    : [];
  return {
    reader_id: typeof row["reader_id"] === "string" ? row["reader_id"] : OPENOCR_READER_ID,
    reader_version: typeof row["reader_version"] === "string" ? row["reader_version"] : "openocr-1",
    page_width: typeof row["page_width"] === "number" ? row["page_width"] : null,
    page_height: typeof row["page_height"] === "number" ? row["page_height"] : null,
    blocks,
    created_at:
      typeof row["created_at"] === "string" ? row["created_at"] : new Date().toISOString(),
    page_jpeg_base64: typeof row["page_jpeg_base64"] === "string" ? row["page_jpeg_base64"] : null,
    jpeg_width: typeof row["jpeg_width"] === "number" ? row["jpeg_width"] : null,
    jpeg_height: typeof row["jpeg_height"] === "number" ? row["jpeg_height"] : null,
  };
}

export async function openOcrHealthy(timeoutMs = 800): Promise<boolean> {
  try {
    const response = await fetch(`${openOcrUrl()}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

export async function readOpenOcrPage(
  imageDataUrl: string,
  timeoutMs = 25_000,
): Promise<RawReaderResult> {
  let response: Response;
  try {
    response = await fetch(`${openOcrUrl()}/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image_base64: imageDataUrl }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "the request failed";
    throw new Error(
      `OpenOCR is not reachable at ${openOcrUrl()} (${reason}). Start it with npm run ocr.`,
    );
  }
  const body = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const row =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const message =
      (typeof row?.["error"] === "string" && row["error"]) ||
      (typeof row?.["detail"] === "string" && row["detail"]) ||
      `OpenOCR failed (${response.status}).`;
    throw new Error(message);
  }
  const result = parseOpenOcrPayload(payload);
  if (!result.blocks.length && result.page_width == null) {
    throw new Error("OpenOCR returned nothing for this page.");
  }
  return result;
}

export const openOcrReader: SourceReader = {
  id: OPENOCR_READER_ID,
  readPage(input) {
    return readOpenOcrPage(input.imageDataUrl);
  },
};
