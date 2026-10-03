import type { ReaderEngine } from "@/lib/extract.functions";
import { cropFigure } from "@/lib/image-utils";
import type { Question } from "@/lib/question-schema";
import { loadReaderSettings } from "@/lib/reader-settings";
import type { CropLayout } from "@/lib/reading/crop-layout";
import type { ContentMode } from "@/lib/reading/mode";

export type CropReadRequest = {
  imageDataUrl: string;
  page: number;
  layout: CropLayout;
  contentMode: ContentMode;
  number?: string | null;
  engine: ReaderEngine;
  apiKey?: string;
  ocrSpaceKey?: string;
  optiicKey?: string;
  model?: string;
  hint?: string;
};

type SaveFigure = (input: {
  documentId: string;
  dataUrl: string;
  filename: string;
}) => Promise<{ path: string }>;

/**
 * Read one stored crop, then save any diagram crops found inside it.
 * Text mode drops figures. The caller decides whether to replace the question.
 */
export async function readStoredCrop(input: {
  question: Question;
  layout: CropLayout;
  contentMode: ContentMode;
  documentId: string;
  cropDataUrl: string;
  hint?: string;
  read: (request: CropReadRequest) => Promise<{ question: Question }>;
  saveFigure: SaveFigure;
}): Promise<{ question: Question; urls: Record<string, string> }> {
  const reader = loadReaderSettings();
  const apiKey = reader.apiKeys?.[reader.engine]?.trim();
  const ocrSpaceKey = reader.apiKeys?.ocrspace?.trim();
  const optiicKey = reader.apiKeys?.optiic?.trim();
  const result = await input.read({
    imageDataUrl: input.cropDataUrl,
    page: input.question.page ?? 0,
    layout: input.layout,
    contentMode: input.contentMode,
    number: input.question.number,
    engine: reader.engine,
    ...(apiKey ? { apiKey } : {}),
    ...(ocrSpaceKey ? { ocrSpaceKey } : {}),
    ...(optiicKey ? { optiicKey } : {}),
    ...(reader.model ? { model: reader.model } : {}),
    ...(input.hint?.trim() ? { hint: input.hint.trim() } : {}),
  });

  if (input.contentMode !== "graphics") return { question: result.question, urls: {} };
  return storeCropFigures({
    question: result.question,
    cropDataUrl: input.cropDataUrl,
    documentId: input.documentId,
    saveFigure: input.saveFigure,
  });
}

async function storeCropFigures(input: {
  question: Question;
  cropDataUrl: string;
  documentId: string;
  saveFigure: SaveFigure;
}): Promise<{ question: Question; urls: Record<string, string> }> {
  const question = {
    ...input.question,
    figures: input.question.figures.map((figure) => ({ ...figure })),
    options: input.question.options.map((option) => ({ ...option })),
  };
  const urls: Record<string, string> = {};
  const stamp = question.id.slice(0, 8);

  for (const [index, figure] of question.figures.entries()) {
    if (!figure.bbox) continue;
    const crop = await cropFigure(input.cropDataUrl, figure.bbox);
    if (!crop) continue;
    const dataUrl = await blobToDataUrl(crop);
    const saved = await input.saveFigure({
      documentId: input.documentId,
      dataUrl,
      filename: `crop-${stamp}-fig-${index + 1}.jpg`,
    });
    figure.image_path = saved.path;
    figure.generation_method = "cropped";
    urls[saved.path] = dataUrl;
    if (figure.role === "option_figure" && figure.caption) {
      const option = question.options.find((item) => item.key === figure.caption);
      if (option) option.image_path = saved.path;
    }
  }

  return { question, urls };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not encode the diagram crop."));
    reader.readAsDataURL(blob);
  });
}
