/**
 * Exam-prep Supabase access with retries for dropped connections.
 * Each call is safe to repeat: upserts replace the same primary key,
 * and deletes match the same ids.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Row } from "@/lib/exam-prep/push-plan";

const PAGE = 1000;
const WRITE_CHUNK = 80;
const MAX_ATTEMPTS = 5;

const RETRYABLE_CODES = new Set([
  "40001",
  "40P01",
  "53300",
  "53400",
  "57014",
  "57P01",
  "57P03",
  "58000",
  "58030",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
]);

export type UpsertOptions = {
  onConflict?: string;
  ignoreDuplicates?: boolean;
};

export type RowScope = {
  column: string;
  value: string | number;
};

export type RemoteWriter = {
  selectEq(
    table: string,
    columns: string,
    column: string,
    value: string | number,
  ): Promise<Row[]>;
  selectIn(
    table: string,
    columns: string,
    column: string,
    values: Array<string | number>,
  ): Promise<Row[]>;
  upsert(table: string, rows: Row[], options?: UpsertOptions): Promise<void>;
  deleteIn(
    table: string,
    column: string,
    values: Array<string | number>,
    scope?: RowScope,
  ): Promise<void>;
  updateIn(table: string, patch: Row, column: string, values: Array<string | number>): Promise<void>;
};

export class ExamPrepRequestError extends Error {
  readonly code: string | null;
  readonly retryable: boolean;

  constructor(table: string, message: string, code: string | null, retryable: boolean) {
    super(`${table}: ${message}`);
    this.name = "ExamPrepRequestError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function isTransientRemoteError(error: unknown): boolean {
  if (error instanceof ExamPrepRequestError) return error.retryable;
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|und_err|aborted|timed?\s*out/i.test(
    message,
  );
}

function retryableResult(code: string | null, message: string): boolean {
  if (code && RETRYABLE_CODES.has(code)) return true;
  if (code?.startsWith("08")) return true;
  return /timeout|temporarily unavailable|too many connections|fetch failed|502|503|504|429/i.test(
    message,
  );
}

export async function withRemoteRetry<T>(operation: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      if (attempt === MAX_ATTEMPTS || !isTransientRemoteError(error)) throw error;
      const delay = Math.min(8000, 250 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 150);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw last;
}

type PostgrestResult = {
  data: Row[] | null;
  error: { message: string; code?: string } | null;
};

function raise(table: string, error: { message: string; code?: string } | null): void {
  if (!error) return;
  const code = error.code ?? null;
  throw new ExamPrepRequestError(table, error.message, code, retryableResult(code, error.message));
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

async function checked(
  table: string,
  run: () => PromiseLike<PostgrestResult>,
): Promise<PostgrestResult> {
  return withRemoteRetry(async () => {
    const result = await run();
    raise(table, result.error);
    return result;
  });
}

async function selectAll(
  table: string,
  run: (from: number, to: number) => PromiseLike<PostgrestResult>,
): Promise<Row[]> {
  const all: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await checked(table, () => run(from, from + PAGE - 1));
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
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

export function examPrepClient(): SupabaseClient {
  const url = process.env["EXAM_PREP_SUPABASE_URL"];
  const key = process.env["EXAM_PREP_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error(
      "Missing EXAM_PREP_SUPABASE_URL or EXAM_PREP_SUPABASE_SERVICE_ROLE_KEY. Add the exam-prep service role key to .env.",
    );
  }
  return createClient(url, key, {
    global: { fetch: createSupabaseFetch(key) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const STABLE_ORDER: Record<string, string[]> = {
  question_tags: ["question_id", "tag"],
  matching_pairs: ["question_id", "left_item_id", "right_item_id"],
  group_questions: ["group_id", "question_id"],
  paper_questions: ["paper_id", "question_id"],
  test_questions: ["test_id", "question_id"],
};

function request(query: PromiseLike<unknown>): PromiseLike<PostgrestResult> {
  return query as PromiseLike<PostgrestResult>;
}

/** Page through a stable key so a second page cannot skip or repeat rows. */
function ordered(
  table: string,
  query: { order: (column: string, options: { ascending: boolean }) => unknown },
): { range: (from: number, to: number) => PromiseLike<unknown> } {
  const columns = STABLE_ORDER[table] ?? ["id"];
  return columns.reduce<unknown>(
    (current, column) =>
      (current as { order: (column: string, options: { ascending: boolean }) => unknown }).order(
        column,
        { ascending: true },
      ),
    query,
  ) as { range: (from: number, to: number) => PromiseLike<unknown> };
}

export function createSupabaseWriter(client: SupabaseClient = examPrepClient()): RemoteWriter {
  return {
    async selectEq(table, columns, column, value) {
      return selectAll(table, (from, to) =>
        request(ordered(table, client.from(table).select(columns).eq(column, value)).range(from, to)),
      );
    },

    async selectIn(table, columns, column, values) {
      if (!values.length) return [];
      const all: Row[] = [];
      for (const slice of chunks(values, WRITE_CHUNK)) {
        const rows = await selectAll(table, (from, to) =>
          request(ordered(table, client.from(table).select(columns).in(column, slice)).range(from, to)),
        );
        all.push(...rows);
      }
      return all;
    },

    async upsert(table, rows, options) {
      if (!rows.length) return;
      for (const slice of chunks(rows, WRITE_CHUNK)) {
        await checked(table, () =>
          request(
            client.from(table).upsert(slice, {
              ...(options?.onConflict ? { onConflict: options.onConflict } : {}),
              ignoreDuplicates: options?.ignoreDuplicates ?? false,
              defaultToNull: false,
            }),
          ),
        );
      }
    },

    async deleteIn(table, column, values, scope) {
      if (!values.length) return;
      for (const slice of chunks(values, WRITE_CHUNK)) {
        await checked(table, () => {
          let query = client.from(table).delete().in(column, slice);
          if (scope) query = query.eq(scope.column, scope.value);
          return request(query);
        });
      }
    },

    async updateIn(table, patch, column, values) {
      if (!values.length) return;
      for (const slice of chunks(values, WRITE_CHUNK)) {
        await checked(table, () => request(client.from(table).update(patch).in(column, slice)));
      }
    },
  };
}
