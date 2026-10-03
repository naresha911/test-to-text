import { structureOcrText } from "@/lib/ocr-structure";
import type { Question, ReadFlag } from "@/lib/question-schema";
import { cropOpenOcrRegion, readOpenOcrPage } from "@/lib/reader/openocr";
import type { TextLineBox } from "@/lib/reader/parse-blocks";

import { segmentQuestionBlocks, type QuestionBlock } from "@/lib/reading/question-blocks";
import { acceptRepair, auditQuestion, auditQuestions } from "@/lib/reading/read-audit";
import { ocrSpaceText } from "@/lib/reading/text-reader";

const REREAD_FLAGS: readonly ReadFlag[] = [
  "options_in_stem",
  "missing_options",
  "broken_math",
  "suspicious_currency",
  "partial_stem",
];

export type RepairInput = {
  lines: readonly TextLineBox[];
  /** Engine that produced the page text. The repair uses the other one. */
  source: string;
  imageDataUrl: string;
  page: number;
  ocrSpaceKey?: string;
  digitisePage?: (imageDataUrl: string) => Promise<Question[] | null>;
  cropRegion?: (
    imageDataUrl: string,
    bbox: [number, number, number, number],
    options: { pad: number; scale: number },
  ) => Promise<string>;
  readLocalText?: (imageDataUrl: string) => Promise<string>;
  readOcrSpaceText?: (apiKey: string, imageDataUrl: string) => Promise<string>;
};

/** Attach question crops, then re-read a failing crop at most twice. */
export async function repairFlaggedQuestions(
  questions: Question[],
  input: RepairInput,
): Promise<Question[]> {
  const blocks = segmentQuestionBlocks(input.lines);
  let current = auditQuestions(attachBlocks(questions, blocks, input.page));
  const originals = new Map(current.map((question) => [question.id, question]));

  for (let index = 0; index < current.length; index += 1) {
    const question = current[index]!;
    if (!needsReread(question.source_block?.flags ?? [])) continue;
    if (!question.source_block?.bbox) continue;
    const original = originals.get(question.id) ?? question;
    current[index] = await repairOne(question, original, input);
  }
  return auditQuestions(current);
}

function attachBlocks(questions: Question[], blocks: QuestionBlock[], page: number): Question[] {
  const used = new Set<number>();
  const attached = questions.map((question) => {
    const number = question.number?.trim() ?? "";
    const index = blocks.findIndex(
      (block, blockIndex) => !used.has(blockIndex) && number.length > 0 && block.number === number,
    );
    if (index < 0) {
      return {
        ...question,
        source_block: {
          bbox: null,
          image_path: question.source_block?.image_path ?? null,
          flags: question.source_block?.flags ?? [],
          passes: question.source_block?.passes ?? 1,
        },
      };
    }
    used.add(index);
    return {
      ...question,
      source_block: {
        bbox: blocks[index]!.bbox,
        image_path: question.source_block?.image_path ?? null,
        flags: [],
        passes: 1,
      },
    };
  });

  const pending = attached
    .map((question, index) => ({ index, question }))
    .filter((item) => item.question.source_block?.bbox == null);
  let pendingAt = 0;
  // A question whose printed number missed still gets the next unused box, in order.
  for (let blockIndex = 0; blockIndex < blocks.length && pendingAt < pending.length; blockIndex += 1) {
    if (used.has(blockIndex)) continue;
    const block = blocks[blockIndex]!;
    const target = pending[pendingAt]!;
    pendingAt += 1;
    used.add(blockIndex);
    attached[target.index] = {
      ...target.question,
      source_block: {
        bbox: block.bbox,
        image_path: target.question.source_block?.image_path ?? null,
        flags: [],
        passes: 1,
      },
    };
  }

  const extras: Question[] = [];
  blocks.forEach((block, index) => {
    if (used.has(index)) return;
    const text = block.lines.map((line) => line.text).join("\n");
    const parsed = questionFromCropText(text, page, block.number);
    if (!parsed || !parsed.stem.trim()) return;
    extras.push({
      ...parsed,
      number: block.number,
      page,
      source_block: { bbox: block.bbox, image_path: null, flags: [], passes: 1 },
    });
  });

  return releaseSwallowed([...attached, ...extras], extras);
}

