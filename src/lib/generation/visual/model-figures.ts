import { ensureSvgRootAttributes, sanitizeSvg } from "@/lib/assets/svg-sanitize";
import type { AssetRef, AssetStore } from "@/lib/assets/types";
import { assetIdFor } from "@/lib/generation/job-types";
import type { Question } from "@/lib/question-schema";

/** A model figure bigger than this is dropped rather than stored. */
const MAX_SVG_CHARS = 200_000;

function cleanSvg(value: string | null | undefined): string | null {
  const svg = value?.trim();
  if (!svg || svg.length > MAX_SVG_CHARS || !svg.includes("<svg")) return null;
  try {
    return ensureSvgRootAttributes(sanitizeSvg(svg));
  } catch {
    return null;
  }
}

async function storeFile(input: {
  svg: string;
  store: AssetStore;
  documentId: string;
  questionId: string;
  assetKey: string;
  role: "question_figure" | "option_figure";
}): Promise<AssetRef | null> {
  try {
    return await input.store.put({
      asset_id: assetIdFor(input.questionId, input.assetKey),
      kind: "generated",
      role: input.role,
      mime_type: "image/svg+xml",
      bytes: new TextEncoder().encode(input.svg),
      document_id: input.documentId,
      question_id: input.questionId,
      generation_method: "svg",
      spec_version: "model-figure-1",
    });
  } catch {
    return null;
  }
}

/**
 * Keep the model's figure drawings on the question as sanitized SVG text (for
 * exam-prep) and, when the local store accepts it, also write a file so the app
 * can show the picture. Figures the model only described are left alone.
 */
export async function attachModelFigures(options: {
  question: Question;
  store: AssetStore;
  documentId: string;
}): Promise<Question> {
  let changed = false;

  const figures = await Promise.all(
    options.question.figures.map(async (figure, index) => {
      const raw = figure.image_path ? null : figure.svg?.trim();
      if (!raw) return figure;
      const clean = cleanSvg(raw);
      if (!clean) {
        changed = true;
        return { ...figure, svg: null };
      }
      changed = true;
      const ref = await storeFile({
        svg: clean,
        store: options.store,
        documentId: options.documentId,
        questionId: options.question.id,
        assetKey: `figure-${index}`,
        role: figure.role === "option_figure" ? "option_figure" : "question_figure",
      });
      return {
        ...figure,
        svg: clean,
        ...(ref
          ? {
              image_path: ref.storage_key,
              asset_id: ref.asset_id,
              generation_method: "svg" as const,
            }
          : {}),
      };
    }),
  );

  const nextOptions = await Promise.all(
    options.question.options.map(async (option, index) => {
      const raw = option.image_path ? null : option.svg?.trim();
      if (!raw) return option;
      const clean = cleanSvg(raw);
      if (!clean) {
        changed = true;
        return { ...option, svg: null };
      }
      changed = true;
      const ref = await storeFile({
        svg: clean,
        store: options.store,
        documentId: options.documentId,
        questionId: options.question.id,
        assetKey: `option-${option.key || index}`,
        role: "option_figure",
      });
      return {
        ...option,
        svg: clean,
        ...(ref ? { image_path: ref.storage_key } : {}),
        image_description: option.image_description ?? `Option ${option.key || index + 1}`,
      };
    }),
  );

  const sub_questions = await Promise.all(
    options.question.sub_questions.map((sub) =>
      attachModelFigures({
        question: sub,
        store: options.store,
        documentId: options.documentId,
      }),
    ),
  );
  if (sub_questions.some((sub, index) => sub !== options.question.sub_questions[index])) {
    changed = true;
  }

  if (!changed) return options.question;
  return { ...options.question, figures, options: nextOptions, sub_questions };
}
