import type { DocumentMeta } from "@/lib/document-types";
import { parseQuestionOrder } from "@/lib/question-order";
import type { Question, QuestionType } from "@/lib/question-schema";

export type ExamPrepQuestionType =
  | "mcq_single"
  | "mcq_multi"
  | "true_false"
  | "fill_blank"
  | "short_answer"
  | "matching"
  | "comprehension"
  | "assertion_reason";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type ExamPrepExport = {
  schema_version: 2;
  target: "rms-exam-prep";
  kind: DocumentMeta["kind"];
  tables: {
    papers: Json[];
    tests: Json[];
    test_sections: Json[];
    test_questions: Json[];
    paper_questions: Json[];
    questions: Json[];
    question_translations: Json[];
    question_options: Json[];
    option_translations: Json[];
    question_tags: Json[];
    question_groups: Json[];
    question_group_translations: Json[];
    group_questions: Json[];
    matching_items: Json[];
    matching_pairs: Json[];
  };
};

export function mapQuestionType(type: QuestionType, question: Question): ExamPrepQuestionType {
  switch (type) {
    case "mcq":
      return "mcq_single";
    case "multi_select":
      return "mcq_multi";
    case "true_false":
      return "true_false";
    case "fill_blank":
      return "fill_blank";
    case "assertion_reason":
      return "assertion_reason";
    case "comprehension":
      return "comprehension";
    case "match_the_following":
      return "matching";
    case "short_answer":
    case "long_answer":
    case "numerical":
      return "short_answer";
    case "diagram":
    case "unknown":
    default:
      return question.options.length ? "mcq_single" : "short_answer";
  }
}

function questionText(question: Question): string {
  if (question.type === "assertion_reason") {
    const parts = [
      question.assertion ? `Assertion: ${question.assertion}` : "",
      question.reason ? `Reason: ${question.reason}` : "",
      question.stem,
    ].filter(Boolean);
    return parts.join("\n") || question.stem;
  }
  if (question.passage && question.type === "comprehension") {
    return [question.passage, question.stem].filter(Boolean).join("\n\n");
  }
  return question.stem;
}

type FlatQ = {
  question: Question;
  order: number;
  groupId: string | null;
  groupOrder: number | null;
};

function flatten(questions: Question[]): FlatQ[] {
  const out: FlatQ[] = [];
  let order = 1;
  for (const question of questions) {
    if (question.type === "comprehension" && question.sub_questions.length) {
      const groupId = crypto.randomUUID();
      question.sub_questions.forEach((child, i) => {
        out.push({
          question: {
            ...child,
            passage: child.passage ?? question.passage ?? null,
            section: child.section ?? question.section ?? null,
            subject_id: child.subject_id ?? question.subject_id ?? null,
            topic_id: child.topic_id ?? question.topic_id ?? null,
            standard_id: child.standard_id ?? question.standard_id ?? null,
            stream_id: child.stream_id ?? question.stream_id ?? null,
          },
          order: order++,
          groupId,
          groupOrder: i + 1,
        });
      });
    } else {
      out.push({ question, order: order++, groupId: null, groupOrder: null });
    }
  }
  return out;
}

