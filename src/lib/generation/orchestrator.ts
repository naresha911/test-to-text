import type { AssetStore } from "@/lib/assets/types";
import { buildGenerationSpec, type GenerationAudience } from "@/lib/generation/generation-spec";
import {
  emptyGenerationItem,
  MAX_GENERATION_ATTEMPTS,
  withStage,
  type GenerationItem,
} from "@/lib/generation/job-types";
import { generateNumberSeriesQuestion } from "@/lib/generation/math/generator";
import { validateNumberSeriesQuestion } from "@/lib/generation/math/validator";
import { analyzePattern } from "@/lib/generation/pattern-analyzer";
import type { PatternAnalysis } from "@/lib/generation/pattern-types";
import { validateGrammarQuestion } from "@/lib/generation/textual/validator";
import { attachMirrorAssets, mirrorOptionSvgs } from "@/lib/generation/visual/assets";
import { inventMirrorSpec } from "@/lib/generation/visual/mirror-image";
import { validateMirrorSvgs } from "@/lib/generation/visual/oracle";
import type { ValidationResult } from "@/lib/generation/validation-types";
import { skillByType } from "@/lib/question-taxonomy";
import {
  emptyQuestion,
  normalizeQuestion,
  type Question,
  type ValidationSummary,
} from "@/lib/question-schema";
import type { SourceQuestionRecord } from "@/lib/source/source-record";

export type GenerationCheckpoint = {
  item: GenerationItem;
  question: Question | null;
};

export type RunGenerationInput = {
  item?: GenerationItem | null;
  jobId: string;
  sequence: number;
  documentId: string;
  source?: SourceQuestionRecord | null;
  instructions?: string | null;
  number: string;
  audience?: GenerationAudience;
  existingQuestion?: Question | null;
  assetStore: AssetStore;
  callGrammarModel?: (spec: ReturnType<typeof buildGenerationSpec>) => Promise<unknown>;
  callLegacyModel?: () => Promise<Question>;
  describeSourceFigure?: () => Promise<string | null>;
  onCheckpoint?: (snapshot: GenerationCheckpoint) => Promise<void>;
  onProduce?: () => void;
  now?: string;
};

function summaryOf(result: ValidationResult): ValidationSummary {
  return { status: result.status, checks: result.checks, errors: result.errors };
}

function applyValidation(question: Question, result: ValidationResult): Question {
  return { ...question, validation: summaryOf(result) };
}

async function checkpoint(
  input: RunGenerationInput,
  item: GenerationItem,
  question: Question | null,
): Promise<void> {
  if (input.onCheckpoint) await input.onCheckpoint({ item, question });
}

