/**
 * The calibrator agent (server-side). It measures freshly generated questions
 * against approved past-paper questions, scores the similarity, and reports what
 * the other agents should change. Kept out of agents/index.ts, which is
 * client-safe; import this module only from server code.
 */
export { authorCalibrationQuestion } from "@/lib/generation/calibration/generate";
export {
  CALIBRATION_PASS_THRESHOLD,
  runCalibration,
  type CalibrationRunResult,
} from "@/lib/generation/calibration/engine";
export {
  assessStructure,
  hasDeterministicOracle,
  isCopiedText,
  judgeCalibrationCase,
  judgeWithModel,
  parseJudgeVerdict,
  scoreCase,
} from "@/lib/generation/calibration/judge";
export { buildCalibrationSet } from "@/lib/generation/calibration/test-set";
export type {
  AgentProposal,
  CalibrationAlert,
  CalibrationCase,
  CalibrationProfile,
  CalibrationReference,
  CalibrationRun,
  CalibrationScope,
  CalibrationSummary,
  JudgeVerdict,
  SkillCalibrationScore,
  StructuralJudgement,
} from "@/lib/generation/calibration/types";
