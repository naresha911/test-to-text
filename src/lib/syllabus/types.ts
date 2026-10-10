/** Syllabus config shape. One file per class (AISSEE Class 6, Class 9). */

export type SyllabusSkill = {
  /** Human topic label, e.g. "Roman numerals". */
  topic: string;
  /** Skill id from SKILL_CATALOG, e.g. "roman_numerals". */
  skill: string;
  /** A fine pattern variant to prefer, e.g. "water" for mirror images. */
  pattern_subtype?: string | null;
  count: number;
};

export type SyllabusSection = {
  name: string;
  skills: SyllabusSkill[];
};

export type SyllabusSubject = {
  /** Stable key, e.g. "mathematics". */
  key: string;
  /** Display name, e.g. "Mathematics". */
  name: string;
  /** Catalog subject name used to resolve a subject_id at runtime. */
  catalog_subject: string | null;
  /** Alias names that also match the catalog subject. */
  catalog_aliases?: string[];
  sections: SyllabusSection[];
};

export type Syllabus = {
  /** AISSEE Class 6 uses standard id 5, Class 9 uses id 8. */
  standard_id: number;
  label: string;
  /** A draft syllabus is usable but not yet fully authored/tested. */
  draft?: boolean;
  subjects: SyllabusSubject[];
};

export function subjectTotal(subject: SyllabusSubject): number {
  const counts: number[] = [];
  for (const section of subject.sections) {
    for (const skill of section.skills) counts.push(skill.count);
  }
  return counts.reduce((sum, count) => sum + count, 0);
}

export function syllabusTotal(syllabus: Syllabus): number {
  const totals: number[] = [];
  for (const subject of syllabus.subjects) totals.push(subjectTotal(subject));
  return totals.reduce((sum, total) => sum + total, 0);
}
