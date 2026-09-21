import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Database, SqlJsStatic } from "sql.js";

import type { Catalog, DocumentKind, DocumentMeta, PageRecord } from "@/lib/document-types";
import type { Question } from "@/lib/question-schema";

const require = createRequire(import.meta.url);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS catalog_standards (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  display_order INTEGER
);
CREATE TABLE IF NOT EXISTS catalog_subjects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT
);
CREATE TABLE IF NOT EXISTS catalog_topics (
  id INTEGER PRIMARY KEY,
  subject_id INTEGER,
  name TEXT NOT NULL,
  parent_topic_id INTEGER
);
CREATE TABLE IF NOT EXISTS catalog_streams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  standard_id INTEGER
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
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
  questions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  ocr_status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
`;

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let writeChain: Promise<void> = Promise.resolve();

export function dataDir(): string {
  return path.join(process.cwd(), "data");
}

export function dbPath(): string {
  return path.join(dataDir(), "paperparse.sqlite");
}

export function imagesDir(documentId?: string): string {
  const dir = path.join(dataDir(), "images");
  return documentId ? path.join(dir, documentId) : dir;
}

async function loadSql(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  const initSqlJs = require("sql.js") as (opts?: { locateFile?: (file: string) => string }) => Promise<SqlJsStatic>;
  const wasmDir = path.dirname(fileURLToPath(import.meta.url));
  const locateFile = (file: string) => {
    const fromPkg = path.join(process.cwd(), "node_modules", "sql.js", "dist", file);
    if (fs.existsSync(fromPkg)) return fromPkg;
    return path.join(wasmDir, file);
  };
  SQL = await initSqlJs({ locateFile });
  return SQL;
}

function persist(instance: Database) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const data = instance.export();
  fs.writeFileSync(dbPath(), Buffer.from(data));
}

export async function getDb(): Promise<Database> {
  if (db) return db;
  const sql = await loadSql();
  fs.mkdirSync(dataDir(), { recursive: true });
  const file = dbPath();
  if (fs.existsSync(file)) {
    db = new sql.Database(fs.readFileSync(file));
  } else {
    db = new sql.Database();
  }
  db.run("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  seedCatalogIfEmpty(db);
  persist(db);
  return db;
}

function withWrite<T>(fn: (instance: Database) => T): Promise<T> {
  const run = writeChain.then(async () => {
    const instance = await getDb();
    const result = fn(instance);
    persist(instance);
    return result;
  });
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function nowIso() {
  return new Date().toISOString();
}

function pick(row: Record<string, unknown>, key: string): unknown {
  return row[key];
}

function asNum(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function asStr(value: unknown): string | null {
  return value == null ? null : String(value);
}

function rowToMeta(row: Record<string, unknown>): DocumentMeta {
  return {
    id: String(pick(row, "id")),
    kind: (asStr(pick(row, "kind")) as DocumentKind) || "past_paper",
    title: asStr(pick(row, "title")) ?? "Untitled",
    year: asNum(pick(row, "year")),
    standard_id: asNum(pick(row, "standard_id")),
    stream_id: asNum(pick(row, "stream_id")),
    subject_id: asNum(pick(row, "subject_id")),
    duration_minutes: asNum(pick(row, "duration_minutes")),
    total_marks: asNum(pick(row, "total_marks")),
    difficulty: (asStr(pick(row, "difficulty")) as DocumentMeta["difficulty"]) ?? null,
    exam: asStr(pick(row, "exam")),
    notes: asStr(pick(row, "notes")),
    source: asStr(pick(row, "source")),
    description: asStr(pick(row, "description")),
    section_timing: Number(pick(row, "section_timing")) === 1,
    negative_marking: Number(pick(row, "negative_marking")) !== 0,
    allow_pause: Number(pick(row, "allow_pause")) !== 0,
    max_attempts: asNum(pick(row, "max_attempts")) ?? 1,
    default_marks: asNum(pick(row, "default_marks")),
    default_negative_marks: asNum(pick(row, "default_negative_marks")),
    created_at: String(pick(row, "created_at")),
    updated_at: String(pick(row, "updated_at")),
  };
}

function queryAll(instance: Database, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const stmt = instance.prepare(sql);
  stmt.bind(params as never[]);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(instance: Database, sql: string, params: unknown[] = []): Record<string, unknown> | null {
  const rows = queryAll(instance, sql, params);
  return rows[0] ?? null;
}

export async function listDocuments(): Promise<Array<DocumentMeta & { question_count: number; page_count: number }>> {
  const instance = await getDb();
  const rows = queryAll(
    instance,
    `SELECT d.*,
      (SELECT COUNT(*) FROM pages p WHERE p.document_id = d.id) AS page_count,
      d.questions_json
     FROM documents d
     ORDER BY d.updated_at DESC`,
  );
  return rows.map((row) => {
    const meta = rowToMeta(row);
    let count = 0;
    try {
      const qs = JSON.parse(String(pick(row, "questions_json") || "[]")) as unknown[];
      count = Array.isArray(qs) ? qs.length : 0;
    } catch {
      count = 0;
    }
    return { ...meta, question_count: count, page_count: Number(pick(row, "page_count") ?? 0) };
  });
}

export async function getDocument(id: string): Promise<{
  document: DocumentMeta;
  questions: Question[];
  pages: PageRecord[];
  figureUrls: Record<string, string>;
} | null> {
  const instance = await getDb();
  const row = queryOne(instance, "SELECT * FROM documents WHERE id = ?", [id]);
  if (!row) return null;
  let questions: Question[] = [];
  try {
    questions = JSON.parse(String(pick(row, "questions_json") || "[]")) as Question[];
    if (!Array.isArray(questions)) questions = [];
  } catch {
    questions = [];
  }
  const pageRows = queryAll(
    instance,
    "SELECT * FROM pages WHERE document_id = ? ORDER BY page_index ASC",
    [id],
  );
  const pages: PageRecord[] = pageRows.map((p) => {
    const file_path = String(pick(p, "file_path"));
    const abs = path.isAbsolute(file_path) ? file_path : path.join(process.cwd(), file_path);
    let dataUrl: string | undefined;
    if (fs.existsSync(abs)) {
      const buf = fs.readFileSync(abs);
      dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
    }
    return {
      id: String(pick(p, "id")),
      document_id: String(pick(p, "document_id")),
      page_index: Number(pick(p, "page_index")),
      file_path,
      original_name: String(pick(p, "original_name") ?? ""),
      ocr_status: String(pick(p, "ocr_status") ?? "pending"),
      ...(dataUrl ? { dataUrl } : {}),
    };
  });
  const figureUrls: Record<string, string> = {};
  const dir = imagesDir(id);
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith("fig-") && !name.includes("-fig-")) continue;
      const rel = path.join("data", "images", id, name).replaceAll("\\", "/");
      const buf = fs.readFileSync(path.join(dir, name));
      figureUrls[rel] = `data:image/jpeg;base64,${buf.toString("base64")}`;
    }
  }
  return { document: rowToMeta(row), questions, pages, figureUrls };
}

export type DocumentPatch = Partial<
  Omit<DocumentMeta, "id" | "created_at" | "updated_at">
> & { questions?: Question[] };

export async function createDocument(kind: DocumentKind, title?: string): Promise<DocumentMeta> {
  return withWrite((instance) => {
    const id = crypto.randomUUID();
    const ts = nowIso();
    instance.run(
      `INSERT INTO documents (id, kind, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, kind, title?.trim() || "Untitled", ts, ts],
    );
    const row = queryOne(instance, "SELECT * FROM documents WHERE id = ?", [id])!;
    return rowToMeta(row);
  });
}

