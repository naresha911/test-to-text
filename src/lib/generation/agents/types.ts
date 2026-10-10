import type { Question } from "@/lib/question-schema";
import type { SyllabusSubject } from "@/lib/syllabus";

/** Named agents the generation layer exposes. */
export type AgentId = "paper-architect" | "question-author" | "calibrator";

/** One planned group of questions sharing a skill / subject / variant. */
export type SlotPlan = {
  skill: string;
  pattern_subtype: string | null;
  subject_id: number | null;
  subject_key: string;
  topic: string;
  count: number;
  difficulty_step: number;
};

/** A full paper plan derived from a syllabus (and optionally learned skills). */
export type PaperPlan = {
  standard_id: number;
  label: string;
  slots: SlotPlan[];
  total: number;
};

/** What the question-author needs to generate one slot's next question. */
export type AuthorBrief = {
  slot: SlotPlan;
  standard_id: number | null;
  subject_id: number | null;
  stream_id: number | null;
  grade: number | null;
  exemplars: Question[];
};

export type SubjectIdResolver = (subject: SyllabusSubject) => number | null;
