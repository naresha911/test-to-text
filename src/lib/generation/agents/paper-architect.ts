import type { PaperPlan, SlotPlan, SubjectIdResolver } from "@/lib/generation/agents/types";
import type { Syllabus } from "@/lib/syllabus/types";

/**
 * Expand a syllabus into slot plans. One slot per syllabus skill line; the
 * slot's count is how many questions to generate for it. Learned skills for
 * the class can be folded in so the agent also practises patterns it has
 * seen in source questions but that the syllabus does not name.
 */
export function buildPaperPlan(input: {
  syllabus: Syllabus;
  /** Optional subset of subject keys, e.g. ["mathematics"]. */
  subjectKeys?: string[] | null;
  /** Resolves a syllabus subject to a catalog subject id. */
  resolveSubjectId?: SubjectIdResolver;
  difficultyStep?: number;
  /** Extra learned skills to add, as {subject_key, skill, pattern_subtype, count}. */
  learnedExtras?: {
    subject_key: string;
    skill: string;
    pattern_subtype: string | null;
    count: number;
  }[];
}): PaperPlan {
  const wanted = input.subjectKeys?.length ? new Set(input.subjectKeys) : null;
  const subjects = wanted
    ? input.syllabus.subjects.filter((subject) => wanted.has(subject.key))
    : input.syllabus.subjects;

  const slots: SlotPlan[] = [];
  for (const subject of subjects) {
    const subject_id = input.resolveSubjectId?.(subject) ?? null;
    for (const section of subject.sections) {
      for (const item of section.skills) {
        if (item.count <= 0) continue;
        slots.push({
          skill: item.skill,
          pattern_subtype: item.pattern_subtype ?? null,
          subject_id,
          subject_key: subject.key,
          topic: item.topic,
          count: item.count,
          difficulty_step: input.difficultyStep ?? 0,
        });
      }
    }
  }

  for (const extra of input.learnedExtras ?? []) {
    if (extra.count <= 0) continue;
    if (wanted && !wanted.has(extra.subject_key)) continue;
    // Skip an extra that duplicates a slot the syllabus already produced,
    // otherwise it would inflate the total and repeat questions.
    if (
      slots.some(
        (slot) =>
          slot.subject_key === extra.subject_key &&
          slot.skill === extra.skill &&
          (slot.pattern_subtype ?? null) === (extra.pattern_subtype ?? null)
      )
    ) {
      continue;
    }
    const subject = input.syllabus.subjects.find((entry) => entry.key === extra.subject_key);
    slots.push({
      skill: extra.skill,
      pattern_subtype: extra.pattern_subtype,
      subject_id: input.resolveSubjectId && subject ? input.resolveSubjectId(subject) : null,
      subject_key: extra.subject_key,
      topic: "Learned pattern",
      count: extra.count,
      difficulty_step: input.difficultyStep ?? 0,
    });
  }

  return {
    standard_id: input.syllabus.standard_id,
    label: input.syllabus.label,
    slots,
    total: slots.reduce((sum, slot) => sum + slot.count, 0),
  };
}

/** Flatten a plan into one slot entry per question, in generation order. */
export function expandSlots(slots: SlotPlan[]): SlotPlan[] {
  const sequence: SlotPlan[] = [];
  for (const slot of slots) {
    for (let index = 0; index < slot.count; index += 1) sequence.push({ ...slot });
  }
  return sequence;
}
