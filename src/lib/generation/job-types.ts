import type { ValidationStatus } from "@/lib/generation/validation-types";

export const GENERATION_STAGES = [
  "analysis",
  "generation",
  "validation",
  "asset",
  "review",
  "completed",
] as const;

export type GenerationStage = (typeof GENERATION_STAGES)[number];

export const GENERATION_ITEM_STATUSES = [
  "pending",
  "running",
  "retryable",
  "needs_review",
  "completed",
  "failed",
] as const;

export type GenerationItemStatus = (typeof GENERATION_ITEM_STATUSES)[number];

export const MAX_GENERATION_ATTEMPTS = 2;

export type GenerationItem = {
  item_id: string;
  sequence: number;
  source_question_id: string | null;
  stage: GenerationStage;
  status: GenerationItemStatus;
  attempt_count: number;
  candidate_question_id: string | null;
  validation_status: ValidationStatus | null;
  last_error: string | null;
  idempotency_key: string;
  completed_stages: GenerationStage[];
};

export function emptyGenerationItem(input: {
  jobId: string;
  sequence: number;
  sourceQuestionId?: string | null;
}): GenerationItem {
  return {
    item_id: `${input.jobId}:${input.sequence}`,
    sequence: input.sequence,
    source_question_id: input.sourceQuestionId ?? null,
    stage: "analysis",
    status: "pending",
    attempt_count: 0,
    candidate_question_id: null,
    validation_status: null,
    last_error: null,
    idempotency_key: `${input.jobId}:${input.sequence}:generation`,
    completed_stages: [],
  };
}

export function parseGenerationItem(raw: unknown): GenerationItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const itemId = typeof row["item_id"] === "string" ? row["item_id"] : "";
  const idempotency = typeof row["idempotency_key"] === "string" ? row["idempotency_key"] : "";
  if (!itemId || !idempotency) return null;
  const stage = GENERATION_STAGES.includes(row["stage"] as GenerationStage)
    ? (row["stage"] as GenerationStage)
    : "analysis";
  const status = GENERATION_ITEM_STATUSES.includes(row["status"] as GenerationItemStatus)
    ? (row["status"] as GenerationItemStatus)
    : "pending";
  const validation = row["validation_status"];
  const completed = Array.isArray(row["completed_stages"])
    ? row["completed_stages"].filter((stageName): stageName is GenerationStage =>
        GENERATION_STAGES.includes(stageName as GenerationStage),
      )
    : [];
  return {
    item_id: itemId,
    sequence: typeof row["sequence"] === "number" ? row["sequence"] : 0,
    source_question_id:
      typeof row["source_question_id"] === "string" ? row["source_question_id"] : null,
    stage,
    status,
    attempt_count: typeof row["attempt_count"] === "number" ? row["attempt_count"] : 0,
    candidate_question_id:
      typeof row["candidate_question_id"] === "string" ? row["candidate_question_id"] : null,
    validation_status:
      validation === "passed" || validation === "failed" || validation === "needs_review"
        ? validation
        : null,
    last_error: typeof row["last_error"] === "string" ? row["last_error"] : null,
    idempotency_key: idempotency,
    completed_stages: completed,
  };
}

export function withStage(item: GenerationItem, stage: GenerationStage): GenerationItem {
  return {
    ...item,
    stage,
    completed_stages: item.completed_stages.includes(stage)
      ? item.completed_stages
      : [...item.completed_stages, stage],
  };
}

export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function assetIdFor(idempotencyKey: string, role: string): string {
  return `a${hashSeed(`${idempotencyKey}:${role}`).toString(16).padStart(8, "0")}`;
}
