import { describe, expect, test } from "bun:test";

import { SKILL_CATALOG } from "@/lib/question-taxonomy";
import { listSyllabi, loadSyllabus, subjectTotal, syllabusTotal } from "@/lib/syllabus";

describe("syllabus config", () => {
  test("every skill named in a finalized syllabus exists in the catalog", () => {
    const known = new Set(SKILL_CATALOG.map((entry) => entry.skill_type));
    for (const syllabus of listSyllabi()) {
      if (syllabus.draft) continue;
      for (const subject of syllabus.subjects) {
        for (const section of subject.sections) {
          for (const skill of section.skills) {
            expect(known.has(skill.skill), `${skill.skill} in ${subject.key}`).toBe(true);
          }
        }
      }
    }
  });

  test("Class 6 has 50 math / 25 GK / 25 English / 25 intelligence", () => {
    const syllabus = loadSyllabus(5);
    expect(syllabus).not.toBeNull();
    if (!syllabus) return;
    expect(syllabusTotal(syllabus)).toBe(125);
    expect(syllabus.subjects.map((subject) => subjectTotal(subject))).toEqual([50, 25, 25, 25]);
  });

  test("Class 6 covers the new deterministic skills", () => {
    const syllabus = loadSyllabus(5);
    if (!syllabus) return;
    const skills = new Set<string>();
    for (const subject of syllabus.subjects) {
      for (const section of subject.sections) {
        for (const skill of section.skills) skills.add(skill.skill);
      }
    }
    for (const expected of [
      "roman_numerals",
      "lcm_hcf",
      "bodmas",
      "decimals",
      "circle",
      "volume_solid",
      "temperature_conversion",
      "number_properties",
      "water_image",
      "question_tags",
    ]) {
      expect(skills.has(expected), expected).toBe(true);
    }
  });

  test("Class 9 has 50 math / 25 science / 25 social / 25 English / 25 intelligence", () => {
    const syllabus = loadSyllabus(8);
    expect(syllabus).not.toBeNull();
    if (!syllabus) return;
    expect(syllabusTotal(syllabus)).toBe(150);
    expect(syllabus.subjects.map((subject) => subjectTotal(subject))).toEqual([50, 25, 25, 25, 25]);
  });

  test("Class 9 names the new deterministic skills", () => {
    const syllabus = loadSyllabus(8);
    if (!syllabus) return;
    const skills = new Set<string>();
    for (const subject of syllabus.subjects) {
      for (const section of subject.sections) {
        for (const skill of section.skills) skills.add(skill.skill);
      }
    }
    for (const expected of [
      "rational_numbers",
      "squares_roots",
      "cubes_roots",
      "algebraic_identities",
      "factorization",
      "exponents",
      "proportion",
      "quadrilaterals",
      "triangle_properties",
      "parallel_lines",
      "euler_formula",
      "surface_area_volume",
      "discount",
      "compound_interest",
      "statistics",
      "probability",
      "data_interpretation",
      "graphs",
      "matrix_coding",
      "syllogism",
      "spotting_errors",
      "critical_thinking",
    ]) {
      expect(skills.has(expected), expected).toBe(true);
    }
  });
});
