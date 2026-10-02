import { describe, expect, test } from "bun:test";

import {
  DEFAULT_OMNIROUTERS_MODEL,
  generationChatTargets,
  omniroutersApiKey,
  resolveOmniroutersModel,
} from "@/lib/generation/chat-provider";

const shared = {
  openRouterModel: "google/gemma-4-26b-a4b-it:free",
  openRouterFallbacks: ["google/gemma-4-26b-a4b-it:free", "openrouter/free"],
  lovableModel: "google/gemini-3.8-flash",
};

describe("generation chat providers", () => {
  test("OmniRouters is the default when its key is set", () => {
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
    expect(targets[0]?.model).toBe(DEFAULT_OMNIROUTERS_MODEL);
    expect(targets[0]?.headers.Authorization).toBe("Bearer omni-key");
    expect(targets[0]?.models).toBeUndefined();
  });

  test("OpenRouter-only model ids stay on the OpenRouter fallback", () => {
    const targets = generationChatTargets({
      ...shared,
      omniroutersKey: "omni-key",
      openRouterKey: "or-key",
      requestedModel: "google/gemma-4-26b-a4b-it:free",
      omniroutersModel: "gemini-2.5-flash",
    });
    expect(targets[0]?.model).toBe("gemini-2.5-flash");
    expect(targets[1]?.model).toBe("google/gemma-4-26b-a4b-it:free");
    expect(targets[1]?.models).toContain("openrouter/free");
  });

  test("an explicit model overrides the OmniRouters default", () => {
    expect(resolveOmniroutersModel("gpt-4o", "gemini-2.5-flash")).toBe("gpt-4o");
  });

  test("either env name supplies the OmniRouters key", () => {
    expect(omniroutersApiKey({ OMNIROUTER_API_KEY: " from-alias " })).toBe("from-alias");
    expect(omniroutersApiKey({ OMNIROUTERS_API_KEY: "official", OMNIROUTER_API_KEY: "alias" })).toBe(
      "official",
    );
  });
});
