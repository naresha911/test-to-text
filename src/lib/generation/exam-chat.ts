import {
  assistantTextFromChatBody,
  chatCompletionBody,
  commandCodeApiKey,
  commandCodeChatTargets,
  DEFAULT_OMNIROUTERS_BASE_URL,
  generationChatTargets,
  omniroutersApiKey,
  providerFailureMessage,
  type GenerationChatTarget,
} from "@/lib/generation/chat-provider";
import {
  formatSnippets,
  searchWeb,
  type WebSnippet,
} from "@/lib/generation/web-search";
import {
  COMMAND_CODE_VISION_MODELS,
  OMNI_VISION_MODELS,
  OPENROUTER_VISION_MODELS,
  TEXT_EXAM_FALLBACKS,
  TEXT_EXAM_MODEL,
} from "@/lib/generation/vision-models";

export type ExamImage = {
  dataUrl: string;
  label: string;
};

export type ExamPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ExamMessage = {
  role: "system" | "user";
  content: string | ExamPart[];
};

const MAX_IMAGES = 6;

export function withImages(messages: ExamMessage[], images: ExamImage[]): ExamMessage[] {
  const usable = images.filter((image) => image.dataUrl.trim()).slice(0, MAX_IMAGES);
  if (!usable.length) return messages;
  const next = messages.map((message) => ({ ...message, content: message.content }));
  let index = next.length - 1;
  while (index >= 0 && next[index]?.role !== "user") index -= 1;
  if (index < 0) return messages;
  const current = next[index]!;
  const text =
    typeof current.content === "string"
      ? current.content
      : current.content
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("\n");
  const note = usable.map((image, order) => `${order + 1}. ${image.label}`).join("\n");
  next[index] = {
    role: "user",
    content: [
      { type: "text", text: `${text}\n\nAttached images, in this order:\n${note}` },
      ...usable.map((image) => ({
        type: "image_url" as const,
        image_url: { url: image.dataUrl },
      })),
    ],
  };
  return next;
}

export function examChatTargets(input: {
  vision: boolean;
  omniroutersKey?: string | null;
  openRouterKey?: string | null;
  lovableKey?: string | null;
  commandCodeKey?: string | null | undefined;
  commandCodeBaseUrl?: string | null | undefined;
  omniroutersBaseUrl?: string | null;
  omniroutersModel?: string | null;
}): GenerationChatTarget[] {
  if (!input.vision) {
    return generationChatTargets({
      omniroutersKey: input.omniroutersKey,
      openRouterKey: input.openRouterKey,
      lovableKey: input.lovableKey,
      commandCodeKey: input.commandCodeKey,
      commandCodeBaseUrl: input.commandCodeBaseUrl,
      omniroutersModel: input.omniroutersModel,
      omniroutersBaseUrl: input.omniroutersBaseUrl,
      openRouterModel: TEXT_EXAM_MODEL,
      openRouterFallbacks: TEXT_EXAM_FALLBACKS,
      lovableModel: "google/gemini-2.5-flash",
    });
  }

  const targets: GenerationChatTarget[] = [];
  targets.push(
    ...commandCodeChatTargets({
      key: input.commandCodeKey,
      baseUrl: input.commandCodeBaseUrl,
      models: COMMAND_CODE_VISION_MODELS,
    }),
  );
  const omniKey = input.omniroutersKey?.trim();
  if (omniKey) {
    const base = (input.omniroutersBaseUrl?.trim() || DEFAULT_OMNIROUTERS_BASE_URL).replace(
      /\/$/,
      "",
    );
    for (const model of OMNI_VISION_MODELS) {
      targets.push({
        provider: "omnirouters",
        label: "OmniRouters",
        url: `${base}/chat/completions`,
        headers: { Authorization: `Bearer ${omniKey}` },
        model,
      });
    }
  }
  const openRouterKey = input.openRouterKey?.trim();
  if (openRouterKey) {
    const [model, ...rest] = OPENROUTER_VISION_MODELS;
    targets.push({
      provider: "openrouter",
      label: "OpenRouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { Authorization: `Bearer ${openRouterKey}` },
      model,
      models: [model, ...rest],
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
      model: "google/gemini-2.5-flash",
    });
  }
  return targets;
}

