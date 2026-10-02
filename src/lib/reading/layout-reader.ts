import { openOcrUrl } from "@/lib/reader/openocr";
import type { ReaderBlock } from "@/lib/reader/types";

import { toGraphicBlocks, type LayoutDetection } from "@/lib/reading/regions";

type LayoutPayload = {
  blocks?: ReaderBlock[];
  detections?: LayoutDetection[];
  width?: number;
  height?: number;
  error?: string;
  detail?: string;
};

/** Ask the local PP-DocLayout service for diagram regions. Text regions are dropped. */
export async function readLayoutRegions(
  imageDataUrl: string,
  timeoutMs = 180_000,
): Promise<ReaderBlock[]> {
  let response: Response;
  try {
    response = await fetch(`${openOcrUrl()}/layout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image_base64: imageDataUrl }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "the request failed";
    throw new Error(
      `Graphics reading needs the local layout service at ${openOcrUrl()} (${reason}). Start it with npm run ocr.`,
    );
  }

  const body = await response.text();
  let payload: LayoutPayload | null = null;
  try {
    payload = JSON.parse(body) as LayoutPayload;
  } catch {
    payload = null;
  }
  if (response.status === 404) {
    throw new Error("Restart the local reader with npm run ocr so Graphics can find diagrams.");
  }
  if (!response.ok) {
    const message =
      payload?.detail || payload?.error || `Graphics reading failed (${response.status}).`;
    throw new Error(message);
  }

  if (Array.isArray(payload?.blocks)) {
    return payload.blocks.filter((block) => block.type === "figure" || block.type === "table");
  }

  const width = payload?.width ?? 0;
  const height = payload?.height ?? 0;
  if (!payload?.detections || width <= 0 || height <= 0) {
    throw new Error("Graphics reading returned no diagram regions.");
  }
  return toGraphicBlocks(payload.detections, { width, height });
}
