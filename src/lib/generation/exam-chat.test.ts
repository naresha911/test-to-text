import { describe, expect, test } from "bun:test";

import { examChatTargets, withImages, completeExamChat } from "@/lib/generation/exam-chat";
import {
  COMMAND_CODE_TEXT_MODEL,
  COMMAND_CODE_VISION_MODELS,
  TEXT_EXAM_MODEL,
} from "@/lib/generation/vision-models";
import { buildSearchQuery, formatSnippets, snippetsFromSearchBody } from "@/lib/generation/web-search";
import { detectSkill } from "@/lib/generation/skill-detect";
import {
  blueprintFromQuestions,
  drillBlueprint,
  expandBlueprint,
  numberGaps,
} from "@/lib/generation/blueprint";
import type { GenerationChatTarget } from "@/lib/generation/chat-provider";

describe("web search helpers", () => {
  test("builds a short query and formats snippets", () => {
    expect(buildSearchQuery({ stem: "Which is the longest dam in India?", subject: "Geography" })).toBe(
      "Geography Which is the longest dam in India?",
    );
    expect(buildSearchQuery({ stem: "x".repeat(400) }).length).toBeLessThanOrEqual(240);
    const text = formatSnippets([{ title: "Dam", url: "https://example.com", snippet: "Hirakud" }]);
    expect(text).toContain("Hirakud");
    expect(text).toContain("https://example.com");
  });

  test("reads an OmniRoute search body", () => {
    const snippets = snippetsFromSearchBody({
      results: [{ title: "Dam", url: "https://example.com", content: "Hirakud is the longest." }],
    });
    expect(snippets).toEqual([
      { title: "Dam", url: "https://example.com", snippet: "Hirakud is the longest." },
    ]);
  });
});

describe("exam chat", () => {
  test("a text question stays on the text model", () => {
    const targets = examChatTargets({
      vision: false,
      omniroutersKey: "omni",
      openRouterKey: "open",
    });
    expect(targets.some((target) => target.model === TEXT_EXAM_MODEL || target.models?.includes(TEXT_EXAM_MODEL))).toBe(
      true,
    );
    expect(targets.some((target) => target.model === "google/gemini-2.5-flash")).toBe(false);
  });

  test("a diagram question uses vision models and skips the free text model", () => {
    const targets = examChatTargets({
      vision: true,
      omniroutersKey: "omni",
      openRouterKey: "open",
      omniroutersBaseUrl: "http://127.0.0.1:20128/v1",
    });
    expect(targets.map((target) => target.model)).toEqual([
      "gemini-2.5-flash",
      "google/gemini-2.5-flash",
      "google/gemini-2.5-flash",
    ]);
    expect(targets.some((target) => target.model?.includes("gemma"))).toBe(false);
    const messages = withImages([{ role: "user", content: "Solve this." }], [
      { dataUrl: "data:image/png;base64,abc", label: "Question figure" },
    ]);
    const content = messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content.some((part) => part.type === "image_url")).toBe(true);
  });

  test("a text question prefers the free Command Code model", () => {
    const targets = examChatTargets({ vision: false, commandCodeKey: "cmd" });
    expect(targets[0]?.provider).toBe("commandcode");
    expect(targets[0]?.model).toBe(COMMAND_CODE_TEXT_MODEL);
  });

  test("a diagram question routes to the Command Code vision model", () => {
    const targets = examChatTargets({ vision: true, commandCodeKey: "cmd", openRouterKey: "open" });
    expect(targets[0]?.provider).toBe("commandcode");
    expect(targets[0]?.model).toBe(COMMAND_CODE_VISION_MODELS[0]);
    expect(targets.some((target) => target.model?.includes("gemma"))).toBe(false);
  });

  test("searches once when the first answer is rejected, and not when it is accepted", async () => {
    let sends = 0;
    let searches = 0;
    const target = {
      provider: "openrouter",
      label: "OpenRouter",
      url: "https://example.com",
      headers: {},
      model: "text",
    } satisfies GenerationChatTarget;
    const deps = {
      targets: () => [target],
      send: async () => {
        sends += 1;
        return sends === 1 ? "nope" : "yes";
      },
      search: async () => {
        searches += 1;
        return [{ title: "Note", url: "", snippet: "The answer is A." }];
      },
    };
    const missed = await completeExamChat({
      messages: [{ role: "user", content: "Question" }],
      searchQuery: "longest dam",
      accept: (text) => text === "yes",
      deps,
    });
    expect(missed).toEqual({ text: "yes", searched: true, accepted: true });
    expect(searches).toBe(1);

    const hit = await completeExamChat({
      messages: [{ role: "user", content: "Question" }],
      searchQuery: "longest dam",
      accept: () => true,
      deps: { ...deps, send: async () => "ready" },
    });
    expect(hit.searched).toBe(false);
    expect(searches).toBe(1);
  });
});

describe("skill detection and blueprint", () => {
  test("classifies PractiseTest20-style stems", () => {
    expect(detectSkill({ stem: "Select the missing number in the given series. 5, 1, 8, 2" })).toBe(
      "number_series",
    );
    expect(detectSkill({ stem: "If SPEAKER is coded as ##@@#@#, what is TRANSISTOR?" })).toBe(
      "coding_decoding",
    );
    expect(
      detectSkill({
        stem: "Which of the following options will complete the pattern in the following figure?",
        figureCount: 5,
      }),
    ).toBe("figure_pattern");
    expect(detectSkill({ stem: "Who came to the help of Fred and Gary?" })).toBe("comprehension");
    expect(detectSkill({ stem: "Which is the longest dam in India?" })).toBe("general_knowledge");
    expect(
      detectSkill({
        stem: "Harish's sister was born before 20th August but after 17th August.",
      }),
    ).toBe("date_puzzle");
  });

  test("a full mock counts skills and a drill stays on one skill", () => {
    const paper = blueprintFromQuestions([
      { number: "147", stem: "Select the missing number in the given series. 5, 1, 8" },
      { number: "147", stem: "Select the missing number in the given series. 5, 1, 8" },
      { number: "143", stem: "On which day of August does Harish's sister celebrate her birthday?" },
      { number: "59", stem: "Which is the longest dam in India?" },
    ]);
    expect(paper.duplicateNumbers).toEqual(["147"]);
    expect(paper.slots).toEqual([
      { skill: "number_series", count: 1, grade: null, difficultyStep: 0 },
      { skill: "date_puzzle", count: 1, grade: null, difficultyStep: 0 },
      { skill: "general_knowledge", count: 1, grade: null, difficultyStep: 0 },
    ]);
    expect(drillBlueprint({ skill: "number_series", count: 10, grade: 8, difficultyStep: 1 })).toEqual({
      skill: "number_series",
      count: 10,
      grade: 8,
      difficultyStep: 1,
    });
  });

  test("reports inclusive number gaps and repeats known exemplars", () => {
    expect(numberGaps(["1", "2", "6"])).toEqual(["3-5"]);
    expect(numberGaps(["86", "88", "Q4", "0"])).toEqual(["87"]);
    expect(
      expandBlueprint(
        [
          { skill: "number_series", count: 3, grade: null, difficultyStep: 0 },
          { skill: "grammar", count: 2, grade: null, difficultyStep: 0 },
        ],
        { number_series: "q-series" },
      ),
    ).toEqual(["q-series", "q-series", "q-series"]);
  });
});
