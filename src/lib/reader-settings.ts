import { DEFAULT_OPENROUTER_MODEL, type ReaderEngine } from "@/lib/extract.functions";

export type ReaderSettings = {
  engine: ReaderEngine;
  model: string;
};

export const READER_LABELS: Record<ReaderEngine, string> = {
  lovable: "Built-in AI reader",
  openrouter: "OpenRouter (your key)",
  vision: "Google Cloud Vision (your key)",
  optiic: "Optiic (your key)",
};

export const READER_NOTES: Record<ReaderEngine, string> = {
  lovable: "Uses this workspace's included AI credits. Reads maths and diagrams directly from the page.",
  openrouter:
    "Most accurate for maths, diagrams and puzzle figures. Uses your own OpenRouter key and its free or paid models.",
  vision:
    "Very strong plain-text accuracy, but it cannot see figures, so diagram questions come back as text only.",
  optiic:
    "Plain-text OCR with a generous free tier. Figures are not returned, so diagram questions come back as text only.",
};

const STORAGE_KEY = "paperparse.reader";

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  engine: "lovable",
  model: DEFAULT_OPENROUTER_MODEL,
};

const VALID_ENGINES: ReaderEngine[] = ["lovable", "openrouter", "vision", "optiic"];

export function loadReaderSettings(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULT_READER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      engine: VALID_ENGINES.includes(parsed.engine as ReaderEngine)
        ? (parsed.engine as ReaderEngine)
        : "lovable",
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model : DEFAULT_OPENROUTER_MODEL,
    };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
