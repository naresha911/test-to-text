import class6 from "@/lib/syllabus/class6.json";
import class9 from "@/lib/syllabus/class9.json";
import type { Syllabus } from "@/lib/syllabus/types";

export type {
  Syllabus,
  SyllabusSection,
  SyllabusSkill,
  SyllabusSubject,
} from "@/lib/syllabus/types";
export { subjectTotal, syllabusTotal } from "@/lib/syllabus/types";

/** AISSEE Class 6 = standard id 5, Class 9 = standard id 8. */
const SYLLABI: Record<number, Syllabus> = {
  5: class6 as unknown as Syllabus,
  8: class9 as unknown as Syllabus,
};

export function loadSyllabus(standardId: number | null | undefined): Syllabus | null {
  if (standardId == null) return null;
  return SYLLABI[standardId] ?? null;
}

/** Grade 6 maps to the Class 6 syllabus; grade 9 and up to Class 9. */
export function syllabusForGrade(grade: number | null | undefined): Syllabus | null {
  if (grade == null) return null;
  return grade >= 9 ? loadSyllabus(8) : loadSyllabus(5);
}

export function listSyllabi(): Syllabus[] {
  return [SYLLABI[5] as Syllabus, SYLLABI[8] as Syllabus].filter(Boolean);
}
