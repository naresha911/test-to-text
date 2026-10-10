import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { SOURCE_AGENT_IDS } from "@/lib/document-types";
import { sourceAgentForKind } from "@/lib/generation/agents/source-agents";
import { CALIBRATION_PASS_THRESHOLD } from "@/lib/generation/calibration/engine";
import { CALIBRATABLE_SKILLS } from "@/lib/generation/calibration/skills";
import { applyPromptOverrides } from "@/lib/generation/skill-prompts";
import {
  runCalibration as runCalibrationEngine,
  type CalibrationRunResult,
} from "@/lib/generation/agents/calibrator";
import {
  countOpenCalibrationAlerts,
  getAgentProposal,
  getCalibrationRun as getCalibrationRunRecord,
  getDocument,
  listAgentProposals,
  listAppliedPromptOverrides,
  listCalibrationAlerts as listCalibrationAlertRecords,
  listCalibrationCases,
  listCalibrationRuns as listCalibrationRunRecords,
  readApprovedDocumentSkills,
  resolveCalibrationAlert as resolveCalibrationAlertRecord,
  setAgentProposalStatus,
  updateDocument,
} from "@/lib/local-db";
import type {
  AgentProposal,
  CalibrationAlert,
  CalibrationCase,
  CalibrationRun,
} from "@/lib/generation/calibration/types";

const ScopeSchema = z.object({
  standard_id: z.number().int().nullable(),
  subject_id: z.number().int().nullable(),
  stream_id: z.number().int().nullable(),
  skills: z.array(z.string().min(1).max(80)).min(1).max(60),
  agent: z.enum(SOURCE_AGENT_IDS).nullable().optional(),
  document_id: z.string().uuid().nullable().optional(),
});

const RunInputSchema = z.object({
  scope: ScopeSchema,
  casesPerSkill: z.number().int().min(1).max(10).optional(),
});

const TrainInputSchema = z.object({
  documentId: z.string().uuid(),
  casesPerSkill: z.number().int().min(1).max(10).optional(),
});

const IdSchema = z.object({ id: z.string().min(1) });

export type CalibrationStatus = {
  openAlerts: number;
  alerts: CalibrationAlert[];
};

export const runCalibration = createServerFn({ method: "POST" })
  .validator((input: unknown) => RunInputSchema.parse(input))
  .handler(async ({ data }): Promise<CalibrationRunResult> => {
    return runCalibrationEngine({
      scope: {
        standard_id: data.scope.standard_id,
        subject_id: data.scope.subject_id,
        stream_id: data.scope.stream_id,
        skills: data.scope.skills,
        agent: data.scope.agent ?? null,
        document_id: data.scope.document_id ?? null,
      },
      ...(data.casesPerSkill != null ? { casesPerSkill: data.casesPerSkill } : {}),
    });
  });

/**
 * Train an agent on one library paper: the calibration reference set is pinned
 * to that paper's approved questions, the paper's kind picks the agent, and
 * the paper is marked as consumed training data on success.
 */
export const trainAgentOnDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => TrainInputSchema.parse(input))
  .handler(async ({ data }): Promise<CalibrationRunResult> => {
    const loaded = await getDocument(data.documentId);
    if (!loaded) throw new Error("Paper not found.");
    if (loaded.document.kind === "ai_mock") {
      throw new Error("Agents train on past papers and practice tests, not AI mocks.");
    }
    if (loaded.document.used_for_training) {
      throw new Error("This paper was already used to train the agent.");
    }
    const skills = (await readApprovedDocumentSkills(data.documentId)).filter((skill) =>
      CALIBRATABLE_SKILLS.includes(skill),
    );
    if (!skills.length) {
      throw new Error("Approve some questions in this paper first.");
    }
    const result = await runCalibrationEngine({
      scope: {
        standard_id: loaded.document.standard_id,
        subject_id: loaded.document.subject_id,
        stream_id: loaded.document.stream_id,
        skills,
        agent: sourceAgentForKind(loaded.document.kind),
        document_id: data.documentId,
        document_title: loaded.document.title,
      },
      ...(data.casesPerSkill != null ? { casesPerSkill: data.casesPerSkill } : {}),
    });
    // Consume the paper only when the run actually passed: a judge
    // outage or a weak run leaves the paper available for re-training.
    const runPassed =
      result.summary.cases > 0 &&
      result.summary.passed / result.summary.cases >= CALIBRATION_PASS_THRESHOLD;
    if (runPassed) {
      await updateDocument(data.documentId, { used_for_training: true });
    }
    return result;
  });

export const getCalibrationStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<CalibrationStatus> => {
    const [openAlerts, alerts] = await Promise.all([
      countOpenCalibrationAlerts(),
      listCalibrationAlertRecords({ openOnly: true }),
    ]);
    return { openAlerts, alerts: alerts.slice(0, 20) };
  },
);

export const listCalibrationRuns = createServerFn({ method: "GET" }).handler(
  async (): Promise<CalibrationRun[]> => listCalibrationRunRecords(20),
);

export const getCalibrationRun = createServerFn({ method: "GET" })
  .validator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data }): Promise<{ run: CalibrationRun | null; cases: CalibrationCase[] }> => {
    const run = await getCalibrationRunRecord(data.id);
    const cases = await listCalibrationCases(data.id);
    return { run, cases };
  });

export const listCalibrationProposals = createServerFn({ method: "GET" }).handler(
  async (): Promise<AgentProposal[]> => listAgentProposals(),
);

export const listCalibrationAlerts = createServerFn({ method: "GET" }).handler(
  async (): Promise<CalibrationAlert[]> => listCalibrationAlertRecords(),
);

export const applyCalibrationProposal = createServerFn({ method: "POST" })
  .validator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data }): Promise<{ applied: boolean }> => {
    const proposal = await getAgentProposal(data.id);
    if (!proposal) throw new Error("That proposal no longer exists.");
    await setAgentProposalStatus(data.id, "applied");
    applyPromptOverrides(await listAppliedPromptOverrides());
    return { applied: true };
  });

export const rejectCalibrationProposal = createServerFn({ method: "POST" })
  .validator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data }): Promise<{ rejected: boolean }> => {
    await setAgentProposalStatus(data.id, "rejected");
    return { rejected: true };
  });

export const resolveCalibrationAlert = createServerFn({ method: "POST" })
  .validator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data }): Promise<{ resolved: boolean }> => {
    await resolveCalibrationAlertRecord(data.id);
    return { resolved: true };
  });
