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

/**
 * Command Code Provider API (https://api.commandcode.ai/provider/v1).
 * Text questions ride the free routes, cheapest and most available first.
 * `/provider/v1/models` lists the live ids; never invent one.
 */
export const COMMAND_CODE_TEXT_MODEL = "inclusionai/ling-3.1-flash:free";

export const COMMAND_CODE_TEXT_MODELS = [
  "inclusionai/ling-3.1-flash:free",
  "inclusionai/ling-3.0-flash-sante:free",
  "poolside/laguna-s-2.1-free",
  "stealth/space-bunny-alpha",
] as const;

/**
 * Diagram questions need a vision model, and none of the free routes accept
 * images. These are the Command Code vision-capable routes.
 */
export const COMMAND_CODE_VISION_MODELS = [
  "deepseek/deepseek-v4-flash-vision-exp",
  "Qwen/Qwen3.8-Omni-Flash",
] as const;
