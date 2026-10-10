import { createServerFn } from "@tanstack/react-start";

export type AiGenerationKind =
  | "ocr_page"
  | "ocr_crop"
  | "ocr_structure"
  | "ocr_service"
  | "layout_service"
  | "hint_solution"
  | "mock_grammar"
  | "mock_figure"
  | "mock_author"
  | "calibration_generate"
  | "calibration_grammar"
  | "calibration_judge"
  | "other";

export type AiGenerationContext = {
  kind: AiGenerationKind;
  label?: string;
};

export type AiGenerationRecord = {
  id: number;
  kind: AiGenerationKind;
  label: string;
  provider: string;
  model: string;
  status: "running" | "success" | "failed";
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  error: string | null;
  input: string;
  output: string;
};

export const AI_GENERATION_KIND_LABELS: Record<AiGenerationKind, string> = {
  ocr_page: "Page OCR",
  ocr_crop: "Crop read",
  ocr_structure: "OCR structure",
  ocr_service: "OCR service",
  layout_service: "Layout service",
  hint_solution: "Hint & solution",
  mock_grammar: "Mock grammar",
  mock_figure: "Mock figure",
  mock_author: "Mock author",
  calibration_generate: "Calibration generate",
  calibration_grammar: "Calibration grammar",
  calibration_judge: "Calibration judge",
  other: "AI call",
};

const MAX_RECORDS = 200;
const MAX_FIELD_LENGTH = 60_000;

type AiGenerationStore = {
  nextId: number;
  records: AiGenerationRecord[];
};

/**
 * TanStack Start compiles each `createServerFn` handler into its own provider
 * module, so this file is instantiated twice on the server: once for the app
 * (which records runs) and once for the handler that serves the log. Anchor the
 * store on `globalThis` so both copies share one list.
 */
const globalScope = globalThis as unknown as {
  __aiGenerationLogStore?: AiGenerationStore;
};
const store: AiGenerationStore = (globalScope.__aiGenerationLogStore ??= {
  nextId: 1,
  records: [],
});

function truncate(text: string): string {
  return text.length > MAX_FIELD_LENGTH
    ? `${text.slice(0, MAX_FIELD_LENGTH)}\n…[truncated ${text.length - MAX_FIELD_LENGTH} chars]`
    : text;
}

/** Replaces image payloads so the log never stores base64 blobs. */
function elideImages(value: unknown): unknown {
  if (typeof value === "string") {
    return value.startsWith("data:") ? "[image elided]" : value;
  }
  if (Array.isArray(value)) return value.map(elideImages);
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (
        key === "image_url" &&
        item &&
        typeof item === "object" &&
        "url" in (item as Record<string, unknown>)
      ) {
        next[key] = { url: "[image elided]" };
      } else {
        next[key] = elideImages(item);
      }
    }
    return next;
  }
  return value;
}

function stringifyAiInput(messages: unknown): string {
  try {
    return truncate(JSON.stringify(elideImages(messages)));
  } catch {
    return "[unserializable input]";
  }
}

function startAiGeneration(input: {
  kind: AiGenerationKind;
  label?: string | undefined;
  provider: string;
  model: string;
  input: string;
}): number {
  const id = store.nextId++;
  store.records.push({
    id,
    kind: input.kind,
    label: input.label ?? "",
    provider: input.provider,
    model: input.model,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    durationMs: null,
    error: null,
    input: input.input,
    output: "",
  });
  if (store.records.length > MAX_RECORDS) {
    store.records.splice(0, store.records.length - MAX_RECORDS);
  }
  return id;
}

function finishAiGeneration(id: number, result: { output: string; durationMs: number }) {
  const record = store.records.find((entry) => entry.id === id);
  if (!record) return;
  record.status = "success";
  record.output = truncate(result.output);
  record.finishedAt = Date.now();
  record.durationMs = result.durationMs;
}

function failAiGeneration(id: number, result: { error: string; durationMs: number }) {
  const record = store.records.find((entry) => entry.id === id);
  if (!record) return;
  record.status = "failed";
  record.error = truncate(result.error);
  record.finishedAt = Date.now();
  record.durationMs = result.durationMs;
}

/**
 * Records one AI attempt (one provider target) with its model, input messages
 * and raw output. Without a context the call runs unlogged.
 */
export async function logAiAttempt<Target extends { model: string; label: string }>(
  target: Target,
  context: AiGenerationContext | undefined,
  input: unknown,
  run: () => Promise<string>,
): Promise<string> {
  return logAiCall(target, context, stringifyAiInput(input), run, (text) => text);
}

/** Same as logAiAttempt, for calls whose result is not a string. */
export async function logAiCall<Target extends { model: string; label: string }, Result>(
  target: Target,
  context: AiGenerationContext | undefined,
  input: string,
  run: () => Promise<Result>,
  output: (result: Result) => string,
): Promise<Result> {
  if (!context) return run();
  const id = startAiGeneration({
    kind: context.kind,
    label: context.label,
    provider: target.label,
    model: target.model,
    input,
  });
  const startedAt = Date.now();
  try {
    const result = await run();
    finishAiGeneration(id, {
      output: output(result),
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    failAiGeneration(id, {
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

/** Every recorded AI generation, newest last. Cleared on server restart. */
export const getAiGenerationLog = createServerFn({ method: "GET" }).handler(
  async (): Promise<AiGenerationRecord[]> => store.records.map((record) => ({ ...record })),
);

export const clearAiGenerationLog = createServerFn({ method: "POST" })
  .validator(() => true)
  .handler(async (): Promise<void> => {
    store.records.length = 0;
  });
