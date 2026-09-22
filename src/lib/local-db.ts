/**
 * Document store backed by local SQLite (sql.js) + files under ./data.
 * Server-only — keep Node imports inside async helpers so *.functions.ts
 * can still be analyzed for the client bundle.
 */
import type { Catalog, DocumentKind, DocumentMeta, PageRecord } from "@/lib/document-types";
import type { Question } from "@/lib/question-schema";

type SqlJsDatabase = import("sql.js").Database;
type SqlValue = import("sql.js").SqlValue;

function params(...values: unknown[]): SqlValue[] {
  return values.map((v) => {
    if (v === undefined) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    return v as SqlValue;
  });
}

const DATA_DIR = "data";
const DB_FILE = "paperparse.sqlite";
const IMAGES_DIR = "images";

let dbPromise: Promise<SqlJsDatabase> | null = null;
let writeChain: Promise<void> = Promise.resolve();

function uuid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

async function nodePath() {
  return import("node:path");
}

async function nodeFs() {
  return import("node:fs/promises");
}

async function dataRoot(): Promise<string> {
  const path = await nodePath();
  return path.resolve(process.cwd(), DATA_DIR);
}

async function dbPath(): Promise<string> {
  const path = await nodePath();
  return path.join(await dataRoot(), DB_FILE);
}

async function imagesRoot(): Promise<string> {
  const path = await nodePath();
  return path.join(await dataRoot(), IMAGES_DIR);
}

async function ensureDirs(): Promise<void> {
  const fs = await nodeFs();
  await fs.mkdir(await imagesRoot(), { recursive: true });
}

function schemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS pp_documents (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'past_paper',
      title TEXT NOT NULL DEFAULT 'Untitled',
      year INTEGER,
      standard_id INTEGER,
      stream_id INTEGER,
      subject_id INTEGER,
      duration_minutes INTEGER,
      total_marks REAL,
      difficulty TEXT,
      exam TEXT,
      notes TEXT,
      source TEXT,
      description TEXT,
      section_timing INTEGER NOT NULL DEFAULT 0,
      negative_marking INTEGER NOT NULL DEFAULT 1,
      allow_pause INTEGER NOT NULL DEFAULT 1,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      default_marks REAL,
      default_negative_marks REAL,
      questions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pp_pages (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES pp_documents(id) ON DELETE CASCADE,
      page_index INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      original_name TEXT NOT NULL DEFAULT '',
      ocr_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pp_pages_document_idx ON pp_pages(document_id, page_index);

    CREATE TABLE IF NOT EXISTS pp_catalog_standards (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      display_order INTEGER
    );
    CREATE TABLE IF NOT EXISTS pp_catalog_subjects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT
    );
    CREATE TABLE IF NOT EXISTS pp_catalog_topics (
      id INTEGER PRIMARY KEY,
      subject_id INTEGER,
      name TEXT NOT NULL,
      parent_topic_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS pp_catalog_streams (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      standard_id INTEGER
    );
  `;
}

async function persist(db: SqlJsDatabase): Promise<void> {
  const fs = await nodeFs();
  await ensureDirs();
  const data = db.export();
  await fs.writeFile(await dbPath(), Buffer.from(data));
}

async function openDatabase(): Promise<SqlJsDatabase> {
  await ensureDirs();
  const fs = await nodeFs();
  const initSqlJsMod = await import("sql.js/dist/sql-asm.js");
  const initSqlJs = (initSqlJsMod as { default: typeof import("sql.js") }).default;
  const SQL = await initSqlJs();

  const file = await dbPath();
  let db: SqlJsDatabase;
  try {
    const buf = await fs.readFile(file);
    db = new SQL.Database(new Uint8Array(buf));
  } catch {
    db = new SQL.Database();
  }
  db.run("PRAGMA foreign_keys = ON;");
  db.exec(schemaSql());
  await persist(db);
  return db;
}

async function getDb(): Promise<SqlJsDatabase> {
  if (!dbPromise) dbPromise = openDatabase();
  return dbPromise;
}

/** Serialize mutations so concurrent serverFns don't clobber the sqlite file. */
function withWrite<T>(fn: (db: SqlJsDatabase) => Promise<T> | T): Promise<T> {
  const run = writeChain.then(async () => {
    const db = await getDb();
    const result = await fn(db);
    await persist(db);
    return result;
  });
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return value == null ? null : String(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  return Number(value) !== 0;
}

function rowToMeta(row: Record<string, unknown>): DocumentMeta {
  return {
    id: String(row["id"]),
    kind: (str(row["kind"]) as DocumentKind) || "past_paper",
    title: str(row["title"]) ?? "Untitled",
    year: num(row["year"]),
    standard_id: num(row["standard_id"]),
    stream_id: num(row["stream_id"]),
    subject_id: num(row["subject_id"]),
    duration_minutes: num(row["duration_minutes"]),
    total_marks: num(row["total_marks"]),
    difficulty: (str(row["difficulty"]) as DocumentMeta["difficulty"]) ?? null,
    exam: str(row["exam"]),
    notes: str(row["notes"]),
    source: str(row["source"]),
    description: str(row["description"]),
    section_timing: bool(row["section_timing"], false),
    negative_marking: bool(row["negative_marking"], true),
    allow_pause: bool(row["allow_pause"], true),
    max_attempts: num(row["max_attempts"]) ?? 1,
    default_marks: num(row["default_marks"]),
    default_negative_marks: num(row["default_negative_marks"]),
    created_at: String(row["created_at"]),
    updated_at: String(row["updated_at"]),
  };
}

function toQuestions(value: unknown): Question[] {
  if (Array.isArray(value)) return value as Question[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as Question[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function rowToPage(row: Record<string, unknown>): PageRecord {
  return {
    id: String(row["id"]),
    document_id: String(row["document_id"]),
    page_index: Number(row["page_index"]),
    file_path: String(row["file_path"]),
    original_name: String(row["original_name"] ?? ""),
    ocr_status: String(row["ocr_status"] ?? "pending"),
  };
}

function queryAll(db: SqlJsDatabase, sql: string, bind: SqlValue[] = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  stmt.bind(bind);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as Record<string, unknown>);
  }
  stmt.free();
  return rows;
}

function queryOne(
  db: SqlJsDatabase,
  sql: string,
  bind: SqlValue[] = [],
): Record<string, unknown> | null {
  return queryAll(db, sql, bind)[0] ?? null;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const [head, payload] = dataUrl.includes(",") ? dataUrl.split(",") : ["", dataUrl];
  const contentType = /data:([^;]+)/.exec(head ?? "")?.[1] ?? "image/jpeg";
  const binary = atob(payload ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}

function bytesToDataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

async function absoluteImagePath(relative: string): Promise<string> {
  const path = await nodePath();
  return path.join(await imagesRoot(), ...relative.split("/"));
}

async function writeImage(relativePath: string, dataUrl: string): Promise<void> {
  const fs = await nodeFs();
  const path = await nodePath();
  const abs = await absoluteImagePath(relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const { bytes } = dataUrlToBytes(dataUrl);
  await fs.writeFile(abs, Buffer.from(bytes));
}

async function readImageDataUrl(relativePath: string): Promise<string | undefined> {
  const fs = await nodeFs();
  try {
    const buf = await fs.readFile(await absoluteImagePath(relativePath));
    const lower = relativePath.toLowerCase();
    const contentType = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    return bytesToDataUrl(new Uint8Array(buf), contentType);
  } catch {
    return undefined;
  }
}

async function removeImage(relativePath: string): Promise<void> {
  const fs = await nodeFs();
  try {
    await fs.unlink(await absoluteImagePath(relativePath));
  } catch {
    // ignore missing files
  }
}

async function removeDocumentImages(documentId: string): Promise<void> {
  const fs = await nodeFs();
  const path = await nodePath();
  try {
    await fs.rm(path.join(await imagesRoot(), documentId), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function listFigurePaths(documentId: string): Promise<string[]> {
  const fs = await nodeFs();
  const path = await nodePath();
  const dir = path.join(await imagesRoot(), documentId);
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((name) => name.includes("fig-"))
      .map((name) => `${documentId}/${name}`);
  } catch {
    return [];
  }
}

export async function listDocuments(): Promise<
  Array<DocumentMeta & { question_count: number; page_count: number }>
> {
  const db = await getDb();
  const rows = queryAll(db, "SELECT * FROM pp_documents ORDER BY updated_at DESC");
  const pageCounts = queryAll(
    db,
    "SELECT document_id, COUNT(*) AS c FROM pp_pages GROUP BY document_id",
  );
  const counts = new Map<string, number>();
  for (const p of pageCounts) {
    counts.set(String(p["document_id"]), Number(p["c"] ?? 0));
  }
  return rows.map((row) => ({
    ...rowToMeta(row),
    question_count: toQuestions(row["questions"]).length,
    page_count: counts.get(String(row["id"])) ?? 0,
  }));
}

export async function getDocument(id: string): Promise<{
  document: DocumentMeta;
  questions: Question[];
  pages: PageRecord[];
  figureUrls: Record<string, string>;
} | null> {
  const db = await getDb();
  const row = queryOne(db, "SELECT * FROM pp_documents WHERE id = ?", [id]);
  if (!row) return null;

  const pageRows = queryAll(
    db,
    "SELECT * FROM pp_pages WHERE document_id = ? ORDER BY page_index ASC",
    [id],
  );
  const pages: PageRecord[] = [];
  for (const raw of pageRows) {
    const page = rowToPage(raw);
    const dataUrl = await readImageDataUrl(page.file_path);
    pages.push(dataUrl ? { ...page, dataUrl } : page);
  }

  const figureUrls: Record<string, string> = {};
  for (const rel of await listFigurePaths(id)) {
    const dataUrl = await readImageDataUrl(rel);
    if (dataUrl) figureUrls[rel] = dataUrl;
  }

  return {
    document: rowToMeta(row),
    questions: toQuestions(row["questions"]),
    pages,
    figureUrls,
  };
}

export type DocumentPatch = Partial<Omit<DocumentMeta, "id" | "created_at" | "updated_at">> & {
  questions?: Question[];
};

export async function createDocument(kind: DocumentKind, title?: string): Promise<DocumentMeta> {
  return withWrite((db) => {
    const id = uuid();
    const created = nowIso();
    db.run(
      `INSERT INTO pp_documents (id, kind, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, kind, title?.trim() || "Untitled", created, created],
    );
    const row = queryOne(db, "SELECT * FROM pp_documents WHERE id = ?", [id]);
    if (!row) throw new Error("Could not create the document");
    return rowToMeta(row);
  });
}

