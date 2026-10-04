import {
  emptyGenerationItem,
  parseGenerationItem,
  type GenerationItem,
} from "@/lib/generation/job-types";
import type { ContentMode } from "@/lib/reading/mode";

export const DOCUMENT_KINDS = ["past_paper", "practice_test", "ai_mock"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export type Catalog = {
  standards: { id: number; name: string; display_order: number | null }[];
  subjects: { id: number; name: string; code: string | null }[];
  topics: { id: number; subject_id: number | null; name: string; parent_topic_id: number | null }[];
  streams: { id: number; name: string; standard_id: number | null }[];
};

export type MockGenerationMode = "from_source" | "from_instructions";
export type MockGenerationStatus = "pending" | "in_progress" | "completed" | "failed";

export type MockGenerationPair = {
  source_question_id: string | null;
  mock_question_id: string;
};

export type MockGenerationState = {
  mode: MockGenerationMode;
  status: MockGenerationStatus;
  instructions: string | null;
  planned_count: number | null;
  source_question_ids: string[];
  cursor: number;
  last_error: string | null;
  pairs: MockGenerationPair[];
  /** Durable job id. Older mocks omit this. */
  job_id?: string | null;
  /** Per-question stage checkpoints. The cursor remains a progress display. */
  items?: GenerationItem[];
  /** Skill counts for a full mock. A topic drill uses one entry. */
  blueprint?: { skill: string; count: number }[];
  /** 0 matches the source level. 1 is one step harder inside the class ceiling. */
  difficulty_step?: number;
  /** Set when the mock practises one skill instead of copying a paper. */
  drill_skill?: string | null;
};

export type DocumentMeta = {
  id: string;
  kind: DocumentKind;
  title: string;
  year: number | null;
  standard_id: number | null;
  stream_id: number | null;
  subject_id: number | null;
  duration_minutes: number | null;
  total_marks: number | null;
  difficulty: Difficulty | null;
  exam: string | null;
  notes: string | null;
  source: string | null;
  description: string | null;
  section_timing: boolean;
  negative_marking: boolean;
  allow_pause: boolean;
  max_attempts: number;
  default_marks: number | null;
  default_negative_marks: number | null;
  /** Source paper id when this document is an AI mock generated from a library paper. */
  source_document_id: string | null;
  /** Resumable AI mock generation job state. */
  generation: MockGenerationState | null;
  /** Increments on every questions save so a stale write cannot delete images. */
  questions_rev: number;
  created_at: string;
  updated_at: string;
};

export const PAPER_CHANGED_MESSAGE = "This paper changed on disk. Reload it before saving.";

export function isPaperChangedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("changed on disk");
}

export type PageRecord = {
  id: string;
  document_id: string;
  page_index: number;
  file_path: string;
  original_name: string;
  ocr_status: string;
  /** Mode used when this page was marked read. Empty until then. */
  read_mode: ContentMode | null;
  dataUrl?: string;
};

export function documentKindLabel(kind: DocumentKind): string {
  switch (kind) {
    case "practice_test":
      return "Practice test";
    case "ai_mock":
      return "AI mock";
    default:
      return "Past paper";
  }
}

export function documentKindBadge(kind: DocumentKind): string {
  switch (kind) {
    case "practice_test":
      return "Test";
    case "ai_mock":
      return "AI Mock";
    default:
      return "Paper";
  }
}

export function emptyMockGeneration(
  partial: Partial<MockGenerationState> & Pick<MockGenerationState, "mode">,
): MockGenerationState {
  return {
    status: "pending",
    instructions: null,
    planned_count: null,
    source_question_ids: [],
    cursor: 0,
    last_error: null,
    pairs: [],
    job_id: null,
    items: [],
    ...partial,
  };
}

export function parseMockGeneration(raw: unknown): MockGenerationState | null {
  if (raw == null || raw === "") return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const mode = obj["mode"];
  if (mode !== "from_source" && mode !== "from_instructions") return null;
  const status = obj["status"];
  const statusOk =
    status === "pending" ||
    status === "in_progress" ||
    status === "completed" ||
    status === "failed";
  const pairs = Array.isArray(obj["pairs"])
    ? obj["pairs"]
        .map((pair) => {
          if (!pair || typeof pair !== "object") return null;
          const p = pair as Record<string, unknown>;
          const mockId = typeof p["mock_question_id"] === "string" ? p["mock_question_id"] : null;
          if (!mockId) return null;
          return {
            source_question_id:
              typeof p["source_question_id"] === "string" ? p["source_question_id"] : null,
            mock_question_id: mockId,
          };
        })
        .filter((p): p is MockGenerationPair => p != null)
    : [];
  const sourceIds = Array.isArray(obj["source_question_ids"])
    ? obj["source_question_ids"].filter((id): id is string => typeof id === "string")
    : [];
  const items = Array.isArray(obj["items"])
    ? obj["items"]
        .map((item) => parseGenerationItem(item))
        .filter((item): item is GenerationItem => item != null)
    : [];
  return {
    mode,
    status: statusOk ? status : "pending",
    instructions: typeof obj["instructions"] === "string" ? obj["instructions"] : null,
    planned_count:
      typeof obj["planned_count"] === "number" && Number.isFinite(obj["planned_count"])
        ? obj["planned_count"]
        : null,
    source_question_ids: sourceIds,
    cursor: typeof obj["cursor"] === "number" && Number.isFinite(obj["cursor"]) ? obj["cursor"] : 0,
    last_error: typeof obj["last_error"] === "string" ? obj["last_error"] : null,
    pairs,
    job_id: typeof obj["job_id"] === "string" ? obj["job_id"] : null,
    items,
    ...(Array.isArray(obj["blueprint"])
      ? {
          blueprint: obj["blueprint"].flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const row = entry as Record<string, unknown>;
            if (typeof row["skill"] !== "string" || typeof row["count"] !== "number") return [];
            return [{ skill: row["skill"], count: row["count"] }];
          }),
        }
      : {}),
    ...(typeof obj["difficulty_step"] === "number" && Number.isFinite(obj["difficulty_step"])
      ? { difficulty_step: obj["difficulty_step"] }
      : {}),
    ...(typeof obj["drill_skill"] === "string"
      ? { drill_skill: obj["drill_skill"] }
      : obj["drill_skill"] === null
        ? { drill_skill: null }
        : {}),
  };
}

export function mockGenerationTotal(generation: MockGenerationState | null | undefined): number {
  if (!generation) return 0;
  if (generation.mode === "from_source") return generation.source_question_ids.length;
  return generation.planned_count ?? 0;
}

export function ensureGenerationItems(state: MockGenerationState): MockGenerationState {
  const total = mockGenerationTotal(state);
  const jobId = state.job_id ?? crypto.randomUUID();
  const items = [...(state.items ?? [])];
  while (items.length < total) {
    const sequence = items.length;
    items.push(
      emptyGenerationItem({
        jobId,
        sequence,
        sourceQuestionId:
          state.mode === "from_source" ? (state.source_question_ids[sequence] ?? null) : null,
      }),
    );
  }
  return { ...state, job_id: jobId, items };
}

export function isMockGenerationIncomplete(
  generation: MockGenerationState | null | undefined,
): boolean {
  if (!generation) return false;
  return generation.status !== "completed";
}
