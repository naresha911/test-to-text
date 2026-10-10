import type { SourceAgentId } from "@/lib/document-types";
import type { Question } from "@/lib/question-schema";

/** What scope an agent is calibrated for. */
export type CalibrationScope = {
  standard_id: number | null;
  subject_id: number | null;
  stream_id: number | null;
  skills: string[];
  /** The source agent under calibration; each agent keeps its own profiles. */
  agent?: SourceAgentId | null;
  /** Set when this run trains on one specific paper (Train Agent). */
  document_id?: string | null;
  /** Display-only: which paper a training run came from. */
  document_title?: string | null;
};

export type CalibrationRunStatus = "running" | "completed" | "failed";
export type CalibrationSeverity = "warn" | "critical";
export type ProposalStatus = "proposed" | "applied" | "rejected";

/** Deterministic checks a generated question must pass before any model judge runs. */
export type StructuralJudgement = {
  schema_valid: boolean;
  has_answers: boolean;
  option_count_ok: boolean;
  skill_match: boolean;
  copied_reference: boolean;
  oracle_passed: boolean | null;
  marks_sane: boolean;
  difficulty_match: boolean;
  passed: boolean;
  notes: string[];
};

/** The free-model rubric verdict for a generated vs reference pair. */
export type JudgeVerdict = {
  equivalent: boolean;
  skill_match: number;
  difficulty_match: number;
  answerable: boolean;
  past_paper_like: number;
  reasons: string[];
  judge_score: number;
  model: string | null;
};

/** One generated-vs-reference comparison. */
export type CalibrationCase = {
  id: string;
  run_id: string;
  skill_type: string;
  standard_id: number | null;
  subject_id: number | null;
  stream_id: number | null;
  pattern_subtype: string | null;
  reference_question_id: string | null;
  reference_document_id: string | null;
  generated_question_id: string | null;
  generated: Question | null;
  reference_stem: string | null;
  structural: StructuralJudgement | null;
  judge: JudgeVerdict | null;
  score: number;
  passed: boolean;
  created_at: string;
};

/** Rolled-up calibration result for a single skill. */
export type SkillCalibrationScore = {
  skill_type: string;
  cases: number;
  passed: number;
  score: number;
  structural_failures: number;
  judge_cases: number;
  /** Cases where the judge model itself was unavailable. */
  judge_failed: number;
};

export type CalibrationSummary = {
  bySkill: Record<string, SkillCalibrationScore>;
  cases: number;
  passed: number;
  alerts: number;
  /** Total judge-unavailable cases across all skills. */
  judge_failed: number;
};

export type CalibrationRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: CalibrationRunStatus;
  scope: CalibrationScope;
  summary: CalibrationSummary | null;
};

/** Serializable scalar map stored on an alert (cases/passed/score today). */
export type CalibrationAlertMetric = Record<string, number | string | boolean | null>;

export type CalibrationAlert = {
  id: string;
  created_at: string;
  resolved_at: string | null;
  severity: CalibrationSeverity;
  skill_type: string | null;
  standard_id: number | null;
  subject_id: number | null;
  stream_id: number | null;
  reason: string;
  metric: CalibrationAlertMetric;
  source: string;
};

export type PromptProposalTarget = {
  /** Which composed prompt the edit belongs to (a skill id today). */
  skill: string;
};

export type AgentProposal = {
  id: string;
  created_at: string;
  applied_at: string | null;
  status: ProposalStatus;
  agent_id: string;
  skill_type: string | null;
  kind: string;
  target: PromptProposalTarget;
  before: string | null;
  after: string;
  rationale: string | null;
};

/** Low-risk tunables the calibrator may auto-apply, one row per scope + skill. */
export type CalibrationProfile = {
  scope_key: string;
  skill_type: string;
  exemplar_limit: number | null;
  exemplar_scope: "exact" | "skill" | null;
  difficulty_bias: number | null;
  detect_threshold: number | null;
  updated_at: string;
  rationale: string | null;
};

/** A pinned approved past-paper question used as expected output. */
export type CalibrationReference = {
  skill: string;
  pattern_subtype: string | null;
  standard_id: number | null;
  subject_id: number | null;
  stream_id: number | null;
  question: Question;
  document_id: string;
};

export function calibrationScopeKey(scope: {
  agent?: SourceAgentId | null;
  standard_id: number | null;
  subject_id: number | null;
  stream_id: number | null;
}): string {
  return `${scope.agent ?? "-"}:${scope.standard_id ?? "-"}:${scope.subject_id ?? "-"}:${scope.stream_id ?? "-"}`;
}
