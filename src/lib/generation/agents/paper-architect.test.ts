import { describe, expect, test } from "bun:test";

import { buildPaperPlan, expandSlots } from "@/lib/generation/agents/paper-architect";
import { loadSyllabus, subjectTotal, syllabusTotal } from "@/lib/syllabus";

describe("paper architect", () => {
  test("the Class 6 plan matches the syllabus totals", () => {
    const syllabus = loadSyllabus(5);
    expect(syllabus).not.toBeNull();
    if (!syllabus) return;
    const plan = buildPaperPlan({ syllabus });
    expect(plan.total).toBe(syllabusTotal(syllabus));
    expect(plan.total).toBe(125);
    expect(plan.slots.length).toBeGreaterThan(0);
    expect(plan.standard_id).toBe(5);
  });

  test("subject totals follow the brief (50/25/25/25)", () => {
    const syllabus = loadSyllabus(5);
    if (!syllabus) throw new Error("Class 6 syllabus missing");
    expect(syllabus.subjects.map((subject) => subjectTotal(subject))).toEqual([50, 25, 25, 25]);
  });

  test("a subject filter keeps only that subject's slots", () => {
    const syllabus = loadSyllabus(5);
    if (!syllabus) throw new Error("Class 6 syllabus missing");
    const plan = buildPaperPlan({ syllabus, subjectKeys: ["intelligence"] });
    expect(plan.total).toBe(25);
    expect(plan.slots.every((slot) => slot.subject_key === "intelligence")).toBe(true);
  });

  test("expandSlots repeats each slot by its count", () => {
    const slots = [
      {
        skill: "a",
        pattern_subtype: null,
        subject_id: null,
        subject_key: "k",
        topic: "t",
        count: 3,
        difficulty_step: 0,
      },
      {
        skill: "b",
        pattern_subtype: "water",
        subject_id: 1,
        subject_key: "k",
        topic: "t2",
        count: 2,
        difficulty_step: 0,
      },
    ];
    const sequence = expandSlots(slots);
    expect(sequence).toHaveLength(5);
    expect(sequence.slice(0, 3).every((slot) => slot.skill === "a")).toBe(true);
    expect(sequence.slice(3).every((slot) => slot.skill === "b")).toBe(true);
  });
});
