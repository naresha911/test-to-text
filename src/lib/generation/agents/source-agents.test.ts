import { describe, expect, test } from "bun:test";

import {
  SOURCE_AGENT_IDS,
  emptyMockGeneration,
  parseMockGeneration,
  type SourceAgentId,
} from "@/lib/document-types";
import {
  SOURCE_AGENTS,
  sourceAgent,
  sourceAgentForKind,
} from "@/lib/generation/agents/source-agents";

describe("source agents", () => {
  test("every source agent id has a complete profile", () => {
    expect([...SOURCE_AGENT_IDS]).toEqual(["past_paper", "practice_test"]);
    for (const id of SOURCE_AGENT_IDS) {
      const agent = SOURCE_AGENTS[id];
      expect(agent.id).toBe(id);
      expect(agent.label.length).toBeGreaterThan(0);
      expect(agent.summary.length).toBeGreaterThan(0);
      expect(agent.systemAddendum.length).toBeGreaterThan(0);
    }
  });

  test("the two agents have distinct postures", () => {
    expect(SOURCE_AGENTS.past_paper.systemAddendum).not.toBe(
      SOURCE_AGENTS.practice_test.systemAddendum,
    );
    expect(SOURCE_AGENTS.past_paper.mirrorSourceDifficulty).toBe(true);
    expect(SOURCE_AGENTS.practice_test.mirrorSourceDifficulty).toBe(false);
  });

  test("the source kind selects the agent, mocks have none", () => {
    expect(sourceAgentForKind("past_paper")).toBe("past_paper");
    expect(sourceAgentForKind("practice_test")).toBe("practice_test");
    expect(sourceAgentForKind("ai_mock")).toBeNull();
  });

  test("sourceAgent resolves only the two known ids", () => {
    expect(sourceAgent("past_paper")?.id).toBe("past_paper");
    expect(sourceAgent("practice_test")?.id).toBe("practice_test");
    expect(sourceAgent(null)).toBeNull();
    expect(sourceAgent(undefined)).toBeNull();
    expect(sourceAgent("nonsense" as SourceAgentId)).toBeNull();
  });

  test("a generation state round-trips its agent", () => {
    const withAgent = emptyMockGeneration({ mode: "from_source", agent: "practice_test" });
    expect(parseMockGeneration(JSON.stringify(withAgent))?.agent).toBe("practice_test");

    const withoutAgent = emptyMockGeneration({ mode: "from_source" });
    expect(parseMockGeneration(JSON.stringify(withoutAgent))?.agent).toBeUndefined();
    expect(parseMockGeneration('{"mode":"from_source","agent":"nonsense"}')?.agent).toBeUndefined();
  });
});
