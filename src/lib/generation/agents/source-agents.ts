import type { DocumentKind, MockStrategy, SourceAgentId } from "@/lib/document-types";

/**
 * A source agent is the generation profile chosen for a mock. The two agents keep
 * separate memory: each reads exemplars and learned skills only from its own kind
 * of source document (past papers vs practice tests).
 */
export type SourceAgent = {
  id: SourceAgentId;
  label: string;
  /** One line for menus and pickers. */
  summary: string;
  /** Posture block appended to the authoring system prompt. */
  systemAddendum: string;
  /** Strategy offered by default in the library mock dialog. */
  defaultStrategy: MockStrategy;
  /** Whether generation should mirror the source paper's difficulty. */
  mirrorSourceDifficulty: boolean;
};

export const SOURCE_AGENTS: Record<SourceAgentId, SourceAgent> = {
  past_paper: {
    id: "past_paper",
    label: "Past paper agent",
    summary: "Mirrors real exam-paper level and style, learning from your past papers.",
    systemAddendum:
      "AGENT: PAST PAPER. Prefer the level, style and difficulty of a real exam paper. " +
      "Keep each question exam-like; do not simplify it or repeat the same item.",
    defaultStrategy: "write_new",
    mirrorSourceDifficulty: true,
  },
  practice_test: {
    id: "practice_test",
    label: "Practice test agent",
    summary: "Drills the target skill, learning from your practice tests.",
    systemAddendum:
      "AGENT: PRACTICE TEST. Drill the target skill and topic; repetition is fine; keep the " +
      "difficulty neutral unless instructed otherwise. Exam-paper fidelity is not required — " +
      "clarity and a single correct answer are.",
    defaultStrategy: "rewrite",
    mirrorSourceDifficulty: false,
  },
};

/** The agent a source document maps to. Mocks have no source agent. */
export function sourceAgentForKind(kind: DocumentKind): SourceAgentId | null {
  return kind === "past_paper" || kind === "practice_test" ? kind : null;
}

export function sourceAgent(id: SourceAgentId | null | undefined): SourceAgent | null {
  if (id !== "past_paper" && id !== "practice_test") return null;
  return SOURCE_AGENTS[id];
}
