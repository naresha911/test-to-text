import { detectSkill, type SkillDetectInput } from "@/lib/generation/skill-detect";

export type BlueprintSlot = {
  skill: string;
  count: number;
  grade: number | null;
  /** 0 matches the source. 1 is one step harder inside the class ceiling. */
  difficultyStep: number;
};

export type PaperBlueprint = {
  slots: BlueprintSlot[];
  /** Question numbers that were duplicated and counted once. */
  duplicateNumbers: string[];
};

function skillOf(question: SkillDetectInput & { id?: string }): string {
  return detectSkill(question);
}

/**
 * Count skills on a paper. Duplicate question numbers count once.
 * The order follows the first time each skill appears.
 */
export function blueprintFromQuestions(
  questions: Array<SkillDetectInput & { id?: string; number?: string | null }>,
  options: { grade?: number | null; difficultyStep?: number } = {},
): PaperBlueprint {
  const grade = options.grade ?? null;
  const difficultyStep = options.difficultyStep ?? 0;
  const seenNumbers = new Set<string>();
  const duplicateNumbers: string[] = [];
  const counts = new Map<string, number>();
  const order: string[] = [];

  for (const question of questions) {
    const number = question.number?.trim() ?? "";
    if (number) {
      if (seenNumbers.has(number)) {
        duplicateNumbers.push(number);
        continue;
      }
      seenNumbers.add(number);
    }
    const skill = skillOf(question);
    if (skill === "unsupported") continue;
    if (!counts.has(skill)) order.push(skill);
    counts.set(skill, (counts.get(skill) ?? 0) + 1);
  }

  return {
    slots: order.map((skill) => ({
      skill,
      count: counts.get(skill) ?? 0,
      grade,
      difficultyStep,
    })),
    duplicateNumbers,
  };
}

/**
 * Inclusive holes between the smallest and largest positive integer.
 * "34-35" is a run of missing numbers. "87" is a single missing number.
 * Non-numeric values are ignored. Nothing is reported outside that span.
 */
export function numberGaps(numbers: string[]): string[] {
  const parsed = new Set<number>();
  for (const raw of numbers) {
    const text = raw.trim();
    if (!/^\d+$/.test(text)) continue;
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < 1) continue;
    parsed.add(value);
  }
  const sorted = [...parsed].sort((left, right) => left - right);
  if (sorted.length < 2) return [];

  const gaps: string[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1] ?? 0;
    const current = sorted[index] ?? previous;
    if (current <= previous + 1) continue;
    const start = previous + 1;
    const end = current - 1;
    gaps.push(start === end ? String(start) : `${start}-${end}`);
  }
  return gaps;
}

/**
 * Repeat each slot's exemplar id `count` times, in slot order.
 * A skill with no exemplar id is left out.
 */
export function expandBlueprint(
  slots: BlueprintSlot[],
  exemplars: Record<string, string>,
): string[] {
  const ids: string[] = [];
  for (const slot of slots) {
    const exemplar = exemplars[slot.skill];
    if (!exemplar) continue;
    for (let index = 0; index < slot.count; index += 1) ids.push(exemplar);
  }
  return ids;
}

/** One skill, a count, and a class. This does not copy the rest of a paper. */
export function drillBlueprint(input: {
  skill: string;
  count: number;
  grade?: number | null;
  difficultyStep?: number;
}): BlueprintSlot {
  const count = Math.max(1, Math.min(80, Math.floor(input.count)));
  return {
    skill: input.skill,
    count,
    grade: input.grade ?? null,
    difficultyStep: input.difficultyStep ?? 0,
  };
}
