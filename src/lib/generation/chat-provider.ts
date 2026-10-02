/** OpenAI-compatible chat route documented at https://docs.omnirouters.com/api/llm/openai-chat */
export const DEFAULT_OMNIROUTERS_BASE_URL = "https://omnirouters.com/v1";
export const DEFAULT_OMNIROUTERS_MODEL = "gemini-2.5-flash";

export type GenerationProvider = "omnirouters" | "openrouter" | "lovable";

export type GenerationChatTarget = {
  provider: GenerationProvider;
  label: string;
  url: string;
  headers: Record<string, string>;
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

export function resolveOmniroutersModel(
  requested: string | null | undefined,
  configured: string | null | undefined,
): string {
  const candidate = requested?.trim();
  if (candidate && !isOpenRouterOnlyModel(candidate)) return candidate;
  return configured?.trim() || DEFAULT_OMNIROUTERS_MODEL;
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
      model: resolveOmniroutersModel(input.requestedModel, input.omniroutersModel),
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
