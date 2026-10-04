/** Vision models for diagram questions. Text models are not a fallback for these. */
export const OMNI_VISION_MODELS = ["gemini-2.5-flash", "google/gemini-2.5-flash"] as const;

export const OPENROUTER_VISION_MODELS = [
  "google/gemini-2.5-flash",
  "qwen/qwen2.5-vl-32b-instruct",
] as const;

export const TEXT_EXAM_MODEL = "google/gemma-4-26b-a4b-it:free";

export const TEXT_EXAM_FALLBACKS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
] as const;