export async function updateDocument(
  id: string,
  patch: DocumentPatch,
): Promise<DocumentMeta | null> {
  return withWrite((db) => {
    const existing = queryOne(db, "SELECT * FROM pp_documents WHERE id = ?", [id]);
    if (!existing) return null;

    const next = { ...existing };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (key === "questions") {
        next["questions"] = JSON.stringify(value);
      } else if (
        key === "section_timing" ||
        key === "negative_marking" ||
        key === "allow_pause"
      ) {
        next[key] = value ? 1 : 0;
      } else {
        next[key] = value;
      }
    }
    next["updated_at"] = nowIso();

    db.run(
      `UPDATE pp_documents SET
        kind = ?, title = ?, year = ?, standard_id = ?, stream_id = ?, subject_id = ?,
        duration_minutes = ?, total_marks = ?, difficulty = ?, exam = ?, notes = ?,
        source = ?, description = ?, section_timing = ?, negative_marking = ?,
        allow_pause = ?, max_attempts = ?, default_marks = ?, default_negative_marks = ?,
        questions = ?, updated_at = ?
       WHERE id = ?`,
      params(
        next["kind"],
        next["title"],
        next["year"],
        next["standard_id"],
        next["stream_id"],
        next["subject_id"],
        next["duration_minutes"],
        next["total_marks"],
        next["difficulty"],
        next["exam"],
        next["notes"],
        next["source"],
        next["description"],
        next["section_timing"],
        next["negative_marking"],
        next["allow_pause"],
        next["max_attempts"],
        next["default_marks"],
        next["default_negative_marks"],
        typeof next["questions"] === "string"
          ? next["questions"]
          : JSON.stringify(next["questions"] ?? []),
        next["updated_at"],
        id,
      ),
    );
    const row = queryOne(db, "SELECT * FROM pp_documents WHERE id = ?", [id]);
    return row ? rowToMeta(row) : null;
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await withWrite(async (db) => {
    db.run("DELETE FROM pp_pages WHERE document_id = ?", [id]);
    db.run("DELETE FROM pp_documents WHERE id = ?", [id]);
  });
  await removeDocumentImages(id);
}

export async function appendPage(input: {
  documentId: string;
  dataUrl: string;
  originalName: string;
}): Promise<PageRecord> {
  const page = await withWrite(async (db) => {
    const countRow = queryOne(
      db,
      "SELECT COUNT(*) AS c FROM pp_pages WHERE document_id = ?",
      [input.documentId],
    );
    const page_index = Number(countRow?.["c"] ?? 0);
    const file_path = `${input.documentId}/page-${page_index + 1}.jpg`;
    await writeImage(file_path, input.dataUrl);

    const id = uuid();
    const created = nowIso();
    db.run(
      `INSERT INTO pp_pages (id, document_id, page_index, file_path, original_name, ocr_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [id, input.documentId, page_index, file_path, input.originalName, created],
    );
    db.run("UPDATE pp_documents SET updated_at = ? WHERE id = ?", [nowIso(), input.documentId]);

    const row = queryOne(db, "SELECT * FROM pp_pages WHERE id = ?", [id]);
    if (!row) throw new Error("Could not add the page");
    return { ...rowToPage(row), dataUrl: input.dataUrl };
  });
  return page;
}

export async function saveFigure(input: {
  documentId: string;
  dataUrl: string;
  filename: string;
}): Promise<string> {
  const file_path = `${input.documentId}/${input.filename}`;
  await writeImage(file_path, input.dataUrl);
  return file_path;
}

export async function removePage(pageId: string): Promise<void> {
  await withWrite(async (db) => {
    const row = queryOne(db, "SELECT * FROM pp_pages WHERE id = ?", [pageId]);
    if (!row) return;
    const page = rowToPage(row);
    await removeImage(page.file_path);
    db.run("DELETE FROM pp_pages WHERE id = ?", [pageId]);

    const remaining = queryAll(
      db,
      "SELECT id FROM pp_pages WHERE document_id = ? ORDER BY page_index ASC",
      [page.document_id],
    );
    let index = 0;
    for (const p of remaining) {
      db.run("UPDATE pp_pages SET page_index = ? WHERE id = ?", [index, String(p["id"])]);
      index += 1;
    }
    db.run("UPDATE pp_documents SET updated_at = ? WHERE id = ?", [
      nowIso(),
      page.document_id,
    ]);
  });
}

export async function markPageOcr(pageId: string, status: string): Promise<void> {
  await withWrite((db) => {
    db.run("UPDATE pp_pages SET ocr_status = ? WHERE id = ?", [status, pageId]);
  });
}

export async function getCatalog(): Promise<Catalog> {
  const db = await getDb();
  return {
    standards: queryAll(
      db,
      "SELECT * FROM pp_catalog_standards ORDER BY display_order ASC, name ASC",
    ).map((r) => ({
      id: Number(r["id"]),
      name: String(r["name"]),
      display_order: num(r["display_order"]),
    })),
    subjects: queryAll(db, "SELECT * FROM pp_catalog_subjects ORDER BY name ASC").map((r) => ({
      id: Number(r["id"]),
      name: String(r["name"]),
      code: str(r["code"]),
    })),
    topics: queryAll(db, "SELECT * FROM pp_catalog_topics ORDER BY name ASC").map((r) => ({
      id: Number(r["id"]),
      subject_id: num(r["subject_id"]),
      name: String(r["name"]),
      parent_topic_id: num(r["parent_topic_id"]),
    })),
    streams: queryAll(db, "SELECT * FROM pp_catalog_streams ORDER BY name ASC").map((r) => ({
      id: Number(r["id"]),
      name: String(r["name"]),
      standard_id: num(r["standard_id"]),
    })),
  };
}

export async function importCatalogDump(raw: unknown): Promise<Catalog> {
  await withWrite((db) => {
    const obj = (raw ?? {}) as Record<string, unknown>;
    const arr = (...keys: string[]) => {
      for (const key of keys) {
        const value = obj[key];
        if (Array.isArray(value)) return value as Record<string, unknown>[];
      }
      return [] as Record<string, unknown>[];
    };

    db.run("DELETE FROM pp_catalog_streams");
    db.run("DELETE FROM pp_catalog_topics");
    db.run("DELETE FROM pp_catalog_subjects");
    db.run("DELETE FROM pp_catalog_standards");

    for (const r of arr("standards", "catalog_standards")) {
      if (r["id"] == null || !r["name"]) continue;
      db.run(
        "INSERT INTO pp_catalog_standards (id, name, display_order) VALUES (?, ?, ?)",
        params(Number(r["id"]), String(r["name"]), num(r["display_order"])),
      );
    }
    for (const r of arr("subjects", "catalog_subjects")) {
      if (r["id"] == null || !r["name"]) continue;
      db.run(
        "INSERT INTO pp_catalog_subjects (id, name, code) VALUES (?, ?, ?)",
        params(Number(r["id"]), String(r["name"]), str(r["code"])),
      );
    }
    for (const r of arr("topics", "catalog_topics")) {
      if (r["id"] == null || !r["name"]) continue;
      db.run(
        "INSERT INTO pp_catalog_topics (id, subject_id, name, parent_topic_id) VALUES (?, ?, ?, ?)",
        params(
          Number(r["id"]),
          num(r["subject_id"]),
          String(r["name"]),
          num(r["parent_topic_id"]),
        ),
      );
    }
    for (const r of arr("streams", "catalog_streams")) {
      if (r["id"] == null || !r["name"]) continue;
      db.run(
        "INSERT INTO pp_catalog_streams (id, name, standard_id) VALUES (?, ?, ?)",
        params(Number(r["id"]), String(r["name"]), num(r["standard_id"])),
      );
    }
  });
  return getCatalog();
}
