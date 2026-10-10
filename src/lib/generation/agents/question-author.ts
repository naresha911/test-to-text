import type { AuthorBrief } from "@/lib/generation/agents/types";
import { calibrationScopeKey } from "@/lib/generation/calibration/types";
import type { DocumentKind, SourceAgentId } from "@/lib/document-types";
import { examplesFor, learnedSkillsFor, type ExampleScope } from "@/lib/generation/learning";
import { readCalibrationProfile, type LearnedSkill } from "@/lib/local-db";
import type { Question } from "@/lib/question-schema";

/** Server-side helpers for the question-author agent (retrieval from the library). */

export type BriefScope = {
  skill: string;
  pattern_subtype?: string | null;
  standard_id?: number | null;
  subject_id?: number | null;
  stream_id?: number | null;
  /** Restrict exemplars to the agent's source document kinds. */
  kinds?: DocumentKind[];
  /** The agent whose calibration profile tunes this retrieval. */
  agent?: SourceAgentId | null;
};

export function scopeForBrief(scope: BriefScope): ExampleScope {
  return {
    standard_id: scope.standard_id ?? null,
    subject_id: scope.subject_id ?? null,
    stream_id: scope.stream_id ?? null,
    skill_type: scope.skill,
    pattern_subtype: scope.pattern_subtype ?? null,
    ...(scope.kinds?.length ? { kinds: scope.kinds } : {}),
  };
}

/** Source questions to show the model as reference for this slot. */
export async function loadExemplars(scope: BriefScope, limit = 3): Promise<Question[]> {
  const base = scopeForBrief(scope);
  let effectiveLimit = limit;
  let subtype = base.pattern_subtype ?? null;
  try {
    // Calibration may have auto-tuned how many references this skill sees.
    const profile = await readCalibrationProfile(
      calibrationScopeKey({
        agent: scope.agent ?? null,
        standard_id: scope.standard_id ?? null,
        subject_id: scope.subject_id ?? null,
        stream_id: scope.stream_id ?? null,
      }),
      scope.skill,
    );
    if (profile?.exemplar_limit != null) effectiveLimit = profile.exemplar_limit;
    if (profile?.exemplar_scope === "skill") subtype = null;
  } catch {
    // The profile is optional; retrieval still works without it.
  }
  return examplesFor({ ...base, pattern_subtype: subtype }, effectiveLimit);
}

/**
 * How much the calibrated difficulty step should shift for this skill in
 * this scope (-1 easier, 0 unchanged, +1 harder). Mirrors loadExemplars'
 * profile lookup; a missing or unreadable profile biases nothing.
 */
export async function difficultyBiasFor(
  scope: {
    agent?: SourceAgentId | null;
    standard_id?: number | null;
    subject_id?: number | null;
    stream_id?: number | null;
  },
  skill: string,
): Promise<number> {
  try {
    const profile = await readCalibrationProfile(
      calibrationScopeKey({
        agent: scope.agent ?? null,
        standard_id: scope.standard_id ?? null,
        subject_id: scope.subject_id ?? null,
        stream_id: scope.stream_id ?? null,
      }),
      skill,
    );
    return profile?.difficulty_bias ?? 0;
  } catch {
    return 0;
  }
}

/** What the agent has learned for a class / subject / stream. */
export async function knownSkills(scope: {
  standard_id?: number | null;
  subject_id?: number | null;
  stream_id?: number | null;
}): Promise<LearnedSkill[]> {
  return learnedSkillsFor(scope);
}

export type { AuthorBrief };