async function sendChat(target: GenerationChatTarget, messages: ExamMessage[]): Promise<string> {
  const response = await fetch(target.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...target.headers,
    },
    body: JSON.stringify(
      chatCompletionBody({
        model: target.model,
        models: target.models,
        messages,
        maxTokens: 4000,
        stream: false,
      }),
    ),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(providerFailureMessage(body, response.status, target.label));
  }
  return assistantTextFromChatBody(await response.text());
}

export type ExamChatDeps = {
  targets: (vision: boolean) => GenerationChatTarget[];
  send: (target: GenerationChatTarget, messages: ExamMessage[]) => Promise<string>;
  search: (query: string) => Promise<WebSnippet[]>;
};

function defaultDeps(): ExamChatDeps {
  return {
    targets: (vision) =>
      examChatTargets({
        vision,
        omniroutersKey: omniroutersApiKey(),
        openRouterKey: process.env["OPENROUTER_API_KEY"],
        lovableKey: process.env["LOVABLE_API_KEY"],
        commandCodeKey: commandCodeApiKey(),
        commandCodeBaseUrl: process.env["COMMANDCODE_BASE_URL"],
        omniroutersBaseUrl: process.env["OMNIROUTERS_BASE_URL"],
        omniroutersModel: process.env["OMNIROUTERS_MODEL"],
      }),
    send: sendChat,
    search: (query) =>
      searchWeb(query, {
        baseUrl: process.env["OMNIROUTERS_BASE_URL"],
        apiKey: omniroutersApiKey(),
      }),
  };
}

async function firstUsable(
  deps: ExamChatDeps,
  messages: ExamMessage[],
  vision: boolean,
  accept: (text: string) => boolean,
): Promise<{ text: string; accepted: boolean }> {
  const targets = deps.targets(vision);
  if (!targets.length) {
    throw new Error(
      "No AI key is configured. Add OMNIROUTERS_API_KEY, OPENROUTER_API_KEY, or LOVABLE_API_KEY.",
    );
  }
  let last = "";
  let lastError: Error | null = null;
  for (const target of targets) {
    try {
      const text = await deps.send(target, messages);
      last = text;
      if (accept(text)) return { text, accepted: true };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (!last && lastError) throw lastError;
  return { text: last, accepted: false };
}

/**
 * One chat completion. Diagram images select vision models.
 * A missing answer searches the web once and asks again with the same images.
 */
export async function completeExamChat(input: {
  messages: ExamMessage[];
  images?: ExamImage[];
  searchQuery?: string;
  accept: (text: string) => boolean;
  deps?: ExamChatDeps;
}): Promise<{ text: string; searched: boolean; accepted: boolean }> {
  const images = input.images ?? [];
  const vision = images.length > 0;
  const deps = input.deps ?? defaultDeps();
  const firstMessages = withImages(input.messages, images);
  const first = await firstUsable(deps, firstMessages, vision, input.accept);
  if (first.accepted) return { text: first.text, searched: false, accepted: true };

  const query = input.searchQuery?.trim() ?? "";
  if (!query) return { text: first.text, searched: false, accepted: false };
  const snippets = await deps.search(query);
  if (!snippets.length) return { text: first.text, searched: false, accepted: false };

  const retry = await firstUsable(
    deps,
    [
      ...firstMessages,
      {
        role: "user",
        content: `The first attempt did not produce a usable answer. Use these web results for the same item. Return only the requested JSON.\n\n${formatSnippets(snippets)}`,
      },
    ],
    vision,
    input.accept,
  );
  return { text: retry.text || first.text, searched: true, accepted: retry.accepted };
}
