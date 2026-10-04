import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { completeExamChat, type ExamImage } from "@/lib/generation/exam-chat";
import { localCheckedSolution } from "@/lib/generation/hint-solve";
import { buildSearchQuery } from "@/lib/generation/web-search";
import { omniroutersApiKey } from "@/lib/generation/chat-provider";
import {
  buildSolutionUserPrompt,
  questionHasAnswer,
  SOLUTION_SYSTEM_PROMPT,
  type SolutionAudience,
} from "@/lib/question-context";
import { applyHintSolution, type HintSolutionResult } from "@/lib/hint-solution";
import { readLocalImageDataUrl } from "@/lib/local-db";
import { emptyQuestion, type Question } from "@/lib/question-schema";

/** Prefer free OpenRouter routes; models[] lets OpenRouter fall back if one is down. */
export const DEFAULT_SOLUTION_MODEL = "google/gemma-4-26b-a4b-it:free";
export const SOLUTION_MODEL_FALLBACKS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
] as const;

const OptionSchema = z.object({
  key: z.string(),
  text: z.string(),
  is_correct: z.boolean().nullable().optional(),
  image_path: z.string().nullable().optional(),
});

const QuestionInputSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  type: z.string(),
  stem: z.string(),
  instructions: z.string().nullable().optional(),
  passage: z.string().nullable().optional(),
  assertion: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  options: z.array(OptionSchema).default([]),
  blanks: z.array(z.string()).default([]),
  match_pairs: z.array(z.object({ left: z.string(), right: z.string() })).default([]),
  sub_questions: z.array(z.unknown()).default([]),
  answer_keys: z.array(z.string()).default([]),
  answer_text: z.string().nullable().optional(),
  answer_boolean: z.boolean().nullable().optional(),
  hint: z.string().nullable().optional(),
  explanation: z.string().nullable().optional(),
  marks: z.number().nullable().optional(),
  section: z.string().nullable().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).nullable().optional(),
  tags: z.array(z.string()).default([]),
  figures: z
    .array(
      z.object({
        description: z.string(),
        caption: z.string().nullable().optional(),
        image_path: z.string().nullable().optional(),
      }),
    )
    .default([]),
  page: z.number().nullable().optional(),
  confidence: z.number().nullable().optional(),
  approved: z.boolean().optional(),
  math_spec: z.record(z.string(), z.unknown()).nullable().optional(),
});

const InputSchema = z.object({
  question: QuestionInputSchema,
  parentPassage: z.string().max(20000).nullable().optional(),
  parentImagePaths: z.array(z.string().max(500)).max(6).optional(),
  /** When true, overwrite existing hint and explanation. */
  force: z.boolean().optional().default(false),
  /** Replaces the generated user message. The fixed instructions are still sent. */
  userPrompt: z.string().max(80_000).optional(),
  audience: z
    .object({
      subject: z.string().max(200).nullable().optional(),
      exam: z.string().max(200).nullable().optional(),
      notes: z.string().max(600).nullable().optional(),
    })
    .optional(),
  model: z.string().min(2).max(120).optional(),
});

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
        /* fall through */
      }
    }
    return null;
  }
}

function solutionAcceptable(text: string, question: Question): boolean {
  const parsed = extractJson(text);
  if (!parsed) return false;
  const result = parseResult(parsed, question);
  if (!result.hint && !result.explanation) return false;
  return questionHasAnswer(applyHintSolution(question, result, true));
}

async function solutionImages(question: Question, parentPaths: string[]): Promise<ExamImage[]> {
  const labeled: { path: string; label: string }[] = [];
  question.figures.forEach((figure, index) => {
    if (figure.image_path) {
      labeled.push({
        path: figure.image_path,
        label: figure.caption?.trim() || figure.description.trim() || `Figure ${index + 1}`,
      });
    }
  });
  question.options.forEach((option) => {
    if (option.image_path) labeled.push({ path: option.image_path, label: `Option ${option.key}` });
  });
  parentPaths.forEach((path, index) => {
    labeled.push({ path, label: `Passage figure ${index + 1}` });
  });
  const images: ExamImage[] = [];
  for (const item of labeled.slice(0, 6)) {
    const dataUrl = await readLocalImageDataUrl(item.path);
    if (dataUrl) images.push({ dataUrl, label: item.label });
  }
  return images;
}

function asQuestion(raw: z.infer<typeof QuestionInputSchema>): Question {
  return emptyQuestion({
    id: raw.id,
    number: raw.number,
    type: raw.type as Question["type"],
    stem: raw.stem,
    instructions: raw.instructions ?? null,
    passage: raw.passage ?? null,
    assertion: raw.assertion ?? null,
    reason: raw.reason ?? null,
    options: (raw.options ?? []).map((option) => ({
      key: option.key,
      text: option.text,
      is_correct: option.is_correct ?? null,
      image_path: option.image_path ?? null,
    })),
    blanks: raw.blanks ?? [],
    match_pairs: raw.match_pairs ?? [],
    answer_keys: raw.answer_keys ?? [],
    answer_text: raw.answer_text ?? null,
    answer_boolean: raw.answer_boolean ?? null,
    hint: raw.hint ?? null,
    explanation: raw.explanation ?? null,
    marks: raw.marks ?? null,
    section: raw.section ?? null,
    difficulty: raw.difficulty ?? null,
    tags: raw.tags ?? [],
    page: raw.page ?? null,
    confidence: raw.confidence ?? null,
    approved: raw.approved === true,
    figures: (raw.figures ?? []).map((f) => ({
      description: f.description,
      caption: f.caption ?? null,
      image_path: f.image_path ?? null,
    })),
    sub_questions: [],
    math_spec: (raw.math_spec as Question["math_spec"]) ?? null,
  });
}