export async function updateDocument(id: string, patch: DocumentPatch): Promise<DocumentMeta | null> {
  return withWrite((instance) => {
    const existing = queryOne(instance, "SELECT * FROM documents WHERE id = ?", [id]);
    if (!existing) return null;
    const current = rowToMeta(existing);
    const next: DocumentMeta = {
      ...current,
      ...patch,
      id: current.id,
      created_at: current.created_at,
      updated_at: nowIso(),
    };
    const questionsJson =
      patch.questions !== undefined
        ? JSON.stringify(patch.questions)
        : String(pick(existing, "questions_json") ?? "[]");
    instance.run(
      `UPDATE documents SET
        kind = ?, title = ?, year = ?, standard_id = ?, stream_id = ?, subject_id = ?,
        duration_minutes = ?, total_marks = ?, difficulty = ?, exam = ?, notes = ?, source = ?,
        description = ?, section_timing = ?, negative_marking = ?, allow_pause = ?, max_attempts = ?,
        default_marks = ?, default_negative_marks = ?, questions_json = ?, updated_at = ?
       WHERE id = ?`,
      [
        next.kind,
        next.title,
        next.year,
        next.standard_id,
        next.stream_id,
        next.subject_id,
        next.duration_minutes,
        next.total_marks,
        next.difficulty,
        next.exam,
        next.notes,
        next.source,
        next.description,
        next.section_timing ? 1 : 0,
        next.negative_marking ? 1 : 0,
        next.allow_pause ? 1 : 0,
        next.max_attempts,
        next.default_marks,
        next.default_negative_marks,
        questionsJson,
        next.updated_at,
        id,
      ],
    );
    return next;
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await withWrite((instance) => {
    instance.run("DELETE FROM pages WHERE document_id = ?", [id]);
    instance.run("DELETE FROM documents WHERE id = ?", [id]);
  });
  const dir = imagesDir(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
  return Buffer.from(base64, "base64");
}

export async function appendPage(input: {
  documentId: string;
  dataUrl: string;
  originalName: string;
}): Promise<PageRecord> {
  return withWrite((instance) => {
    const countRow = queryOne(
      instance,
      "SELECT COUNT(*) AS n FROM pages WHERE document_id = ?",
      [input.documentId],
    );
    const page_index = Number(pick(countRow ?? {}, "n") ?? 0);
    const id = crypto.randomUUID();
    const dir = imagesDir(input.documentId);
    fs.mkdirSync(dir, { recursive: true });
    const rel = path.join("data", "images", input.documentId, `page-${page_index + 1}.jpg`);
    const abs = path.join(process.cwd(), rel);
    fs.writeFileSync(abs, dataUrlToBuffer(input.dataUrl));
    instance.run(
      `INSERT INTO pages (id, document_id, page_index, file_path, original_name, ocr_status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [id, input.documentId, page_index, rel.replaceAll("\\", "/"), input.originalName],
    );
    instance.run("UPDATE documents SET updated_at = ? WHERE id = ?", [nowIso(), input.documentId]);
    return {
      id,
      document_id: input.documentId,
      page_index,
      file_path: rel.replaceAll("\\", "/"),
      original_name: input.originalName,
      ocr_status: "pending",
      dataUrl: input.dataUrl,
    };
  });
}

export async function saveFigure(input: {
  documentId: string;
  dataUrl: string;
  filename: string;
}): Promise<string> {
  const dir = imagesDir(input.documentId);
  fs.mkdirSync(dir, { recursive: true });
  const rel = path.join("data", "images", input.documentId, input.filename).replaceAll("\\", "/");
  fs.writeFileSync(path.join(process.cwd(), rel), dataUrlToBuffer(input.dataUrl));
  return rel;
}

export async function removePage(pageId: string): Promise<void> {
  await withWrite((instance) => {
    const row = queryOne(instance, "SELECT * FROM pages WHERE id = ?", [pageId]);
    if (!row) return;
    const file_path = String(pick(row, "file_path"));
    const abs = path.isAbsolute(file_path) ? file_path : path.join(process.cwd(), file_path);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    const documentId = String(pick(row, "document_id"));
    instance.run("DELETE FROM pages WHERE id = ?", [pageId]);
    const remaining = queryAll(
      instance,
      "SELECT id FROM pages WHERE document_id = ? ORDER BY page_index ASC",
      [documentId],
    );
    remaining.forEach((p, i) => {
      instance.run("UPDATE pages SET page_index = ? WHERE id = ?", [i, String(pick(p, "id"))]);
    });
    instance.run("UPDATE documents SET updated_at = ? WHERE id = ?", [nowIso(), documentId]);
  });
}

export async function markPageOcr(pageId: string, status: string): Promise<void> {
  await withWrite((instance) => {
    instance.run("UPDATE pages SET ocr_status = ? WHERE id = ?", [status, pageId]);
  });
}

function applyCatalog(instance: Database, raw: unknown) {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const asArr = (v: unknown) => (Array.isArray(v) ? v : []);

  instance.run("DELETE FROM catalog_streams");
  instance.run("DELETE FROM catalog_topics");
  instance.run("DELETE FROM catalog_subjects");
  instance.run("DELETE FROM catalog_standards");

  for (const item of asArr(obj["standards"] ?? obj["catalog_standards"])) {
    const r = item as Record<string, unknown>;
    if (pick(r, "id") == null || !pick(r, "name")) continue;
    instance.run("INSERT INTO catalog_standards (id, name, display_order) VALUES (?, ?, ?)", [
      Number(pick(r, "id")),
      String(pick(r, "name")),
      asNum(pick(r, "display_order")),
    ]);
  }
  for (const item of asArr(obj["subjects"] ?? obj["catalog_subjects"])) {
    const r = item as Record<string, unknown>;
    if (pick(r, "id") == null || !pick(r, "name")) continue;
    instance.run("INSERT INTO catalog_subjects (id, name, code) VALUES (?, ?, ?)", [
      Number(pick(r, "id")),
      String(pick(r, "name")),
      asStr(pick(r, "code")),
    ]);
  }
  for (const item of asArr(obj["topics"] ?? obj["catalog_topics"])) {
    const r = item as Record<string, unknown>;
    if (pick(r, "id") == null || !pick(r, "name")) continue;
    instance.run(
      "INSERT INTO catalog_topics (id, subject_id, name, parent_topic_id) VALUES (?, ?, ?, ?)",
      [
        Number(pick(r, "id")),
        asNum(pick(r, "subject_id")),
        String(pick(r, "name")),
        asNum(pick(r, "parent_topic_id")),
      ],
    );
  }
  for (const item of asArr(obj["streams"] ?? obj["catalog_streams"])) {
    const r = item as Record<string, unknown>;
    if (pick(r, "id") == null || !pick(r, "name")) continue;
    instance.run("INSERT INTO catalog_streams (id, name, standard_id) VALUES (?, ?, ?)", [
      Number(pick(r, "id")),
      String(pick(r, "name")),
      asNum(pick(r, "standard_id")),
    ]);
  }
}

function seedCatalogIfEmpty(instance: Database) {
  const count = queryOne(instance, "SELECT COUNT(*) AS n FROM catalog_standards");
  if (Number(pick(count ?? {}, "n") ?? 0) > 0) return;
  const seedPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../data/catalog-seed.json");
  const cwdPath = path.join(process.cwd(), "src", "data", "catalog-seed.json");
  const file = fs.existsSync(seedPath) ? seedPath : cwdPath;
  if (!fs.existsSync(file)) return;
  applyCatalog(instance, JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
}

export async function getCatalog(): Promise<Catalog> {
  const instance = await getDb();
  return {
    standards: queryAll(instance, "SELECT * FROM catalog_standards ORDER BY display_order, name").map(
      (r) => ({
        id: Number(pick(r, "id")),
        name: String(pick(r, "name")),
        display_order: asNum(pick(r, "display_order")),
      }),
    ),
    subjects: queryAll(instance, "SELECT * FROM catalog_subjects ORDER BY name").map((r) => ({
      id: Number(pick(r, "id")),
      name: String(pick(r, "name")),
      code: asStr(pick(r, "code")),
    })),
    topics: queryAll(instance, "SELECT * FROM catalog_topics ORDER BY name").map((r) => ({
      id: Number(pick(r, "id")),
      subject_id: asNum(pick(r, "subject_id")),
      name: String(pick(r, "name")),
      parent_topic_id: asNum(pick(r, "parent_topic_id")),
    })),
    streams: queryAll(instance, "SELECT * FROM catalog_streams ORDER BY name").map((r) => ({
      id: Number(pick(r, "id")),
      name: String(pick(r, "name")),
      standard_id: asNum(pick(r, "standard_id")),
    })),
  };
}

export async function importCatalogDump(raw: unknown): Promise<Catalog> {
  return withWrite((instance) => {
    applyCatalog(instance, raw);
    return null as unknown as Catalog;
  }).then(() => getCatalog());
}
