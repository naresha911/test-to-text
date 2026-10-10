import type { AssetStore } from "@/lib/assets/types";
import { sanitizeSvg } from "@/lib/assets/svg-sanitize";
import { assetIdFor } from "@/lib/generation/job-types";
import { placeElements, renderSvg } from "@/lib/generation/assets/svg-renderer";
import type { MirrorImageSpec } from "@/lib/generation/visual/spec";
import { isMirrorImageSpec } from "@/lib/generation/visual/spec";
import type { Question, JsonValue } from "@/lib/question-schema";

function bytesOf(svg: string): Uint8Array {
  return new TextEncoder().encode(svg);
}

export function mirrorOptionSvgs(spec: MirrorImageSpec): Record<string, string> {
  const options: Record<string, string> = {};
  for (const [key, transform] of Object.entries(spec.option_transforms)) {
    const placed = placeElements(spec.elements, transform, spec.canvas);
    options[key] = sanitizeSvg(renderSvg(placed, spec.canvas));
  }
  return options;
}

export function mirrorQuestionSvg(spec: MirrorImageSpec): string {
  const placed = placeElements(spec.elements, "identity", spec.canvas);
  return sanitizeSvg(renderSvg(placed, spec.canvas));
}

export async function attachMirrorAssets(options: {
  question: Question;
  spec: MirrorImageSpec;
  store: AssetStore;
  documentId: string;
  idempotencyKey: string;
  /** "vertical mirror" (default) or "water" for a horizontal reflection. */
  label?: string;
}): Promise<Question> {
  const label = options.label ?? "vertical mirror";
  const questionSvg = mirrorQuestionSvg(options.spec);
  const optionSvgs = mirrorOptionSvgs(options.spec);
  const questionAssetId = assetIdFor(options.idempotencyKey, "question_figure");
  const questionAsset = await options.store.put({
    asset_id: questionAssetId,
    kind: "generated",
    role: "question_figure",
    mime_type: "image/svg+xml",
    bytes: bytesOf(questionSvg),
    document_id: options.documentId,
    question_id: options.question.id,
    width: options.spec.canvas.width,
    height: options.spec.canvas.height,
    generation_method: "svg",
    spec_version: "mirror-image-1",
  });

  const optionsWithImages = [];
  for (const option of options.question.options) {
    const svg = optionSvgs[option.key];
    if (!svg) {
      optionsWithImages.push(option);
      continue;
    }
    const asset = await options.store.put({
      asset_id: assetIdFor(options.idempotencyKey, `option_${option.key}`),
      kind: "generated",
      role: "option_figure",
      mime_type: "image/svg+xml",
      bytes: bytesOf(svg),
      document_id: options.documentId,
      question_id: options.question.id,
      width: options.spec.canvas.width,
      height: options.spec.canvas.height,
      generation_method: "svg",
      source_asset_id: questionAsset.asset_id,
      spec_version: "mirror-image-1",
    });
    optionsWithImages.push({
      ...option,
      text: option.text || `Figure ${option.key}`,
      image_path: asset.storage_key,
      image_description: `${label} choice ${option.key}`,
    });
  }

  return {
    ...options.question,
    visual_spec: options.spec as unknown as { [key: string]: JsonValue },
    figures: [
      {
        id: questionAsset.asset_id,
        description: `Asymmetric figure. Choose its ${label} image.`,
        caption: null,
        bbox: null,
        page: null,
        image_path: questionAsset.storage_key,
        role: "question_figure",
        generation_method: "svg",
        asset_id: questionAsset.asset_id,
      },
    ],
    options: optionsWithImages,
  };
}

export async function redrawMirrorFigure(options: {
  question: Question;
  store: AssetStore;
  documentId: string;
  idempotencyKey: string;
}): Promise<Question> {
  const spec = options.question.visual_spec;
  if (!isMirrorImageSpec(spec)) {
    throw new Error("This question has no mirror figure to redraw.");
  }
  const stem = options.question.stem;
  const answerKeys = [...options.question.answer_keys];
  const redrawn = await attachMirrorAssets({
    question: options.question,
    spec,
    store: options.store,
    documentId: options.documentId,
    idempotencyKey: options.idempotencyKey,
    label: spec.transformation.axis === "horizontal" ? "water" : "vertical mirror",
  });
  return {
    ...redrawn,
    stem,
    answer_keys: answerKeys,
    id: options.question.id,
  };
}
