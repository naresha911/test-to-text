import { structureOcrText } from "@/lib/ocr-structure";
import type { Question } from "@/lib/question-schema";
import type { ReaderBlock } from "@/lib/reader/types";

import { cleanPage, usableStems } from "@/lib/reading/clean-page";
import { readLayoutRegions } from "@/lib/reading/layout-reader";
import { repairFlaggedQuestions, type RepairInput } from "@/lib/reading/repair-pass";
import { orderedPageText } from "@/lib/reading/line-order";
import { inlineStackedFractions, mathTranscriptIsSmashed } from "@/lib/reading/math-text";
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
  /**
   * Read the page image when OCR dropped fraction bars or mixed numbers.
   * Receives the image, not the broken text.
   */
  digitisePage?: (imageDataUrl: string) => Promise<Question[] | null>;
};

type ReadDeps = {
  readText?: typeof readPrintedText;
  readLayout?: (imageDataUrl: string) => Promise<ReaderBlock[]>;
  repair?: Pick<RepairInput, "cropRegion" | "readLocalText" | "readOcrSpaceText">;
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

  const recovered = transcript.words?.length ? inlineStackedFractions(transcript.words) : null;
  const ordered = orderedPageText(transcript.lines);
  // A thin word overlay must not replace a fuller plain-text read, and a
  // fraction repair must not erase question numbers the line read already found.
  // Line boxes restore left-to-right choice rows and margin question numbers.
  let pageText = transcript.text;
  if (
    ordered &&
    ordered.length >= pageText.length * 0.6 &&
    numberedHeads(ordered) >= numberedHeads(pageText)
  ) {
    pageText = ordered;
  }
  if (
    recovered &&
    recovered.length >= pageText.length * 0.6 &&
    numberedHeads(recovered) >= numberedHeads(pageText)
  ) {
    pageText = recovered;
  }
  const smashed = mathTranscriptIsSmashed(pageText);
  const offline = structureOcrText(pageText, options.page);
  let modelQuestions: Question[] | null = null;
  if (smashed && options.digitisePage) {
    try {
      modelQuestions = await options.digitisePage(transcript.imageDataUrl);
    } catch (error) {
      if (error instanceof Error && error.message.includes("AI_CREDITS")) throw error;
    }
  }
  const visionSaved = usableStems(modelQuestions ?? []).length > 0;
  if (!visionSaved && !usableStems(offline).length && options.structureWithModel) {
    try {
      modelQuestions = await options.structureWithModel(pageText);
    } catch {
      /* The printed text is still split locally. */
    }
  }

  const questions = cleanPage({
    pageText,
    page: options.page,
    mode: options.mode,
    lines: transcript.lines,
    regions,
    reader: {
      reader_id: "openocr",
      reader_version: `openocr+${transcript.source}${options.mode === "graphics" ? "+layout" : ""}`,
    },
    modelQuestions,
    preferModel: smashed,
  });

  const repaired = await repairFlaggedQuestions(questions, {
    lines: transcript.lines,
    source: transcript.source,
    imageDataUrl: transcript.imageDataUrl,
    page: options.page,
    ...(options.ocrSpaceKey ? { ocrSpaceKey: options.ocrSpaceKey } : {}),
    ...(options.digitisePage ? { digitisePage: options.digitisePage } : {}),
    ...deps.repair,
  });

  return { questions: repaired, raw: "" };
}

function numberedHeads(text: string): number {
  return text.split("\n").filter((line) => /^\s*\(?\d{1,3}\s*[.)]/.test(line)).length;
}
