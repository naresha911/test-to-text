/** OpenAI-compatible chat route documented at https://docs.omnirouters.com/api/llm/openai-chat */
export const DEFAULT_OMNIROUTERS_BASE_URL = "https://omnirouters.com/v1";
/**
 * OmniRoute / OmniRouters selector. The gateway chooses an available model and
 * falls back internally. This is not a pinned model id.
 */
export const OMNIROUTERS_AUTO_MODEL = "auto";

export type GenerationProvider = "omnirouters" | "openrouter" | "lovable";

export type GenerationChatTarget = {
  provider: GenerationProvider;
  label: string;
  url: string;
  headers: Record<string, string>;
  /**
   * For OmniRouters this is `auto` unless OMNIROUTERS_MODEL names a real model.
   * OpenRouter and Lovable always send a concrete model id.
   */
  model: string;
  models?: string[];
};

export function omniroutersApiKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env["OMNIROUTERS_API_KEY"]?.trim() || env["OMNIROUTER_API_KEY"]?.trim() || undefined;
}

function isOpenRouterOnlyModel(model: string): boolean {
  return model.includes(":free") || model.startsWith("openrouter/");
}

/**
 * Ask OmniRouters to choose an available model.
 * A concrete id is sent only when OMNIROUTERS_MODEL names one. OpenRouter-only ids stay on OpenRouter.
 */
export function resolveOmniroutersModel(configured: string | null | undefined): string {
  const candidate = configured?.trim();
  if (!candidate || isOpenRouterOnlyModel(candidate) || candidate === OMNIROUTERS_AUTO_MODEL) {
    return OMNIROUTERS_AUTO_MODEL;
  }
  return candidate;
}

export function chatCompletionBody(input: {
  model?: string | null;
  models?: readonly string[] | null;
  messages: unknown;
  maxTokens: number;
  /** Page reading stays streamed. Hint/solution uses one JSON response. */
  stream?: boolean;
}): Record<string, unknown> {
  const model = input.model?.trim();
  return {
    ...(model ? { model } : {}),
    ...(input.models?.length ? { models: [...input.models] } : {}),
    stream: input.stream !== false,
    max_tokens: input.maxTokens,
    messages: input.messages,
  };
}

type ChatChoice = {
  delta?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown };
  message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown };
};

function contentString(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("");
}

function firstChoice(parsed: Record<string, unknown>): ChatChoice | undefined {
  const choices = parsed["choices"];
  if (!Array.isArray(choices)) return undefined;
  return choices[0] as ChatChoice | undefined;
}

/** A short provider error. Long bodies are often the prompt echoed back, which is not useful in a toast. */
export function providerFailureMessage(body: string, status: number, label: string): string {
  const text = errorText(body);
  if (!text || text.length > 400) return `${label} failed (${status}). Try again.`;
  return text;
}

function errorText(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    if (typeof parsed.error === "string") return parsed.error.trim();
    if (
      parsed.error &&
      typeof parsed.error === "object" &&
      typeof parsed.error.message === "string"
    ) {
      return parsed.error.message.trim();
    }
    if (typeof parsed.message === "string") return parsed.message.trim();
  } catch {
    /* plain text */
  }
  return trimmed;
}

function throwIfProviderError(parsed: Record<string, unknown>): void {
  if (parsed["error"] == null) return;
  throw new Error(providerFailureMessage(JSON.stringify(parsed), 200, "The AI provider"));
}

function pickAnswer(content: string, reasoning: string): string {
  if (content.trim()) return content;
  if (/"hint"\s*:/.test(reasoning) || /"explanation"\s*:/.test(reasoning)) return reasoning;
  return "";
}

function textFromCompletion(parsed: Record<string, unknown>): string {
  throwIfProviderError(parsed);
  const choice = firstChoice(parsed);
  const content = contentString(choice?.message?.content ?? choice?.delta?.content);
  const reasoning = contentString(
    choice?.message?.reasoning_content ??
      choice?.message?.reasoning ??
      choice?.delta?.reasoning_content ??
      choice?.delta?.reasoning,
  );
  return pickAnswer(content, reasoning);
}

/**
 * Read the assistant answer from a chat completion.
 * Accepts one JSON object or an SSE stream. Reasoning-only tokens are used only when they contain the solution JSON.
 */
export function assistantTextFromChatBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{"))
    return textFromCompletion(JSON.parse(trimmed) as Record<string, unknown>);

  let content = "";
  let reasoning = "";
  for (const line of trimmed.split("\n")) {
    const data = line.trim();
    if (!data.startsWith("data:")) continue;
    const payload = data.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload) as Record<string, unknown>;
      throwIfProviderError(chunk);
      const choice = firstChoice(chunk);
      content += contentString(choice?.delta?.content);
      content += contentString(choice?.message?.content);
      reasoning += contentString(choice?.delta?.reasoning_content ?? choice?.delta?.reasoning);
      reasoning += contentString(choice?.message?.reasoning_content ?? choice?.message?.reasoning);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return pickAnswer(content, reasoning);
}

/** Try OmniRouters, then OpenRouter, then Lovable. A single configured target rethrows its own error. */
export async function completeChatWithFallback(
  targets: GenerationChatTarget[],
  send: (target: GenerationChatTarget) => Promise<string>,
  noneConfigured: string,
): Promise<string> {
  if (targets.length === 0) throw new Error(noneConfigured);
  const failures: string[] = [];
  for (const target of targets) {
    try {
      return await send(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${target.label} failed (${message})`);
      if (targets.length === 1) throw error;
    }
  }
  throw new Error(failures.join(". "));
}

export function generationChatTargets(input: {
  omniroutersKey?: string | null;
  openRouterKey?: string | null;
  lovableKey?: string | null;
  requestedModel?: string | null;
  omniroutersModel?: string | null;
  omniroutersBaseUrl?: string | null;
  openRouterModel: string;
  openRouterFallbacks: readonly string[];
  lovableModel: string;
}): GenerationChatTarget[] {
  const targets: GenerationChatTarget[] = [];
  const omniKey = input.omniroutersKey?.trim();
  if (omniKey) {
    const base = (input.omniroutersBaseUrl?.trim() || DEFAULT_OMNIROUTERS_BASE_URL).replace(
      /\/$/,
      "",
    );
    targets.push({
      provider: "omnirouters",
      label: "OmniRouters",
      url: `${base}/chat/completions`,
      headers: { Authorization: `Bearer ${omniKey}` },
      model: resolveOmniroutersModel(input.omniroutersModel),
    });
  }

  const openRouterKey = input.openRouterKey?.trim();
  if (openRouterKey) {
    const model = input.requestedModel?.trim() || input.openRouterModel;
    targets.push({
      provider: "openrouter",
      label: "OpenRouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { Authorization: `Bearer ${openRouterKey}` },
      model,
      models: [model, ...input.openRouterFallbacks.filter((candidate) => candidate !== model)],
    });
  }

  const lovableKey = input.lovableKey?.trim();
  if (lovableKey) {
    targets.push({
      provider: "lovable",
      label: "The built-in AI reader",
      url: "https://ai.gateway.lovable.dev/v1/chat/completions",
      headers: {
        "Lovable-API-Key": lovableKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      model: input.lovableModel,
    });
  }

  return targets;
}
