import { structureOcrText } from "@/lib/ocr-structure";
import type { Question } from "@/lib/question-schema";
import type { ReaderBlock } from "@/lib/reader/types";

import { cleanPage, usableStems } from "@/lib/reading/clean-page";
import { readLayoutRegions } from "@/lib/reading/layout-reader";
import type { ContentMode } from "@/lib/reading/mode";
import { readPrintedText, type PageTranscript } from "@/lib/reading/text-reader";

export type ReadExamPageOptions = {
  imageDataUrl: string;
  page: number;
  mode: ContentMode;
  hint?: string;
  ocrSpaceKey?: string;
  optiicKey?: string;
  /** Cleaning step. Called only when the numbered split cannot find a question. */
  structureWithModel?: (pageText: string) => Promise<Question[] | null>;
};

type ReadDeps = {
  readText?: typeof readPrintedText;
  readLayout?: (imageDataUrl: string) => Promise<ReaderBlock[]>;
};

/** Read words, and in graphics mode diagram regions, then hand both to the cleaner. */
export async function readExamPage(
  options: ReadExamPageOptions,
  deps: ReadDeps = {},
): Promise<{ questions: Question[]; raw: string }> {
  const readText = deps.readText ?? readPrintedText;
  const readLayout = deps.readLayout ?? readLayoutRegions;

  const transcript: PageTranscript = await readText({
    imageDataUrl: options.imageDataUrl,
    ...(options.ocrSpaceKey ? { ocrSpaceKey: options.ocrSpaceKey } : {}),
    ...(options.optiicKey ? { optiicKey: options.optiicKey } : {}),
  });

  const regions = options.mode === "graphics" ? await readLayout(transcript.imageDataUrl) : [];

  const offline = structureOcrText(transcript.text, options.page);
  let modelQuestions: Question[] | null = null;
  if (!usableStems(offline).length && options.structureWithModel) {
    try {
      modelQuestions = await options.structureWithModel(transcript.text);
    } catch {
      /* The printed text is still split locally. */
    }
  }

  const questions = cleanPage({
    pageText: transcript.text,
    page: options.page,
    mode: options.mode,
    lines: transcript.lines,
    regions,
    reader: {
      reader_id: "openocr",
      reader_version: `openocr+${transcript.source}${options.mode === "graphics" ? "+layout" : ""}`,
    },
    modelQuestions,
  });

  return { questions, raw: "" };
}
