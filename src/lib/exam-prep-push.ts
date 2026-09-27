/**
 * Upsert one exam-prep export into the rms-exam-prep Supabase project.
 * Server-only. Uses that project's service role, not this app's Supabase client.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ExamPrepExport } from "@/lib/exam-prep-export";

type Row = Record<string, unknown>;

const CHUNK = 100;

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function examPrepClient(): SupabaseClient {
  const url = process.env["EXAM_PREP_SUPABASE_URL"];
  const key = process.env["EXAM_PREP_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error(
      "Missing EXAM_PREP_SUPABASE_URL or EXAM_PREP_SUPABASE_SERVICE_ROLE_KEY. Add the exam-prep service role key to .env.",
    );
  }
  return createClient(url, key, {
    global: { fetch: createSupabaseFetch(key) },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function asRows(value: unknown[]): Row[] {
  return value as Row[];
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function clearFields(rows: Row[], fields: string[]): Row[] {
  return rows.map((row) => {
    const next = { ...row };
    for (const field of fields) next[field] = null;
    return next;
  });
}

function fail(table: string, error: { message: string } | null): void {
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function upsertAll(supabase: SupabaseClient, table: string, rows: Row[]): Promise<void> {
  for (const slice of chunks(rows, CHUNK)) {
    const { error } = await supabase.from(table).upsert(slice);
    fail(table, error);
  }
}

async function insertAll(supabase: SupabaseClient, table: string, rows: Row[]): Promise<void> {
  for (const slice of chunks(rows, CHUNK)) {
    const { error } = await supabase.from(table).insert(slice);
    fail(table, error);
  }
}

async function removeByIds(
  supabase: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
): Promise<void> {
  for (const slice of chunks(ids, CHUNK)) {
    const { error } = await supabase.from(table).delete().in(column, slice);
    fail(table, error);
  }
}

async function linkedGroupIds(supabase: SupabaseClient, questionIds: string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const slice of chunks(questionIds, CHUNK)) {
    const { data, error } = await supabase
      .from("group_questions")
      .select("group_id")
      .in("question_id", slice);
    fail("group_questions", error);
    for (const row of data ?? []) {
      const id = (row as { group_id?: string | null }).group_id;
      if (id) found.add(id);
    }
  }
  return [...found];
}

const DEFAULT_STANDARDS: Record<number, { name: string; display_order: number }> = {
  5: { name: "5th", display_order: 5 },
  8: { name: "8th", display_order: 8 },
};

function containerStandardId(payload: ExamPrepExport): number {
  const paper = asRows(payload.tables.papers)[0];
  const test = asRows(payload.tables.tests)[0];
  const raw = paper?.["standard_id"] ?? test?.["standard_id"];
  const id = typeof raw === "number" ? raw : null;
  if (id == null) {
    throw new Error("Choose a standard (5th or 8th) before pushing.");
  }
  return id;
}

function standardIdsIn(payload: ExamPrepExport): number[] {
  const ids = new Set<number>();
  for (const row of [
    ...asRows(payload.tables.papers),
    ...asRows(payload.tables.tests),
    ...asRows(payload.tables.questions),
    ...asRows(payload.tables.question_groups),
  ]) {
    const value = row["standard_id"];
    if (typeof value === "number" && value in DEFAULT_STANDARDS) ids.add(value);
  }
  return [...ids];
}

async function ensureRemoteStandards(supabase: SupabaseClient, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const { data, error } = await supabase.from("standards").select("id").in("id", ids);
  fail("standards", error);
  const existing = new Set((data ?? []).map((row) => Number((row as { id?: number }).id)));
  const missing = ids
    .filter((id) => !existing.has(id))
    .map((id) => ({
      id,
      name: DEFAULT_STANDARDS[id]!.name,
      display_order: DEFAULT_STANDARDS[id]!.display_order,
    }));
  if (!missing.length) return;
  const { error: insertError } = await supabase.from("standards").insert(missing);
  fail("standards", insertError);
}

export async function pushExamPrepExport(payload: ExamPrepExport): Promise<void> {
  const supabase = examPrepClient();
  containerStandardId(payload);
  await ensureRemoteStandards(supabase, standardIdsIn(payload));

  const questions = clearFields(asRows(payload.tables.questions), ["diagram_path"]);
  const questionIds = questions.map((row) => String(row["id"]));

  await upsertAll(supabase, "questions", questions);

  if (questionIds.length) {
    const groupIds = await linkedGroupIds(supabase, questionIds);
    await removeByIds(supabase, "question_groups", "id", groupIds);
    await removeByIds(supabase, "matching_pairs", "question_id", questionIds);
    await removeByIds(supabase, "matching_items", "question_id", questionIds);
    await removeByIds(supabase, "question_tags", "question_id", questionIds);
    await removeByIds(supabase, "question_options", "question_id", questionIds);
    await removeByIds(supabase, "question_translations", "question_id", questionIds);
  }

  await insertAll(supabase, "question_translations", asRows(payload.tables.question_translations));
  await insertAll(supabase, "question_options", asRows(payload.tables.question_options));
  await insertAll(
    supabase,
    "option_translations",
    clearFields(asRows(payload.tables.option_translations), ["option_image_path"]),
  );
  await insertAll(supabase, "question_tags", asRows(payload.tables.question_tags));
  await insertAll(supabase, "matching_items", asRows(payload.tables.matching_items));
  await insertAll(supabase, "matching_pairs", asRows(payload.tables.matching_pairs));
  await insertAll(
    supabase,
    "question_groups",
    clearFields(asRows(payload.tables.question_groups), ["shared_image_path"]),
  );
  await insertAll(
    supabase,
    "question_group_translations",
    asRows(payload.tables.question_group_translations),
  );
  await insertAll(supabase, "group_questions", asRows(payload.tables.group_questions));

  const paper = asRows(payload.tables.papers)[0];
  if (paper) {
    const paperId = String(paper["id"]);
    await upsertAll(supabase, "papers", [paper]);
    await removeByIds(supabase, "paper_questions", "paper_id", [paperId]);
    await insertAll(supabase, "paper_questions", asRows(payload.tables.paper_questions));
  }

  const test = asRows(payload.tables.tests)[0];
  if (test) {
    const testId = String(test["id"]);
    await upsertAll(supabase, "tests", [test]);
    await removeByIds(supabase, "test_sections", "test_id", [testId]);
    await insertAll(supabase, "test_sections", asRows(payload.tables.test_sections));
    await insertAll(supabase, "test_questions", asRows(payload.tables.test_questions));
  }
}
