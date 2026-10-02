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
}): Record<string, unknown> {
  const model = input.model?.trim();
  return {
    ...(model ? { model } : {}),
    ...(input.models?.length ? { models: [...input.models] } : {}),
    stream: true,
    max_tokens: input.maxTokens,
    messages: input.messages,
  };
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
