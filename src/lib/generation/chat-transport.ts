import {
  chatCompletionBody,
  commandCodeApiKey,
  completeChatWithFallback,
  generationChatTargets,
  omniroutersApiKey,
} from "@/lib/generation/chat-provider";
import { logAiAttempt, type AiGenerationContext } from "@/lib/ai-generation-log";
import {
  COMMAND_CODE_TEXT_MODELS,
  COMMAND_CODE_VISION_MODELS,
} from "@/lib/generation/vision-models";

/** OpenRouter fallback when OmniRouters is unset or fails. models[] lets OpenRouter try the next free route. */
export const DEFAULT_MOCK_MODEL = "google/gemma-4-26b-a4b-it:free";
export const MOCK_MODEL_FALLBACKS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
] as const;
export const LOVABLE_MOCK_MODEL = "google/gemini-3.8-flash";

export const NO_PROVIDER_MESSAGE =
  "No AI key is configured. Add COMMANDCODE_API_KEY, OMNIROUTERS_API_KEY, OPENROUTER_API_KEY, or LOVABLE_API_KEY in .env.local (or Lovable project secrets), then restart the server.";

export type GenerationChatMessage = { role: "system" | "user"; content: string | unknown[] };

/** The provider keys available to the generation transport, cheapest first. */
export function generationKeys(): {
  commandCodeKey: string | undefined;
  omniroutersKey: string | undefined;
  openRouterKey: string | undefined;
  lovableKey: string | undefined;
} {
  return {
    commandCodeKey: commandCodeApiKey(),
    omniroutersKey: omniroutersApiKey(),
    openRouterKey: process.env["OPENROUTER_API_KEY"],
    lovableKey: process.env["LOVABLE_API_KEY"],
  };
}

export function hasGenerationKey(): boolean {
  const keys = generationKeys();
  return Boolean(
    keys.commandCodeKey || keys.omniroutersKey || keys.openRouterKey || keys.lovableKey,
  );
}

/** Streaming chat call against one OpenAI-compatible target. */
export async function callChat(options: {
  url: string;
  headers: Record<string, string>;
  model?: string | null;
  models?: string[];
  messages: GenerationChatMessage[];
  label: string;
  maxTokens?: number;
}): Promise<string> {
  const timeoutMs = Number(process.env["AI_CHAT_TIMEOUT_MS"]) || 60_000;
  const response = await fetch(options.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(
      chatCompletionBody({
        ...(options.model != null ? { model: options.model } : {}),
        ...(options.models ? { models: options.models } : {}),
        messages: options.messages,
        maxTokens: options.maxTokens ?? 6000,
      }),
    ),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    let message = body;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
      message = parsed.error?.message ?? parsed.message ?? body;
    } catch {
      /* keep raw */
    }
    if (response.status === 429) {
      throw new Error(`${options.label} is busy or rate limited. Wait a moment and try again.`);
    }
    if (response.status === 401) {
      throw new Error(`${options.label} rejected the API key. Check the key in Settings.`);
    }
    if (response.status === 402 || response.status === 403) {
      throw new Error(`AI_CREDITS: ${message || `${options.label} has no credits left.`}`);
    }
    throw new Error(message || `${options.label} failed (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let raw = "";
  let sawDataLine = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const decoded = decoder.decode(value, { stream: true });
      buffer += decoded;
      raw += decoded;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        sawDataLine = true;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let chunk: {
          choices?: { delta?: { content?: string } }[];
          error?: { message?: string } | string;
        } | null = null;
        try {
          chunk = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
            error?: { message?: string } | string;
          };
        } catch {
          /* ignore keep-alive */
          continue;
        }
        if (chunk.error) {
          throw new Error(
            typeof chunk.error === "string"
              ? chunk.error
              : chunk.error.message || `${options.label} returned an error`,
          );
        }
        text += chunk.choices?.[0]?.delta?.content ?? "";
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }

  // Providers that ignore `stream: true` answer with a plain JSON completion.
  if (!text && !sawDataLine && raw.trim()) {
    try {
      const completion = JSON.parse(raw) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = completion.choices?.[0]?.message?.content;
      if (content) return content;
    } catch {
      /* not a non-streaming completion */
    }
  }

  if (!text) {
    throw new Error(`${options.label} returned an unreadable response.`);
  }
  return text;
}

/**
 * Walk the provider router (Command Code free → OmniRouters → OpenRouter → Lovable),
 * falling back when one target fails. Shared by mock generation and calibration.
 */
export async function completeGenerationChat(input: {
  messages: GenerationChatMessage[];
  vision?: boolean;
  requestedModel?: string | null;
  /** When set, every provider attempt is recorded in the AI generation log. */
  context?: AiGenerationContext;
}): Promise<string> {
  const key = generationKeys();
  const requestedModel = input.requestedModel?.trim();
  const commandCodeModels: readonly string[] = input.vision
    ? COMMAND_CODE_VISION_MODELS
    : COMMAND_CODE_TEXT_MODELS;
  const targets = generationChatTargets({
    omniroutersKey: key.omniroutersKey ?? null,
    openRouterKey: key.openRouterKey ?? null,
    lovableKey: key.lovableKey ?? null,
    commandCodeKey: key.commandCodeKey ?? null,
    commandCodeBaseUrl: process.env["COMMANDCODE_BASE_URL"] ?? null,
    commandCodeModels:
      requestedModel && !requestedModel.includes(":free")
        ? [requestedModel, ...commandCodeModels.filter((model) => model !== requestedModel)]
        : commandCodeModels,
    requestedModel: requestedModel ?? null,
    omniroutersModel: process.env["OMNIROUTERS_MODEL"] ?? null,
    omniroutersBaseUrl: process.env["OMNIROUTERS_BASE_URL"] ?? null,
    openRouterModel: DEFAULT_MOCK_MODEL,
    openRouterFallbacks: MOCK_MODEL_FALLBACKS,
    lovableModel: LOVABLE_MOCK_MODEL,
  });
  const context = input.context;
  return completeChatWithFallback(
    targets,
    (target) =>
      logAiAttempt(target, context, input.messages, () =>
        callChat({
          url: target.url,
          headers: target.headers,
          model: target.model,
          ...(target.models ? { models: target.models } : {}),
          messages: input.messages,
          label: target.label,
        }),
      ),
    NO_PROVIDER_MESSAGE,
  );
}
