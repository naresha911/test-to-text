import { describe, expect, test } from "bun:test";

import {
  assistantTextFromChatBody,
  chatCompletionBody,
  commandCodeApiKey,
  commandCodeChatTargets,
  completeChatWithFallback,
  DEFAULT_COMMANDCODE_BASE_URL,
  generationChatTargets,
  OMNIROUTERS_AUTO_MODEL,
  omniroutersApiKey,
  providerFailureMessage,
  resolveOmniroutersModel,
} from "@/lib/generation/chat-provider";
import { COMMAND_CODE_TEXT_MODELS } from "@/lib/generation/vision-models";

const shared = {
  openRouterModel: "google/gemma-4-26b-a4b-it:free",
  openRouterFallbacks: ["google/gemma-4-26b-a4b-it:free", "openrouter/free"],
  lovableModel: "google/gemini-3.8-flash",
};

describe("generation chat providers", () => {
  test("OmniRouters is first and asks the gateway to choose a model", () => {
    const targets = generationChatTargets({
      ...shared,
      omniroutersKey: "omni-key",
      openRouterKey: "or-key",
      lovableKey: "lovable-key",
    });
    expect(targets.map((target) => target.provider)).toEqual([
      "omnirouters",
      "openrouter",
      "lovable",
    ]);
    expect(targets[0]?.url).toBe("https://omnirouters.com/v1/chat/completions");
    expect(targets[0]?.model).toBe(OMNIROUTERS_AUTO_MODEL);
    expect(targets[0]?.headers.Authorization).toBe("Bearer omni-key");
    expect(targets[0]?.models).toBeUndefined();
  });

  test("Command Code is preferred and leads with the free models when a key is set", () => {
    const targets = generationChatTargets({
      ...shared,
      commandCodeKey: "cmd-key",
      openRouterKey: "or-key",
    });
    expect(targets[0]?.provider).toBe("commandcode");
    expect(targets[0]?.url).toBe(`${DEFAULT_COMMANDCODE_BASE_URL}/chat/completions`);
    expect(targets[0]?.headers["Authorization"]).toBe("Bearer cmd-key");
    expect(targets.filter((target) => target.provider === "commandcode").map((t) => t.model)).toEqual(
      [...COMMAND_CODE_TEXT_MODELS],
    );
  });

  test("no Command Code target appears without a key", () => {
    const targets = generationChatTargets({ ...shared, openRouterKey: "or-key" });
    expect(targets.some((target) => target.provider === "commandcode")).toBe(false);
  });

  test("a Command Code base url is trimmed to the endpoint root", () => {
    const [target] = commandCodeChatTargets({
      key: "k",
      baseUrl: "http://127.0.0.1:9000/v1/",
      models: ["a-model"],
    });
    expect(target?.url).toBe("http://127.0.0.1:9000/v1/chat/completions");
    expect(target?.model).toBe("a-model");
  });

  test("either env name supplies the Command Code key", () => {
    expect(commandCodeApiKey({ CMD_API_KEY: " from-alias " })).toBe("from-alias");
    expect(commandCodeApiKey({ COMMANDCODE_API_KEY: "official", CMD_API_KEY: "alias" })).toBe(
      "official",
    );
  });

  test("OpenRouter-only model ids stay on the OpenRouter fallback", () => {
    const targets = generationChatTargets({
      ...shared,
      omniroutersKey: "omni-key",
      openRouterKey: "or-key",
      requestedModel: "google/gemma-4-26b-a4b-it:free",
      omniroutersModel: "openrouter/free",
    });
    expect(targets[0]?.model).toBe(OMNIROUTERS_AUTO_MODEL);
    expect(targets[1]?.model).toBe("google/gemma-4-26b-a4b-it:free");
    expect(targets[1]?.models).toContain("openrouter/free");
  });

  test("OmniRouters stays on auto unless a concrete env model is set", () => {
    expect(resolveOmniroutersModel(undefined)).toBe(OMNIROUTERS_AUTO_MODEL);
    expect(resolveOmniroutersModel("auto")).toBe(OMNIROUTERS_AUTO_MODEL);
    expect(resolveOmniroutersModel("gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(resolveOmniroutersModel("google/gemma-4-26b-a4b-it:free")).toBe(OMNIROUTERS_AUTO_MODEL);
  });

  test("either env name supplies the OmniRouters key", () => {
    expect(omniroutersApiKey({ OMNIROUTER_API_KEY: " from-alias " })).toBe("from-alias");
    expect(
      omniroutersApiKey({ OMNIROUTERS_API_KEY: "official", OMNIROUTER_API_KEY: "alias" }),
    ).toBe("official");
  });

  test("the auto selector is sent and a missing model is omitted", () => {
    expect(
      chatCompletionBody({
        model: OMNIROUTERS_AUTO_MODEL,
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
      }).model,
    ).toBe("auto");
    expect(
      chatCompletionBody({
        model: null,
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
      }),
    ).not.toHaveProperty("model");
  });

  test("hint requests can ask for one JSON response instead of a stream", () => {
    expect(
      chatCompletionBody({
        model: "auto",
        messages: [],
        maxTokens: 100,
        stream: false,
      }).stream,
    ).toBe(false);
    expect(chatCompletionBody({ model: "auto", messages: [], maxTokens: 100 }).stream).toBe(true);
  });

  test("a normal completion is read from message content, not the reasoning trace", () => {
    const text = assistantTextFromChatBody(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{"hint":"Look at word order.","explanation":"Option B."}',
              reasoning_content: "The model thought for a while.",
            },
          },
        ],
      }),
    );
    expect(text).toContain('"hint":"Look at word order."');
    expect(text).not.toContain("thought for a while");
  });

  test("a stream that only sends reasoning is kept when it holds the solution JSON", () => {
    const text = assistantTextFromChatBody(
      [
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '{"hint":"nudge",' } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '"explanation":"done"}' } }] })}`,
        "data: [DONE]",
      ].join("\n"),
    );
    expect(text).toContain('"explanation":"done"');
  });

  test("an echoed instruction block is not shown as the error", () => {
    const prompt = `You are an expert exam tutor. ${"rule ".repeat(80)}`;
    expect(
      providerFailureMessage(JSON.stringify({ error: { message: prompt } }), 500, "OmniRouters"),
    ).toBe("OmniRouters failed (500). Try again.");
    expect(
      providerFailureMessage(
        JSON.stringify({ error: { message: "Model is overloaded." } }),
        503,
        "OmniRouters",
      ),
    ).toBe("Model is overloaded.");
  });

  test("a stream error is raised instead of an empty answer", () => {
    expect(() =>
      assistantTextFromChatBody('data: {"error":{"message":"Model is overloaded."}}\n'),
    ).toThrow("Model is overloaded.");
  });

  test("the next provider is used when OmniRouters fails", async () => {
    const targets = generationChatTargets({
      ...shared,
      omniroutersKey: "omni-key",
      openRouterKey: "or-key",
    });
    const used: string[] = [];
    const text = await completeChatWithFallback(
      targets,
      async (target) => {
        used.push(target.provider);
        if (target.provider === "omnirouters") throw new Error("busy");
        return "ok";
      },
      "missing",
    );
    expect(text).toBe("ok");
    expect(used).toEqual(["omnirouters", "openrouter"]);
  });
});