export async function runGenerationItem(input: RunGenerationInput): Promise<{
  item: GenerationItem;
  question: Question;
  analysis: PatternAnalysis;
}> {
  const sourceQuestion = input.source?.question ?? null;
  const sourceSnapshot = sourceQuestion ? JSON.stringify(sourceQuestion) : null;
  let item =
    input.item ??
    emptyGenerationItem({
      jobId: input.jobId,
      sequence: input.sequence,
      sourceQuestionId: input.source?.source_question_id ?? null,
    });
  item = { ...item, status: "running", last_error: null };

  const analysis = analyzePattern({
    source: sourceQuestion,
    instructions: input.instructions ?? null,
    analysisId: `${item.item_id}:analysis`,
    ...(input.now ? { now: input.now } : {}),
  });
  if (!item.completed_stages.includes("analysis")) {
    item = withStage(item, "analysis");
    await checkpoint(input, item, input.existingQuestion ?? null);
  }

  const skill = skillByType(analysis.skill_type);
  const spec = buildGenerationSpec(analysis, {
    sourceQuestionId: input.source?.source_question_id ?? null,
    ...(input.audience ? { audience: input.audience } : {}),
    visualRequired: skill?.visual === true,
    mathValidationRequired: skill?.family === "math" && skill.deterministic_oracle,
  });

  let question = input.existingQuestion ?? null;
  let attempts = item.attempt_count;

  const produce = async (attempt: number): Promise<Question> => {
    input.onProduce?.();
    const questionId = item.candidate_question_id ?? crypto.randomUUID();
    item = { ...item, candidate_question_id: questionId };
    const seedKey = `${item.idempotency_key}:${attempt}`;
    if (analysis.skill_type === "number_series") {
      const generated = generateNumberSeriesQuestion({
        seedKey,
        questionId,
        number: input.number,
        sourceQuestionId: input.source?.source_question_id ?? null,
        jobId: input.jobId,
      });
      return generated.question;
    }
    if (analysis.skill_type === "mirror_image") {
      if (
        input.describeSourceFigure &&
        sourceQuestion?.figures.some((figure) => figure.image_path)
      ) {
        try {
          await input.describeSourceFigure();
        } catch {
          // A vision failure still leaves a new spec to draw. The crop is not traced.
        }
      }
      const mirror = inventMirrorSpec(seedKey);
      const draft = emptyQuestion({
        id: questionId,
        number: input.number,
        type: "mcq",
        skill_type: "mirror_image",
        stem: "Which option shows the exact vertical mirror image of the figure?",
        options: ["A", "B", "C", "D"].map((key) => ({
          key,
          text: "",
          is_correct: key === mirror.correct_key,
        })),
        answer_keys: [mirror.correct_key],
        hint: "Reflect each part across a vertical line down the middle.",
        explanation: `Option ${mirror.correct_key} is the vertical mirror. The other options are turned or flipped a different way.`,
        marks: 1,
        difficulty: "medium",
        tags: ["mirror_image"],
        approved: false,
        approval_status: "generated",
        source_question_id: input.source?.source_question_id ?? null,
        generation_job_id: input.jobId,
        source: input.source?.source_question_id ?? "ai_mock",
      });
      return attachMirrorAssets({
        question: draft,
        spec: mirror,
        store: input.assetStore,
        documentId: input.documentId,
        idempotencyKey: item.idempotency_key,
      });
    }
    if (analysis.skill_type === "grammar") {
      if (!input.callGrammarModel) throw new Error("Grammar generation needs a model call.");
      const raw = await input.callGrammarModel(spec);
      const parsed = normalizeQuestion(raw, 0);
      parsed.id = questionId;
      parsed.number = input.number;
      parsed.skill_type = "grammar";
      parsed.approved = false;
      parsed.approval_status = "generated";
      parsed.source_question_id = input.source?.source_question_id ?? null;
      parsed.generation_job_id = input.jobId;
      parsed.source = input.source?.source_question_id ?? "ai_mock";
      return parsed;
    }
    if (!input.callLegacyModel) {
      return emptyQuestion({
        id: questionId,
        number: input.number,
        type: "unknown",
        skill_type: analysis.skill_type,
        stem: "This skill is not generated automatically yet.",
        approved: false,
        approval_status: "generated",
        source_question_id: input.source?.source_question_id ?? null,
        generation_job_id: input.jobId,
      });
    }
    const legacy = await input.callLegacyModel();
    legacy.id = questionId;
    legacy.approved = false;
    legacy.approval_status = "generated";
    legacy.source_question_id =
      input.source?.source_question_id ?? legacy.source_question_id ?? null;
    legacy.generation_job_id = input.jobId;
    if (!legacy.skill_type) legacy.skill_type = analysis.skill_type;
    return legacy;
  };

  const validate = (candidate: Question): ValidationResult => {
    if (analysis.skill_type === "number_series")
      return validateNumberSeriesQuestion(candidate, input.now);
    if (analysis.skill_type === "mirror_image") {
      const mirror = candidate.visual_spec;
      if (!mirror || mirror["kind"] !== "mirror_image") {
        return {
          status: "failed",
          checks: [{ name: "visual", status: "failed", details: "Missing mirror spec." }],
          errors: ["Missing mirror spec."],
          validator_version: "slice-1",
          created_at: input.now ?? new Date().toISOString(),
        };
      }
      const svgs = mirrorOptionSvgs(mirror as unknown as Parameters<typeof mirrorOptionSvgs>[0]);
      return validateMirrorSvgs(
        mirror as unknown as Parameters<typeof validateMirrorSvgs>[0],
        svgs,
        input.now,
      );
    }
    if (analysis.skill_type === "grammar") {
      return validateGrammarQuestion(candidate, sourceQuestion?.stem ?? null, input.now);
    }
    return {
      status: "needs_review",
      checks: [
        {
          name: "skill",
          status: "needs_review",
          details: "This skill has no automatic oracle, so a person needs to review it.",
        },
      ],
      errors: [],
      validator_version: "slice-1",
      created_at: input.now ?? new Date().toISOString(),
    };
  };

  while (attempts <= MAX_GENERATION_ATTEMPTS) {
    if (!item.completed_stages.includes("generation") || !question) {
      if (attempts >= MAX_GENERATION_ATTEMPTS) break;
      question = await produce(attempts);
      attempts += 1;
      item = {
        ...withStage(
          { ...item, attempt_count: attempts, candidate_question_id: question.id },
          "generation",
        ),
      };
      await checkpoint(input, item, question);
    }

    if (!question) break;
    if (!item.completed_stages.includes("validation")) {
      const result = validate(question);
      if (result.status === "failed" && attempts < MAX_GENERATION_ATTEMPTS) {
        item = {
          ...item,
          completed_stages: item.completed_stages.filter(
            (stage) => stage !== "generation" && stage !== "validation" && stage !== "asset",
          ),
          validation_status: "failed",
          status: "retryable",
        };
        question = null;
        await checkpoint(input, item, null);
        continue;
      }
      const terminal = result.status === "failed" ? "needs_review" : result.status;
      question = applyValidation(question, { ...result, status: terminal });
      item = withStage(
        { ...item, validation_status: terminal, attempt_count: attempts },
        "validation",
      );
      await checkpoint(input, item, question);
    }
    break;
  }

  if (!question) {
    throw new Error("Generation did not produce a question.");
  }

  if (!item.completed_stages.includes("asset")) {
    item = withStage(item, "asset");
    await checkpoint(input, item, question);
  }

  const terminalStatus = item.validation_status === "passed" ? "completed" : "needs_review";
  item = withStage({ ...item, status: terminalStatus, stage: "review" }, "review");
  await checkpoint(input, item, question);

  if (sourceSnapshot != null && JSON.stringify(sourceQuestion) !== sourceSnapshot) {
    throw new Error("Generation mutated the source question.");
  }
  return { item, question, analysis };
}
