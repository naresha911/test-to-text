import { createMemoryAssetStore } from "@/lib/assets/store";
import {
  completeGenerationChat,
  type GenerationChatMessage,
} from "@/lib/generation/chat-transport";
import { emptyGenerationItem } from "@/lib/generation/job-types";
import { runGenerationItem, type RunGenerationInput } from "@/lib/generation/orchestrator";
import { difficultyBiasFor, loadExemplars } from "@/lib/generation/agents/question-author";
import { skillAuthorPlan } from "@/lib/generation/skills/author-plan";
import { skillAuthorPrompt, skillDifficultyGuidance } from "@/lib/generation/skill-prompts";
import { buildGrammarUserPrompt } from "@/lib/generation/textual/prompt";
import {
  assertMockQuestionComplete,
  buildFromInstructionsUserPrompt,
  finalizeMockQuestion,
} from "@/lib/mock-paper";
import { SYSTEM_PROMPT } from "@/lib/generation/generation-system-prompt";
import type { Question } from "@/lib/question-schema";

import type { CalibrationScope } from "@/lib/generation/calibration/types";

function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Author one question through the real orchestrator, as calibration does. */
export async function authorCalibrationQuestion(input: {
  runId: string;
  scope: CalibrationScope;
  skill: string;
  index: number;
  number: string;
  grade: number | null;
  standardName: string | null;
  difficultyStep: number;
  patternSubtype?: string | null;
  /** The reference question is held out so the agent cannot copy it. */
  excludeQuestionId: string | null;
}): Promise<Question> {
  const jobId = `${input.runId}:${input.skill}:${input.index}`;
  const item = emptyGenerationItem({ jobId, sequence: input.index });
  const documentId = `calibration:${input.runId}`;
  const assetStore = createMemoryAssetStore();
  // Calibration may have tuned how hard this skill should land in this
  // scope; the bias shifts the difficulty guidance the model receives.
  const difficultyStep = input.difficultyStep + (await difficultyBiasFor(input.scope, input.skill));

  const callLegacyModel: NonNullable<RunGenerationInput["callLegacyModel"]> = async (
    questionId,
    skill,
    context,
  ) => {
    const plan = skillAuthorPlan({
      skill,
      grade: input.grade,
      difficultyStep,
      hasImages: false,
    });
    const skillNote =
      plan?.systemAddendum ??
      [skillAuthorPrompt(skill), skillDifficultyGuidance(skill, input.grade, difficultyStep)]
        .filter(Boolean)
        .join("\n");
    const instructions = `[skill:${skill}]\nWrite one new ${skill.replaceAll("_", " ")} question for this class.`;
    const userContent = buildFromInstructionsUserPrompt({
      instructions,
      index: input.index,
      total: 1,
      ...(input.standardName ? { audience: { standard: input.standardName } } : {}),
      ...(context.exemplars.length ? { exemplars: context.exemplars } : {}),
    });
    const messages: GenerationChatMessage[] = [
      {
        role: "system",
        content: skillNote ? `${SYSTEM_PROMPT}\n\n${skillNote}` : SYSTEM_PROMPT,
      },
      { role: "user", content: userContent },
    ];
    const text = await completeGenerationChat({
      messages,
      context: {
        kind: "calibration_generate",
        label: `Calibration ${input.runId} #${input.index}`,
      },
    });
    const parsed = extractJson(text);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("The calibration model returned unreadable output.");
    }
    const question = finalizeMockQuestion(parsed, {
      number: input.number,
      skillType: skill,
    });
    if (!question.stem.trim() && !question.passage?.trim() && !question.assertion?.trim()) {
      throw new Error("The calibration model returned no usable question stem.");
    }
    assertMockQuestionComplete(question, null);
    return { ...question, id: questionId };
  };

  const callGrammarModel: NonNullable<RunGenerationInput["callGrammarModel"]> = async (spec) => {
    const messages: GenerationChatMessage[] = [
      {
        role: "system",
        content: "You write original grammar questions. Return one JSON object and nothing else.",
      },
      { role: "user", content: buildGrammarUserPrompt(spec, null) },
    ];
    const text = await completeGenerationChat({
      messages,
      context: {
        kind: "calibration_grammar",
        label: `Calibration ${input.runId} #${input.index}`,
      },
    });
    const parsed = extractJson(text);
    if (!parsed) throw new Error("The calibration grammar model returned unreadable output.");
    return parsed;
  };

  const result = await runGenerationItem({
    item,
    jobId,
    sequence: input.index,
    documentId,
    source: null,
    instructions: `[skill:${input.skill}]`,
    authorInstructions: null,
    number: input.number,
    audience: { standard: input.standardName, subject: null, exam: null },
    grade: input.grade,
    difficultyStep: input.difficultyStep,
    existingQuestion: null,
    assetStore,
    retrieveExamples: async (analysis) => {
      const exemplars = await loadExemplars(
        {
          skill: analysis.skill_type,
          pattern_subtype: input.patternSubtype ?? analysis.pattern_subtype,
          standard_id: input.scope.standard_id,
          subject_id: input.scope.subject_id,
          stream_id: input.scope.stream_id,
          agent: input.scope.agent ?? null,
          ...(input.scope.agent ? { kinds: [input.scope.agent] } : {}),
        },
        3,
      );
      return input.excludeQuestionId
        ? exemplars.filter((question) => question.id !== input.excludeQuestionId)
        : exemplars;
    },
    callGrammarModel,
    callLegacyModel,
  });

  return result.question;
}
