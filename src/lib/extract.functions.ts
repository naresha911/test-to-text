import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeQuestion, type Question } from "@/lib/question-schema";

const InputSchema = z.object({
  /** Full data URL of the page image, e.g. data:image/jpeg;base64,... */
  imageDataUrl: z.string().min(32),
  /** Zero-based index of the page inside the upload set. */
  page: z.number().int().min(0),
  /** Optional user hint, e.g. "CBSE class 10 maths, answers are printed at the end". */
  hint: z.string().max(600).optional(),
});

const SYSTEM_PROMPT = `You are an exam-paper digitiser. You read a scanned or photographed page of a question paper, practice test or intelligence test and return it as structured JSON.

RULES
1. Transcribe faithfully. Never invent questions, options or answers that are not printed on the page.
2. Mathematics, chemistry and logic notation MUST be LaTeX: inline as $...$ and display as $$...$$. Example: "Solve $x^2 - 5x + 6 = 0$". Never describe an equation in words when it is printed as notation.
3. Figures, shapes, matrices-as-pictures, graphs, circuit diagrams, pattern/sequence puzzles: add an entry to "figures" with a precise "description" a person could redraw from, and a "bbox" as [x, y, width, height] normalised 0..1 relative to the whole page, tightly around the figure.
4. Classify each question's "type" as exactly one of: mcq, multi_select, true_false, fill_blank, assertion_reason, comprehension, match_the_following, short_answer, long_answer, numerical, diagram, unknown.
   - mcq: one correct option. multi_select: more than one correct option.
   - fill_blank: put one entry in "blanks" for every blank, in order (empty string if the answer is not printed). Keep the blank in the stem as "____".
   - assertion_reason: put the assertion in "assertion", the reason in "reason", and the standard option set in "options".
   - comprehension: put the shared passage/case study in "passage" and every child question in "sub_questions".
   - match_the_following: put every printed pairing in "match_pairs" (left column item and its right column item; if the correct pairing is not printed, still list the left items with an empty right).
   - diagram: the question cannot be answered without the figure (typical for intelligence/aptitude tests).
5. Only fill "answer_keys", "answer_text", "answer_boolean" or "explanation" when the page actually prints the answer or solution.
6. Carry over "number", "marks", "section" and "instructions" exactly as printed. Set "confidence" between 0 and 1 for how sure you are of the transcription.
7. If a question is cut off at the page edge, still return what is visible and lower "confidence".
8. Return ONLY JSON. No prose, no markdown fences.

OUTPUT SHAPE
{"questions":[{"number":"12","type":"mcq","stem":"...","instructions":null,"passage":null,"assertion":null,"reason":null,"options":[{"key":"A","text":"...","is_correct":false}],"blanks":[],"match_pairs":[],"sub_questions":[],"answer_keys":[],"answer_text":null,"answer_boolean":null,"explanation":null,"marks":1,"section":"A","difficulty":null,"tags":[],"figures":[{"description":"...","caption":null,"bbox":[0.1,0.2,0.3,0.2]}],"confidence":0.95}]}`;

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

/** Streamed chat completion, consumed server-side so long pages don't hit request timeouts. */
async function callGateway(apiKey: string, imageDataUrl: string, hint?: string): Promise<string> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "google/gemini-3.8-flash",
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: hint
                ? `Digitise this page. Context from the user: ${hint}`
                : "Digitise this page.",
            },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    let message = body;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
      message = parsed.error?.message ?? parsed.message ?? body;
    } catch {
      /* keep raw body */
    }
    if (response.status === 429) {
      throw new Error("The AI reader is busy right now. Wait a moment and try this page again.");
    }
    if (response.status === 402 || response.status === 403) {
      throw new Error(message || "AI credits are unavailable for this workspace.");
    }
    throw new Error(message || `AI reader failed (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
        };
        text += chunk.choices?.[0]?.delta?.content ?? "";
      } catch {
        /* ignore keep-alive / partial frames */
      }
    }
  }

  return text;
}

export const extractPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: Question[]; raw: string }> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const text = await callGateway(apiKey, data.imageDataUrl, data.hint);
    const parsed = extractJson(text) as { questions?: unknown[] } | null;
    const list = Array.isArray(parsed?.questions) ? parsed.questions : [];

    return {
      questions: list.map((q) => normalizeQuestion(q, data.page)),
      raw: list.length ? "" : text.slice(0, 2000),
    };
  });