function checkedHintResult(
  question: Question,
  local: { hint: string; explanation: string; answerText: string },
): HintSolutionResult {
  const answerText = local.answerText;
  const matchingKeys = question.options
    .filter((option) => option.text.trim() === answerText)
    .map((option) => option.key);
  const markOptions = matchingKeys.length > 0;
  const answerBoolean =
    question.type === "true_false"
      ? answerText.toLowerCase() === "true"
        ? true
        : answerText.toLowerCase() === "false"
          ? false
          : null
      : null;
  return {
    hint: local.hint,
    explanation: local.explanation,
    answer_keys: markOptions ? matchingKeys : question.answer_keys,
    answer_text: answerText,
    answer_boolean: answerBoolean,
    options: question.options.map((option) => ({
      key: option.key,
      text: option.text,
      is_correct: markOptions ? matchingKeys.includes(option.key) : (option.is_correct ?? null),
    })),
    blanks:
      question.type === "fill_blank"
        ? question.blanks.length
          ? question.blanks.map(() => answerText)
          : [answerText]
        : question.blanks,
    match_pairs: question.match_pairs,
  };
}

function parseResult(raw: unknown, source: Question): HintSolutionResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);

  const options = arr(r["options"]).map((o, i) => {
    const oo = (o ?? {}) as Record<string, unknown>;
    const fallback = source.options[i];
    return {
      key: str(oo["key"]) ?? fallback?.key ?? String.fromCharCode(65 + i),
      text: str(oo["text"]) ?? fallback?.text ?? "",
      is_correct:
        typeof oo["is_correct"] === "boolean"
          ? (oo["is_correct"] as boolean)
          : (fallback?.is_correct ?? null),
    };
  });

  return {
    hint: str(r["hint"]),
    explanation: str(r["explanation"]),
    answer_keys: arr(r["answer_keys"]).filter((k): k is string => typeof k === "string"),
    answer_text: str(r["answer_text"]),
    answer_boolean:
      typeof r["answer_boolean"] === "boolean" ? (r["answer_boolean"] as boolean) : null,
    options: options.length
      ? options
      : source.options.map((o) => ({ ...o, is_correct: o.is_correct ?? null })),
    blanks: arr(r["blanks"]).map((b) => (typeof b === "string" ? b : "")),
    match_pairs: arr(r["match_pairs"]).map((p, i) => {
      const pp = (p ?? {}) as Record<string, unknown>;
      const fallback = source.match_pairs[i];
      return {
        left: str(pp["left"]) ?? fallback?.left ?? "",
        right: str(pp["right"]) ?? fallback?.right ?? "",
      };
    }),
  };
}

export const generateHintSolution = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<HintSolutionResult> => {
    const question = asQuestion(data.question);
    if (
      !data.force &&
      question.hint?.trim() &&
      question.explanation?.trim() &&
      questionHasAnswer(question)
    ) {
      return {
        hint: question.hint,
        explanation: question.explanation,
        answer_keys: question.answer_keys,
        answer_text: question.answer_text ?? null,
        answer_boolean: question.answer_boolean ?? null,
        options: question.options.map((o) => ({
          key: o.key,
          text: o.text,
          is_correct: o.is_correct ?? null,
        })),
        blanks: question.blanks,
        match_pairs: question.match_pairs,
      };
    }

    const local = localCheckedSolution({
      math_spec: question.math_spec ?? null,
      stem: question.stem,
    });
    if (local) return checkedHintResult(question, local);

    const omniroutersKey = omniroutersApiKey();
    const openRouterKey = process.env["OPENROUTER_API_KEY"];
    const lovableKey = process.env["LOVABLE_API_KEY"];
    if (!omniroutersKey && !openRouterKey && !lovableKey) {
      throw new Error(
        "No AI key is configured for hints and solutions. Add OMNIROUTERS_API_KEY, OPENROUTER_API_KEY, or LOVABLE_API_KEY in .env.local (or Lovable project secrets), then restart the server.",
      );
    }

    const audience: SolutionAudience | undefined = data.audience
      ? {
          subject: data.audience.subject ?? null,
          exam: data.audience.exam ?? null,
          notes: data.audience.notes ?? null,
        }
      : undefined;
    const images = await solutionImages(question, data.parentImagePaths ?? []);
    const userContent =
      data.userPrompt?.trim() ||
      buildSolutionUserPrompt(question, {
        parentPassage: data.parentPassage ?? null,
        ...(audience ? { audience } : {}),
        force: data.force,
        ...(images.length ? { hasImages: true } : {}),
      });

    const messages = [
      { role: "system" as const, content: SOLUTION_SYSTEM_PROMPT },
      { role: "user" as const, content: userContent },
    ];

    const chat = await completeExamChat({
      messages,
      images,
      searchQuery: buildSearchQuery({
        stem: question.stem,
        subject: audience?.subject,
        exam: audience?.exam,
      }),
      accept: (text) => solutionAcceptable(text, question),
    });

    const parsed = extractJson(chat.text);
    if (!parsed) {
      throw new Error("The solution model returned unreadable output. Try again.");
    }
    const result = parseResult(parsed, question);
    if (!result.hint && !result.explanation) {
      throw new Error("The solution model did not return a hint or solution. Try again.");
    }
    if (!chat.accepted) {
      throw new Error("No right answer was found. Edit the AI prompt and regenerate.");
    }
    return result;
  });
