import type { GenerationSpec } from "@/lib/generation/generation-spec";

export function buildGrammarUserPrompt(spec: GenerationSpec): string {
  const focus = typeof spec.pattern["focus"] === "string" ? spec.pattern["focus"] : "grammar usage";
  const standard = spec.audience.standard?.trim() || "the stated class";
  return [
    "Write ONE original multiple-choice grammar question.",
    `Skill focus: ${focus}.`,
    `Learning intent: ${spec.learning_intent}`,
    `Audience standard: ${standard}.`,
    spec.audience.subject ? `Subject: ${spec.audience.subject}.` : "",
    "Use four options labelled A, B, C, and D. Mark exactly one option correct with is_correct and answer_keys.",
    "Include a short hint that does not reveal the answer, and a full explanation.",
    "Do not copy a source sentence. Invent a new example.",
    'Return only JSON: {"type":"mcq","stem":"...","options":[{"key":"A","text":"...","is_correct":true}],"answer_keys":["A"],"hint":"...","explanation":"...","difficulty":"medium","marks":1}',
  ]
    .filter(Boolean)
    .join("\n");
}
