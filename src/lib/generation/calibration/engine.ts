import {
  createCalibrationRun,
  finishCalibrationRun,
  insertAgentProposal,
  insertCalibrationAlert,
  insertCalibrationCase,
  listAgentProposals,
  listAppliedPromptOverrides,
  listCalibrationAlerts,
  upsertCalibrationProfile,
} from "@/lib/local-db";
import { parseGradeFromStandardName } from "@/lib/mock-paper";
import {
  applyPromptOverrides,
  skillEffectivePrompt,
} from "@/lib/generation/skill-prompts";
import { loadSyllabus } from "@/lib/syllabus";
import type { Question } from "@/lib/question-schema";

import { authorCalibrationQuestion } from "@/lib/generation/calibration/generate";
import { judgeCalibrationCase } from "@/lib/generation/calibration/judge";
import { buildCalibrationSet } from "@/lib/generation/calibration/test-set";
import {
  calibrationScopeKey,
  type CalibrationProfile,
  type CalibrationScope,
  type CalibrationSummary,
  type SkillCalibrationScore,
  type StructuralJudgement,
} from "@/lib/generation/calibration/types";

export const CALIBRATION_PASS_THRESHOLD = 0.6;
const DEFAULT_CASES_PER_SKILL = 3;
const MAX_CASES_PER_RUN = 40;

export type CalibrationRunResult = {
  runId: string;
  summary: CalibrationSummary;
};

function gradeForStandard(standardId: number | null): number | null {
  if (standardId == null) return null;
  const label = loadSyllabus(standardId)?.label ?? null;
  return parseGradeFromStandardName(label) ?? (standardId === 5 ? 6 : standardId === 8 ? 9 : null);
}

function standardName(standardId: number | null): string | null {
  return loadSyllabus(standardId)?.label ?? null;
}