export function buildExamPrepExport(document: DocumentMeta, questions: Question[]): ExamPrepExport {
  const tables: ExamPrepExport["tables"] = {
    papers: [],
    tests: [],
    test_sections: [],
    test_questions: [],
    paper_questions: [],
    questions: [],
    question_translations: [],
    question_options: [],
    option_translations: [],
    question_tags: [],
    question_groups: [],
    question_group_translations: [],
    group_questions: [],
    matching_items: [],
    matching_pairs: [],
  };

  const ordered = [...questions].sort((a, b) => {
    const byPrinted = parseQuestionOrder(a.number) - parseQuestionOrder(b.number);
    if (byPrinted !== 0) return byPrinted;
    return (a.page ?? 0) - (b.page ?? 0);
  });
  const flat = flatten(ordered);
  const containerId = document.id;

  const sectionNames: string[] = [];
  for (const item of flat) {
    const name = item.question.section?.trim() || "General";
    if (!sectionNames.includes(name)) sectionNames.push(name);
  }

  const sectionIds = new Map<string, string>();
  const isTestKind = document.kind === "practice_test" || document.kind === "ai_mock";
  if (isTestKind) {
    sectionNames.forEach((name, i) => {
      const id = crypto.randomUUID();
      sectionIds.set(name, id);
      tables.test_sections.push({
        id,
        test_id: containerId,
        name,
        section_order: i + 1,
        instructions: null,
        time_limit_seconds: null,
        default_marks: document.default_marks ?? 1,
        default_negative_marks: document.default_negative_marks ?? 0,
      });
    });
    tables.tests.push({
      id: containerId,
      title: document.title,
      description: document.description ?? document.notes,
      standard_id: document.standard_id,
      stream_id: document.stream_id,
      creation_mode: "manual",
      total_marks: document.total_marks,
      duration_minutes: document.duration_minutes,
      section_timing: document.section_timing,
      negative_marking: document.negative_marking,
      allow_pause: document.allow_pause,
      max_attempts: document.max_attempts,
      is_published: false,
      created_by: null,
      created_at: document.created_at,
    });
  } else {
    tables.papers.push({
      id: containerId,
      title: document.title,
      year: document.year ?? new Date().getFullYear(),
      standard_id: document.standard_id,
      stream_id: document.stream_id,
      total_marks: document.total_marks,
      duration_minutes: document.duration_minutes,
      pdf_path: null,
      is_published: false,
      created_at: document.created_at,
      difficulty: document.difficulty,
    });
  }

  const seenGroups = new Set<string>();

  for (const item of flat) {
    const q = item.question;
    const examType = mapQuestionType(q.type, q);
    const firstFigure = q.figures.find((f) => f.image_path);
    const marks = q.marks ?? document.default_marks ?? 1;
    const negative = q.negative_marks ?? document.default_negative_marks ?? 0;
    const sectionName = q.section?.trim() || "General";

    tables.questions.push({
      id: q.id,
      question_type: examType,
      subject_id: q.subject_id ?? document.subject_id,
      topic_id: q.topic_id ?? null,
      standard_id: q.standard_id ?? document.standard_id,
      stream_id: q.stream_id ?? document.stream_id,
      difficulty: q.difficulty ?? document.difficulty ?? "medium",
      has_diagram: q.figures.length > 0,
      diagram_path: firstFigure?.image_path ?? null,
      marks,
      negative_marks: negative,
      year: q.year ?? document.year,
      source: q.source ?? document.source ?? document.exam,
      tags: q.tags,
      is_active: true,
      created_by: null,
      created_at: document.created_at,
      updated_at: document.updated_at,
    });

    tables.question_translations.push({
      id: crypto.randomUUID(),
      question_id: q.id,
      language_code: "en",
      question_text: questionText(q),
      explanation: q.explanation ?? null,
      explanation_diagram_path: null,
      hint: q.hint ?? null,
    });

    q.options.forEach((option, i) => {
      const optionId = crypto.randomUUID();
      const isCorrect =
        option.is_correct === true || q.answer_keys.includes(option.key);
      tables.question_options.push({
        id: optionId,
        question_id: q.id,
        option_key: option.key,
        is_correct: isCorrect,
        display_order: i + 1,
      });
      tables.option_translations.push({
        id: crypto.randomUUID(),
        option_id: optionId,
        language_code: "en",
        option_text: option.text,
        option_image_path: null,
      });
    });

    for (const tag of q.tags) {
      tables.question_tags.push({ question_id: q.id, tag });
    }

    if (examType === "matching" && q.match_pairs.length) {
      const leftIds: string[] = [];
      const rightIds: string[] = [];
      q.match_pairs.forEach((pair, i) => {
        const leftId = crypto.randomUUID();
        const rightId = crypto.randomUUID();
        leftIds.push(leftId);
        rightIds.push(rightId);
        tables.matching_items.push({
          id: leftId,
          question_id: q.id,
          side: "left",
          item_key: String.fromCharCode(65 + i),
          item_text: pair.left,
          item_image_path: null,
          display_order: i + 1,
        });
        tables.matching_items.push({
          id: rightId,
          question_id: q.id,
          side: "right",
          item_key: String(i + 1),
          item_text: pair.right,
          item_image_path: null,
          display_order: i + 1,
        });
        if (pair.left && pair.right) {
          tables.matching_pairs.push({
            question_id: q.id,
            left_item_id: leftId,
            right_item_id: rightId,
          });
        }
      });
    }

    if (item.groupId) {
      if (!seenGroups.has(item.groupId)) {
        seenGroups.add(item.groupId);
        tables.question_groups.push({
          id: item.groupId,
          group_type: "comprehension",
          subject_id: q.subject_id ?? document.subject_id,
          standard_id: q.standard_id ?? document.standard_id,
          shared_image_path: firstFigure?.image_path ?? null,
          created_by: null,
          created_at: document.created_at,
        });
        if (q.passage) {
          tables.question_group_translations.push({
            id: crypto.randomUUID(),
            group_id: item.groupId,
            language_code: "en",
            shared_text: q.passage,
          });
        }
      }
      tables.group_questions.push({
        group_id: item.groupId,
        question_id: q.id,
        question_order: item.groupOrder,
        blank_number: null,
      });
    }

    if (isTestKind) {
      tables.test_questions.push({
        test_id: containerId,
        question_id: q.id,
        section_id: sectionIds.get(sectionName) ?? null,
        question_order: item.order,
        marks,
        negative_marks: negative,
      });
    } else {
      tables.paper_questions.push({
        paper_id: containerId,
        question_id: q.id,
        section: sectionName,
        question_order: item.order,
        marks,
        negative_marks: negative,
      });
    }
  }

  if (document.total_marks == null) {
    const sum = flat.reduce(
      (acc, item) => acc + (item.question.marks ?? document.default_marks ?? 1),
      0,
    );
    if (document.kind === "past_paper" && tables.papers[0]) {
      (tables.papers[0] as { total_marks: number }).total_marks = sum;
    }
    if (isTestKind && tables.tests[0]) {
      (tables.tests[0] as { total_marks: number }).total_marks = sum;
    }
  }

  return {
    schema_version: 2,
    target: "rms-exam-prep",
    kind: document.kind,
    tables,
  };
}
