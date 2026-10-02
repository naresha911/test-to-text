import { describe, expect, test } from "bun:test";

import {
  chatCompletionBody,
  completeChatWithFallback,
  generationChatTargets,
  OMNIROUTERS_AUTO_MODEL,
  omniroutersApiKey,
  resolveOmniroutersModel,
} from "@/lib/generation/chat-provider";

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
    expect(omniroutersApiKey({ OMNIROUTERS_API_KEY: "official", OMNIROUTER_API_KEY: "alias" })).toBe(
      "official",
    );
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

  test("the next provider is used when OmniRouters fails", async () => {
    const targets = generationChatTargets({
      ...shared,
      omniroutersKey: "omni-key",
      openRouterKey: "or-key",
    });
    const used: string[] = [];
    const text = await completeChatWithFallback(targets, async (target) => {
      used.push(target.provider);
      if (target.provider === "omnirouters") throw new Error("busy");
      return "ok";
    }, "missing");
    expect(text).toBe("ok");
    expect(used).toEqual(["omnirouters", "openrouter"]);
  });
});
