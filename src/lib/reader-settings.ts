import { DEFAULT_OPENROUTER_MODEL, type ReaderEngine } from "@/lib/extract.functions";

export type ReaderSettings = {
  engine: ReaderEngine;
  model: string;
  apiKeys?: Partial<Record<ReaderEngine, string>>;
};

export const READER_KEY_ENGINES = ["openrouter", "optiic", "ocrspace"] as const satisfies readonly ReaderEngine[];

export const READER_LABELS: Record<ReaderEngine, string> = {
  lovable: "Built-in AI reader",
  openrouter: "OpenRouter (your key)",
  optiic: "Optiic (your key)",
  ocrspace: "OCR.space (free key)",
};

export const READER_NOTES: Record<ReaderEngine, string> = {
  lovable: "Uses this workspace's included AI credits. Reads maths and diagrams directly from the page.",
  openrouter:
    "Most accurate for maths, diagrams and puzzle figures. Uses your own OpenRouter key and its free or paid models.",
  optiic:
    "Plain-text OCR with a generous free tier. Figures are not returned, so diagram questions come back as text only. A language model then splits questions, options, and comprehension passages.",
  ocrspace:
    "Free OCR.space key. Plain text only, 1 MB per page, 25,000 requests a month. Figures are not returned, so diagram questions come back as text only. A language model then splits questions, options, and comprehension passages.",
};

const STORAGE_KEY = "paperparse.reader";

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  engine: "lovable",
  model: DEFAULT_OPENROUTER_MODEL,
};

const VALID_ENGINES: ReaderEngine[] = ["lovable", "openrouter", "optiic", "ocrspace"];

export function loadReaderSettings(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULT_READER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    const apiKeys = parsed.apiKeys && typeof parsed.apiKeys === "object" ? parsed.apiKeys : {};
    return {
      engine: VALID_ENGINES.includes(parsed.engine as ReaderEngine)
        ? (parsed.engine as ReaderEngine)
        : "lovable",
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model : DEFAULT_OPENROUTER_MODEL,
      apiKeys: Object.fromEntries(
        READER_KEY_ENGINES.filter((engine) => typeof apiKeys[engine] === "string").map((engine) => [
          engine,
          (apiKeys[engine] as string).trim(),
        ]),
      ) as Partial<Record<ReaderEngine, string>>,
    };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