function releaseSwallowed(questions: Question[], extras: Question[]): Question[] {
  return questions.map((question) => {
    if (extras.some((extra) => extra.id === question.id)) return question;
    let stem = question.stem;
    for (const extra of extras) {
      const piece = extra.stem.trim();
      if (piece.length < 12 || !stem.includes(piece)) continue;
      const next = stem
        .replace(piece, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (next.length >= 8) stem = next;
    }
    return stem === question.stem ? question : { ...question, stem };
  });
}

async function repairOne(
  question: Question,
  original: Question,
  input: RepairInput,
): Promise<Question> {
  const alternate = alternateEngine(input.source, input.ocrSpaceKey);
  if (!alternate) return question;

  let current = question;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const flags = (current.source_block?.flags ?? []).filter((flag) => flag !== "number_gap");
    if (!needsReread(flags) || (current.source_block?.passes ?? 1) >= 3) break;
    const bbox = current.source_block?.bbox;
    if (!bbox) break;

    const mathLeft = flags.includes("broken_math");
    const useVision = attempt === 1 && mathLeft && !!input.digitisePage;
    const pad = attempt === 0 || useVision ? 0.02 : 0.06;
    const crop = input.cropRegion ?? cropOpenOcrRegion;
    let jpeg: string;
    try {
      jpeg = await crop(input.imageDataUrl, bbox, { pad, scale: 2 });
    } catch (error) {
      if (error instanceof Error && error.message.includes("AI_CREDITS")) throw error;
      break;
    }

    let candidate: Question | null = null;
    try {
      if (useVision && input.digitisePage) {
        const vision = await input.digitisePage(jpeg);
        candidate = vision?.length === 1 ? vision[0]! : null;
      } else {
        const text = await readAlternate(alternate, jpeg, input);
        candidate = questionFromCropText(text, input.page, current.number);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("AI_CREDITS")) throw error;
      candidate = null;
    }

    const passes = Math.min(3, (current.source_block?.passes ?? 1) + 1);
    if (candidate && acceptRepair(original, candidate, flags)) {
      current = {
        ...current,
        stem: candidate.stem,
        type: candidate.type,
        options: candidate.options.map((option) => {
          const previous = current.options.find((item) => item.key === option.key);
          if (!previous?.image_path || option.image_path) return option;
          return {
            ...option,
            image_path: previous.image_path,
            image_description: previous.image_description ?? option.image_description,
          };
        }),
        blanks: candidate.blanks,
        source_block: { ...current.source_block!, passes },
      };
    } else {
      current = { ...current, source_block: { ...current.source_block!, passes } };
    }
    current = {
      ...current,
      source_block: {
        ...current.source_block!,
        flags: auditQuestion(current),
      },
    };
  }
  return current;
}

export function questionFromCropText(
  text: string,
  page: number,
  number: string | null,
): Question | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const direct = structureOcrText(trimmed, page).filter((question) => question.stem.trim());
  if (direct.length > 1) return null;
  if (direct.length === 1) return { ...direct[0]!, number: direct[0]!.number ?? number };
  if (!number) return null;
  const prefixed = structureOcrText(`${number}. ${trimmed}`, page).filter((question) =>
    question.stem.trim(),
  );
  if (prefixed.length !== 1) return null;
  return { ...prefixed[0]!, number: prefixed[0]!.number ?? number };
}

function needsReread(flags: readonly ReadFlag[]): boolean {
  return flags.some((flag) => REREAD_FLAGS.includes(flag));
}

function alternateEngine(
  source: string,
  ocrSpaceKey: string | undefined,
): "local" | "ocrspace" | null {
  if (source === "ocrspace") return "local";
  if (ocrSpaceKey?.trim()) return "ocrspace";
  return null;
}

async function readAlternate(
  engine: "local" | "ocrspace",
  imageDataUrl: string,
  input: RepairInput,
): Promise<string> {
  if (engine === "local") {
    const readLocal = input.readLocalText ?? defaultLocalText;
    return readLocal(imageDataUrl);
  }
  const key = input.ocrSpaceKey?.trim() ?? "";
  const readRemote =
    input.readOcrSpaceText ??
    ((apiKey: string, image: string) =>
      ocrSpaceText(apiKey, image).then((reading) => reading.text));
  return readRemote(key, imageDataUrl);
}

async function defaultLocalText(imageDataUrl: string): Promise<string> {
  const result = await readOpenOcrPage(imageDataUrl);
  return result.blocks
    .map((block) => block.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}