function difficultyRank(value: Question["difficulty"]): number | null {
  if (value === "easy") return 0;
  if (value === "medium") return 1;
  if (value === "hard") return 2;
  return null;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function failureNotes(structural: StructuralJudgement, judgeReasons: string[]): string[] {
  return [...structural.notes, ...judgeReasons].filter(Boolean);
}

/**
 * Auto-apply the low-risk tunables (retrieval + difficulty) for a skill and
 * return the prompt edit that should be proposed for human approval.
 */
function deriveImprovements(input: {
  skill: string;
  scopeKey: string;
  score: SkillCalibrationScore;
  references: number;
  generatedDifficulties: (number | null)[];
  referenceDifficulties: (number | null)[];
  failureCounts: Map<string, number>;
  existingPrompt: string | null;
  /** True when every case for the skill was judge-unavailable. */
  judgeUnavailableAll: boolean;
}): {
  profile: CalibrationProfile;
  proposalAfter: string | null;
  proposalRationale: string | null;
} {
  const { score } = input;
  // A judge outage is not a skill weakness: structural-only results
  // say nothing about quality, so they never derive improvements.
  const weak =
    !input.judgeUnavailableAll &&
    (score.cases === 0 || score.score < CALIBRATION_PASS_THRESHOLD);

  const generatedAvg = average(input.generatedDifficulties.filter((v): v is number => v != null));
  const referenceAvg = average(input.referenceDifficulties.filter((v): v is number => v != null));
  let difficultyBias = 0;
  if (generatedAvg != null && referenceAvg != null) {
    if (generatedAvg < referenceAvg - 0.25) difficultyBias = 1;
    else if (generatedAvg > referenceAvg + 0.25) difficultyBias = -1;
  }

  const profile: CalibrationProfile = {
    scope_key: input.scopeKey,
    skill_type: input.skill,
    exemplar_limit: weak ? 5 : 3,
    exemplar_scope: input.references > 0 ? "exact" : "skill",
    difficulty_bias: difficultyBias,
    detect_threshold: null,
    updated_at: new Date().toISOString(),
    rationale: `Calibration pass ${score.passed}/${score.cases} (score ${score.score.toFixed(2)}). Retrieval limit ${weak ? 5 : 3}, difficulty bias ${difficultyBias >= 0 ? "+" : ""}${difficultyBias}.`,
  };

  let proposalAfter: string | null = null;
  let proposalRationale: string | null = null;
  if (weak && input.existingPrompt) {
    const topFailures = [...input.failureCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([note]) => note);
    if (topFailures.length) {
      proposalAfter = `${input.existingPrompt} Calibration fix: ${topFailures.join(" ")}`;
      proposalRationale = `Calibration pass rate ${(score.score * 100).toFixed(0)}% for ${input.skill}. Address: ${topFailures.join(" ")}`;
    }
  }

  return { profile, proposalAfter, proposalRationale };
}

/**
 * Run one manual calibration: generate questions for each selected skill,
 * compare them to approved past-paper questions, score them, auto-apply the
 * low-risk tunables, and raise alerts plus prompt-edit proposals.
 */
export async function runCalibration(input: {
  scope: CalibrationScope;
  casesPerSkill?: number;
  onProgress?: (message: string) => void;
}): Promise<CalibrationRunResult> {
  const scope: CalibrationScope = {
    standard_id: input.scope.standard_id,
    subject_id: input.scope.subject_id,
    stream_id: input.scope.stream_id,
    skills: [...new Set(input.scope.skills.filter(Boolean))],
    agent: input.scope.agent ?? null,
    document_id: input.scope.document_id ?? null,
    document_title: input.scope.document_title ?? null,
  };
  const documentId = scope.document_id ?? null;
  const casesPerSkill = Math.max(1, Math.floor(input.casesPerSkill ?? DEFAULT_CASES_PER_SKILL));
  const scopeKey = calibrationScopeKey(scope);
  const grade = gradeForStandard(scope.standard_id);
  const label = standardName(scope.standard_id);

  const run = await createCalibrationRun(scope);
  const progress = input.onProgress ?? (() => {});

  try {
    try {
      applyPromptOverrides(await listAppliedPromptOverrides());
    } catch {
      // Overrides are optional.
    }

    const openAlerts = await listCalibrationAlerts({ openOnly: true });
    const proposed = await listAgentProposals("proposed");
    const bySkill: Record<string, SkillCalibrationScore> = {};
    let totalCases = 0;
    let totalPassed = 0;
    let alertCount = 0;
    const details: {
      skill: string;
      references: number;
      generatedDifficulties: (number | null)[];
      referenceDifficulties: (number | null)[];
      failureCounts: Map<string, number>;
    }[] = [];

    for (const skill of scope.skills) {
      if (totalCases >= MAX_CASES_PER_RUN) break;
      progress(`Calibrating ${skill}…`);
      const references = await buildCalibrationSet({
        scope,
        skill,
        limit: casesPerSkill,
        documentId,
      });
      const skillScore: SkillCalibrationScore = {
        skill_type: skill,
        cases: 0,
        passed: 0,
        score: 0,
        structural_failures: 0,
        judge_cases: 0,
        judge_failed: 0,
      };
      const generatedDifficulties: (number | null)[] = [];
      const referenceDifficulties: (number | null)[] = [];
      const failureCounts = new Map<string, number>();

      for (let index = 0; index < references.length && totalCases < MAX_CASES_PER_RUN; index += 1) {
        const reference = references[index];
        if (!reference) continue;
        const number = String(index + 1);
        let generated: Question | null = null;
        try {
          generated = await authorCalibrationQuestion({
            runId: run.id,
            scope,
            skill,
            index,
            number,
            grade,
            standardName: label,
            difficultyStep: 0,
            patternSubtype: reference.pattern_subtype,
            excludeQuestionId: reference.question.id,
          });
        } catch {
          generated = null;
        }

        const judged = generated
          ? await judgeCalibrationCase({ generated, reference: reference.question, skill })
          : null;
        const structural = judged?.structural ?? null;
        const judge = judged?.judge ?? null;
        const score = judged?.score ?? 0;
        const passed = judged?.passed ?? false;

        if (structural && !structural.passed) skillScore.structural_failures += 1;
        if (judge) skillScore.judge_cases += 1;
        if (judged?.judgeFailed) skillScore.judge_failed += 1;
        if (generated) generatedDifficulties.push(difficultyRank(generated.difficulty));
        referenceDifficulties.push(difficultyRank(reference.question.difficulty));
        for (const note of structural
          ? failureNotes(structural, judge?.reasons ?? [])
          : ["Generation failed."]) {
          failureCounts.set(note, (failureCounts.get(note) ?? 0) + 1);
        }

        await insertCalibrationCase({
          id: crypto.randomUUID(),
          run_id: run.id,
          skill_type: skill,
          standard_id: scope.standard_id,
          subject_id: scope.subject_id,
          stream_id: scope.stream_id,
          pattern_subtype: reference.pattern_subtype,
          reference_question_id: reference.question.id,
          reference_document_id: reference.document_id,
          generated_question_id: generated?.id ?? null,
          generated,
          reference_stem: reference.question.stem,
          structural,
          judge,
          score,
          passed,
          created_at: new Date().toISOString(),
        });

        skillScore.cases += 1;
        totalCases += 1;
        if (passed) {
          skillScore.passed += 1;
          totalPassed += 1;
        }
      }

      skillScore.score = skillScore.cases ? skillScore.passed / skillScore.cases : 0;
      bySkill[skill] = skillScore;
      details.push({
        skill,
        references: references.length,
        generatedDifficulties,
        referenceDifficulties,
        failureCounts,
      });
    }

    // Auto-apply low-risk tuning, propose prompt edits, and raise alerts.
    // Training runs dedupe per paper, so two papers of the same scope
    // can each raise their own alert.
    const alertKey = (
      skill: string,
      kind: CalibrationAlertKind,
      documentId?: string | null,
    ) => `${documentId ?? "-"}:${skill}:${kind}`;
    const openAlertKeys = new Set(
      openAlerts
        .map((alert) => {
          const kind = reasonKindOf(alert.reason);
          return kind
            ? alertKey(
                alert.skill_type ?? "",
                kind,
                (alert.metric["document_id"] as string | null) ?? null,
              )
            : null;
        })
        .filter((key): key is string => key != null),
    );
    const proposedKeys = new Set(
      proposed.map((proposal) => `${proposal.skill_type ?? ""}:${proposal.after}`),
    );

    for (const detail of details) {
      const score = bySkill[detail.skill];
      if (!score) continue;
      const existingPrompt = skillEffectivePrompt(detail.skill);
      const judgeUnavailableAll = score.cases > 0 && score.judge_failed === score.cases;
      const { profile, proposalAfter, proposalRationale } = deriveImprovements({
        skill: detail.skill,
        scopeKey,
        score,
        references: detail.references,
        generatedDifficulties: detail.generatedDifficulties,
        referenceDifficulties: detail.referenceDifficulties,
        failureCounts: detail.failureCounts,
        existingPrompt,
        judgeUnavailableAll,
      });
      await upsertCalibrationProfile(profile);

      if (
        proposalAfter &&
        proposalRationale &&
        !proposedKeys.has(`${detail.skill}:${proposalAfter}`)
      ) {
        await insertAgentProposal({
          agent_id: "calibrator",
          skill_type: detail.skill,
          kind: "prompt_edit",
          target: { skill: detail.skill },
          before: existingPrompt,
          after: proposalAfter,
          rationale: proposalRationale,
        });
        proposedKeys.add(`${detail.skill}:${proposalAfter}`);
      }

      const reason = calibrationAlertReason(
        detail.skill,
        score,
        detail.references,
        scope.document_title ?? null,
      );
      if (
        reason &&
        !openAlertKeys.has(alertKey(detail.skill, reason.kind, documentId))
      ) {
        const critical =
          score.cases === 0 ||
          score.score < 0.3 ||
          (detail.failureCounts.size > 0 &&
            score.structural_failures >= Math.ceil(score.cases / 2));
        await insertCalibrationAlert({
          severity: critical ? "critical" : "warn",
          skill_type: detail.skill,
          standard_id: scope.standard_id,
          subject_id: scope.subject_id,
          stream_id: scope.stream_id,
          reason: reason.reason,
          metric: {
            cases: score.cases,
            passed: score.passed,
            score: score.score,
            ...(documentId ? { document_id: documentId } : {}),
          },
          source: documentId ? "training" : "calibration",
        });
        openAlertKeys.add(alertKey(detail.skill, reason.kind, documentId));
        alertCount += 1;
      }

      // Every case was judge-unavailable: the run measured structure only.
      if (judgeUnavailableAll) {
        const prefix = scope.document_title
          ? `Training "${scope.document_title}" — `
          : "";
        const judgeReason = `${prefix}${detail.skill} could not be judged (no AI key?) — results are structural only.`;
        if (
          !openAlertKeys.has(alertKey(detail.skill, "judge_unavailable", documentId))
        ) {
          await insertCalibrationAlert({
            severity: "warn",
            skill_type: detail.skill,
            standard_id: scope.standard_id,
            subject_id: scope.subject_id,
            stream_id: scope.stream_id,
            reason: judgeReason,
            metric: {
              cases: score.cases,
              passed: score.passed,
              score: score.score,
              judge_failed: score.judge_failed,
              ...(documentId ? { document_id: documentId } : {}),
            },
            source: documentId ? "training" : "calibration",
          });
          openAlertKeys.add(alertKey(detail.skill, "judge_unavailable", documentId));
          alertCount += 1;
        }
      }
    }

    const summary: CalibrationSummary = {
      bySkill,
      cases: totalCases,
      passed: totalPassed,
      alerts: alertCount,
      judge_failed: Object.values(bySkill).reduce(
        (sum, skillScore) => sum + skillScore.judge_failed,
        0,
      ),
    };
    await finishCalibrationRun(run.id, { status: "completed", summary });
    progress("Calibration finished.");
    return { runId: run.id, summary };
  } catch (error) {
    try {
      await finishCalibrationRun(run.id, { status: "failed", summary: null });
    } catch {
      // A DB error while recording the failure must not mask the original.
    }
    throw error;
  }
}

type CalibrationAlertKind =
  | "no_references"
  | "no_cases"
  | "low_pass_rate"
  | "judge_unavailable";

/** Classify an already-stored alert reason by its text, for dedupe. */
function reasonKindOf(reason: string): CalibrationAlertKind | null {
  if (reason.includes("No approved past-paper questions")) return "no_references";
  if (reason.includes("produced no questions")) return "no_cases";
  if (reason.includes("passed only")) return "low_pass_rate";
  if (reason.includes("could not be judged")) return "judge_unavailable";
  return null;
}

function calibrationAlertReason(
  skill: string,
  score: SkillCalibrationScore,
  references: number,
  label?: string | null,
): { kind: CalibrationAlertKind; reason: string } | null {
  const prefix = label ? `Training "${label}" — ` : "";
  if (references === 0) {
    return {
      kind: "no_references",
      reason: `${prefix}No approved past-paper questions for ${skill}; it cannot be verified and may produce wrong data.`,
    };
  }
  if (score.cases === 0) {
    return {
      kind: "no_cases",
      reason: `${prefix}${skill} produced no questions during calibration and may be broken.`,
    };
  }
  if (score.score < CALIBRATION_PASS_THRESHOLD) {
    return {
      kind: "low_pass_rate",
      reason: `${prefix}${skill} passed only ${score.passed}/${score.cases} calibration checks (${(score.score * 100).toFixed(0)}%) and may produce wrong data.`,
    };
  }
  return null;
}
