/**
 * Document store backed by local SQLite (sql.js) + files under ./data.
 * Server-only — keep Node imports inside async helpers so *.functions.ts
 * can still be analyzed for the client bundle.
 */
import {
  PAPER_CHANGED_MESSAGE,
  type Catalog,
  type DocumentKind,
  type DocumentMeta,
  type MockGenerationState,
  type PageRecord,
} from "@/lib/document-types";
import { parseMockGeneration } from "@/lib/document-types";
import {
  collectQuestionsImagePaths,
  droppedImagePaths,
  normalizeStoredImagePath,
} from "@/lib/question-images";
import type { Question } from "@/lib/question-schema";
import { CONTENT_MODES, type ContentMode } from "@/lib/reading/mode";

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
      read_mode TEXT,
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

    CREATE TABLE IF NOT EXISTS pp_push_questions (
      document_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      pushed_at TEXT NOT NULL,
      PRIMARY KEY (document_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS pp_push_documents (
      document_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      total_count INTEGER NOT NULL,
      synced_count INTEGER NOT NULL,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pp_push_retired_groups (
      document_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      PRIMARY KEY (document_id, group_id)
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
  ensureDocumentColumns(db);
  ensurePageColumns(db);
  ensureDefaultStandards(db);
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
    source_document_id: str(row["source_document_id"]),
    generation: parseMockGeneration(row["generation_json"]),
    questions_rev: num(row["questions_rev"]) ?? 0,
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

function readModeFromRow(value: unknown): ContentMode | null {
  return CONTENT_MODES.find((mode) => mode === value) ?? null;
}

function rowToPage(row: Record<string, unknown>): PageRecord {
  return {
    id: String(row["id"]),
    document_id: String(row["document_id"]),
    page_index: Number(row["page_index"]),
    file_path: String(row["file_path"]),
    original_name: String(row["original_name"] ?? ""),
    ocr_status: String(row["ocr_status"] ?? "pending"),
    read_mode: readModeFromRow(row["read_mode"]),
  };
}

function queryAll(
  db: SqlJsDatabase,
  sql: string,
  bind: SqlValue[] = [],
): Record<string, unknown>[] {
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

function ensureDocumentColumns(db: SqlJsDatabase): void {
  const cols = queryAll(db, "PRAGMA table_info(pp_documents)");
  const names = new Set(cols.map((col) => String(col["name"])));
  if (!names.has("source_document_id")) {
    db.run("ALTER TABLE pp_documents ADD COLUMN source_document_id TEXT");
  }
  if (!names.has("generation_json")) {
    db.run("ALTER TABLE pp_documents ADD COLUMN generation_json TEXT");
  }
  if (!names.has("questions_rev")) {
    db.run("ALTER TABLE pp_documents ADD COLUMN questions_rev INTEGER NOT NULL DEFAULT 0");
  }
}

function ensurePageColumns(db: SqlJsDatabase): void {
  const cols = queryAll(db, "PRAGMA table_info(pp_pages)");
  const names = new Set(cols.map((col) => String(col["name"])));
  if (!names.has("read_mode")) {
    db.run("ALTER TABLE pp_pages ADD COLUMN read_mode TEXT");
  }
}

/** AISSEE Class 6 / Class 9. Ids match exam-prep's standards lookup (5 and 8). */
const DEFAULT_STANDARDS = [
  { id: 5, name: "5th", display_order: 5 },
  { id: 8, name: "8th", display_order: 8 },
] as const;

function ensureDefaultStandards(db: SqlJsDatabase): void {
  for (const row of DEFAULT_STANDARDS) {
    db.run(
      "INSERT OR IGNORE INTO pp_catalog_standards (id, name, display_order) VALUES (?, ?, ?)",
      [row.id, row.name, row.display_order],
    );
  }
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

function isInside(root: string, target: string, path: typeof import("node:path")): boolean {
  const relative = path.relative(root, target);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function resolveStoredImage(relative: string): Promise<string | null> {
  const normalized = normalizeStoredImagePath(relative);
  if (!normalized) return null;
  const path = await nodePath();
  const root = path.resolve(await imagesRoot());
  const absolute = path.resolve(root, ...normalized.split("/"));
  return isInside(root, absolute, path) ? absolute : null;
}

async function writeImage(relativePath: string, dataUrl: string): Promise<void> {
  const fs = await nodeFs();
  const path = await nodePath();
  const abs = await resolveStoredImage(relativePath);
  if (!abs) throw new Error("Invalid image path");
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const { bytes } = dataUrlToBytes(dataUrl);
  await fs.writeFile(abs, Buffer.from(bytes));
}

async function readImageDataUrl(relativePath: string): Promise<string | undefined> {
  const fs = await nodeFs();
  const abs = await resolveStoredImage(relativePath);
  if (!abs) return undefined;
  try {
    const buf = await fs.readFile(abs);
    const lower = relativePath.toLowerCase();
    const contentType = lower.endsWith(".svg")
      ? "image/svg+xml"
      : lower.endsWith(".png")
        ? "image/png"
        : lower.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
    return bytesToDataUrl(new Uint8Array(buf), contentType);
  } catch {
    return undefined;
  }
}

export async function readLocalImageDataUrl(relativePath: string): Promise<string | undefined> {
  return readImageDataUrl(relativePath);
}

type ManifestEntry = { storage_key?: string };

async function forgetManifest(options: {
  keys?: ReadonlySet<string>;
  prefix?: string;
  keep?: ReadonlySet<string>;
}): Promise<void> {
  if (!options.keys?.size && !options.prefix) return;
  const fs = await nodeFs();
  const path = await nodePath();
  const manifestPath = path.join(await imagesRoot(), "_manifest.json");
  let manifest: Record<string, ManifestEntry>;
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    manifest = parsed as Record<string, ManifestEntry>;
  } catch {
    return;
  }

  let changed = false;
  for (const [assetId, entry] of Object.entries(manifest)) {
    const storageKey = entry?.storage_key;
    if (typeof storageKey !== "string") continue;
    const listed = options.keys?.has(storageKey) ?? false;
    const underPrefix =
      options.prefix != null &&
      storageKey.startsWith(`${options.prefix}/`) &&
      !options.keep?.has(storageKey);
    if (!listed && !underPrefix) continue;
    delete manifest[assetId];
    changed = true;
  }
  if (changed) await fs.writeFile(manifestPath, JSON.stringify(manifest));
}

async function pruneEmptyDirectories(startDir: string, root: string): Promise<void> {
  const fs = await nodeFs();
  const path = await nodePath();
  let current = path.resolve(startDir);
  const resolvedRoot = path.resolve(root);
  while (isInside(resolvedRoot, current, path)) {
    let entries: string[];
    try {
      entries = await fs.readdir(current);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    await fs.rmdir(current);
    current = path.dirname(current);
  }
}

/** Unlink image files and drop their asset-manifest rows. Missing files count as deleted. */
async function deleteStoredImages(relativePaths: readonly string[]): Promise<void> {
  if (!relativePaths.length) return;
  const fs = await nodeFs();
  const path = await nodePath();
  const root = path.resolve(await imagesRoot());
  const removed = new Set<string>();
  const parents: string[] = [];
  try {
    for (const relative of relativePaths) {
      const normalized = normalizeStoredImagePath(relative);
      const absolute = normalized ? await resolveStoredImage(normalized) : null;
      if (!normalized || !absolute) continue;
      try {
        await fs.unlink(absolute);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw error;
      }
      removed.add(normalized);
      parents.push(path.dirname(absolute));
    }
  } finally {
    await forgetManifest({ keys: removed });
    for (const parent of parents) {
      try {
        await pruneEmptyDirectories(parent, root);
      } catch {
        // The file is already gone. A directory cleanup failure must not restore it.
      }
    }
  }
}

async function deleteUnkeptFiles(
  directory: string,
  root: string,
  keep: ReadonlySet<string>,
): Promise<void> {
  const fs = await nodeFs();
  const path = await nodePath();
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await deleteUnkeptFiles(absolute, root, keep);
      continue;
    }
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (keep.has(relative) || entry.name === "_manifest.json") continue;
    await fs.unlink(absolute);
  }
}

async function deleteDocumentDirectory(
  documentId: string,
  keep: ReadonlySet<string>,
): Promise<void> {
  const documentKey = normalizeStoredImagePath(documentId);
  if (!documentKey || documentKey.includes("/")) return;
  const fs = await nodeFs();
  const path = await nodePath();
  const root = path.resolve(await imagesRoot());
  const directory = path.join(root, documentKey);
  const keptInside = [...keep].some((stored) => stored.startsWith(`${documentKey}/`));
  if (!keptInside) {
    await fs.rm(directory, { recursive: true, force: true });
  } else {
    await deleteUnkeptFiles(directory, root, keep);
    await pruneEmptyTree(directory, root);
  }
  await forgetManifest({ prefix: documentKey, keep });
}

async function pruneEmptyTree(directory: string, root: string): Promise<void> {
  const fs = await nodeFs();
  const path = await nodePath();
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await pruneEmptyTree(path.join(directory, entry.name), root);
  }
  if (!isInside(path.resolve(root), path.resolve(directory), path)) return;
  const remaining = await fs.readdir(directory);
  if (remaining.length === 0) await fs.rmdir(directory);
}

function imagePathsInUse(
  db: SqlJsDatabase,
  documentId: string,
  nextQuestions: readonly Question[],
  options?: { includeOwnPages?: boolean },
): Set<string> {
  const inUse = collectQuestionsImagePaths(nextQuestions);
  const others = queryAll(db, "SELECT questions FROM pp_documents WHERE id != ?", [documentId]);
  for (const row of others) {
    for (const stored of collectQuestionsImagePaths(toQuestions(row["questions"])))
      inUse.add(stored);
  }
  const includeOwnPages = options?.includeOwnPages !== false;
  const pages = includeOwnPages
    ? queryAll(db, "SELECT file_path FROM pp_pages")
    : queryAll(db, "SELECT file_path FROM pp_pages WHERE document_id != ?", [documentId]);
  for (const page of pages) {
    const stored = normalizeStoredImagePath(String(page["file_path"] ?? ""));
    if (stored) inUse.add(stored);
  }
  return inUse;
}

async function listFigurePaths(documentId: string): Promise<string[]> {
  const documentKey = normalizeStoredImagePath(documentId);
  if (!documentKey) return [];
  const fs = await nodeFs();
  const path = await nodePath();
  const dir = path.join(await imagesRoot(), documentKey);
  const found: string[] = [];

  async function walk(current: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), rel);
        continue;
      }
      const image = /\.(jpe?g|png|webp|svg)$/i.test(entry.name);
      const sourceCrop = entry.name.includes("fig-");
      const generated = rel.includes("/generated/") && entry.name !== "_manifest.json";
      if (image && (sourceCrop || generated)) found.push(rel);
    }
  }

  await walk(dir, documentKey);
  return found;
}

export type PushSyncStatus = "never" | "in_progress" | "incomplete" | "complete";

export type DocumentListItem = DocumentMeta & {
  question_count: number;
  page_count: number;
  push_status: PushSyncStatus;
  push_synced: number;
  push_total: number;
  push_error: string | null;
};

export async function listDocuments(): Promise<DocumentListItem[]> {
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
  const pushRows = queryAll(
    db,
    "SELECT document_id, status, total_count, synced_count, last_error FROM pp_push_documents",
  );
  const pushes = new Map<string, Record<string, unknown>>();
  for (const row of pushRows) pushes.set(String(row["document_id"]), row);
  return rows.map((row) => {
    const push = pushes.get(String(row["id"]));
    const status = str(push?.["status"]);
    const pushStatus: PushSyncStatus =
      status === "in_progress" || status === "incomplete" || status === "complete"
        ? status
        : "never";
    return {
      ...rowToMeta(row),
      question_count: toQuestions(row["questions"]).length,
      page_count: counts.get(String(row["id"])) ?? 0,
      push_status: pushStatus,
      push_synced: num(push?.["synced_count"]) ?? 0,
      push_total: num(push?.["total_count"]) ?? 0,
      push_error: str(push?.["last_error"]),
    };
  });
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

export type CreateDocumentOptions = {
  title?: string;
  source_document_id?: string | null;
  generation?: MockGenerationState | null;
};

export async function createDocument(
  kind: DocumentKind,
  titleOrOptions?: string | CreateDocumentOptions,
): Promise<DocumentMeta> {
  const options: CreateDocumentOptions =
    typeof titleOrOptions === "string"
      ? { title: titleOrOptions }
      : titleOrOptions == null
        ? {}
        : titleOrOptions;

  return withWrite((db) => {
    const id = uuid();
    const created = nowIso();
    const generationJson = options.generation ? JSON.stringify(options.generation) : null;
    db.run(
      `INSERT INTO pp_documents (
        id, kind, title, source_document_id, generation_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params(
        id,
        kind,
        options.title?.trim() || "Untitled",
        options.source_document_id ?? null,
        generationJson,
        created,
        created,
      ),
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
  return withWrite(async (db) => {
    const existing = queryOne(db, "SELECT * FROM pp_documents WHERE id = ?", [id]);
    if (!existing) return null;

    const currentRev = num(existing["questions_rev"]) ?? 0;
    if (patch.questions) {
      if (patch.questions_rev !== currentRev) throw new Error(PAPER_CHANGED_MESSAGE);
      const documentKey = normalizeStoredImagePath(id);
      const previous = toQuestions(existing["questions"]);
      const dropped = droppedImagePaths(previous, patch.questions);
      if (dropped.length && documentKey && !documentKey.includes("/")) {
        const inUse = imagePathsInUse(db, id, patch.questions);
        const owned = dropped.filter(
          (stored) => stored.startsWith(`${documentKey}/`) && !inUse.has(stored),
        );
        // Remove files before the row changes so a failed delete can be retried.
        await deleteStoredImages(owned);
      }
    }

    const next = { ...existing };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || key === "questions_rev") continue;
      if (key === "questions") {
        next["questions"] = JSON.stringify(value);
      } else if (key === "generation") {
        next["generation_json"] = value == null ? null : JSON.stringify(value);
      } else if (key === "section_timing" || key === "negative_marking" || key === "allow_pause") {
        next[key] = value ? 1 : 0;
      } else {
        next[key] = value;
      }
    }
    next["updated_at"] = nowIso();
    next["questions_rev"] = patch.questions ? currentRev + 1 : currentRev;

    db.run(
      `UPDATE pp_documents SET
        kind = ?, title = ?, year = ?, standard_id = ?, stream_id = ?, subject_id = ?,
        duration_minutes = ?, total_marks = ?, difficulty = ?, exam = ?, notes = ?,
        source = ?, description = ?, section_timing = ?, negative_marking = ?,
        allow_pause = ?, max_attempts = ?, default_marks = ?, default_negative_marks = ?,
        source_document_id = ?, generation_json = ?, questions = ?, questions_rev = ?, updated_at = ?
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
        next["source_document_id"] ?? null,
        next["generation_json"] ?? null,
        typeof next["questions"] === "string"
          ? next["questions"]
          : JSON.stringify(next["questions"] ?? []),
        next["questions_rev"],
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
    const row = queryOne(db, "SELECT questions FROM pp_documents WHERE id = ?", [id]);
    const owned = row ? [...collectQuestionsImagePaths(toQuestions(row["questions"]))] : [];
    const keep = imagePathsInUse(db, id, [], { includeOwnPages: false });
    const documentKey = normalizeStoredImagePath(id);
    if (documentKey && !documentKey.includes("/")) {
      await deleteDocumentDirectory(id, keep);
      const external = owned.filter(
        (stored) => !stored.startsWith(`${documentKey}/`) && !keep.has(stored),
      );
      await deleteStoredImages(external);
    }
    if (!row) return;
    db.run("DELETE FROM pp_push_questions WHERE document_id = ?", [id]);
    db.run("DELETE FROM pp_push_retired_groups WHERE document_id = ?", [id]);
    db.run("DELETE FROM pp_push_documents WHERE document_id = ?", [id]);
    db.run("DELETE FROM pp_pages WHERE document_id = ?", [id]);
    db.run("DELETE FROM pp_documents WHERE id = ?", [id]);
  });
}

export async function appendPage(input: {
  documentId: string;
  dataUrl: string;
  originalName: string;
}): Promise<PageRecord> {
  const page = await withWrite(async (db) => {
    const countRow = queryOne(db, "SELECT COUNT(*) AS c FROM pp_pages WHERE document_id = ?", [
      input.documentId,
    ]);
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
  const file_path = normalizeStoredImagePath(`${input.documentId}/${input.filename}`);
  const documentKey = normalizeStoredImagePath(input.documentId);
  if (!file_path || !documentKey || !file_path.startsWith(`${documentKey}/`)) {
    throw new Error("Invalid figure filename");
  }
  await writeImage(file_path, input.dataUrl);
  return file_path;
}

export async function removePage(pageId: string): Promise<void> {
  await withWrite(async (db) => {
    const row = queryOne(db, "SELECT * FROM pp_pages WHERE id = ?", [pageId]);
    if (!row) return;
    const page = rowToPage(row);
    const document = queryOne(db, "SELECT questions FROM pp_documents WHERE id = ?", [
      page.document_id,
    ]);
    const stillUsed = imagePathsInUse(
      db,
      page.document_id,
      document ? toQuestions(document["questions"]) : [],
      { includeOwnPages: false },
    );
    const stored = normalizeStoredImagePath(page.file_path);
    if (stored && !stillUsed.has(stored)) await deleteStoredImages([stored]);
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
    db.run("UPDATE pp_documents SET updated_at = ? WHERE id = ?", [nowIso(), page.document_id]);
  });
}

export async function markPageOcr(
  pageId: string,
  status: string,
  readMode?: ContentMode | null,
): Promise<void> {
  await withWrite((db) => {
    const mode = status === "done" ? readModeFromRow(readMode) : null;
    db.run(
      "UPDATE pp_pages SET ocr_status = ?, read_mode = ? WHERE id = ?",
      params(status, mode, pageId),
    );
  });
}

/** Mark every page of a paper unread. Used when all questions are cleared. */
export async function resetDocumentPageReads(documentId: string): Promise<void> {
  await withWrite((db) => {
    db.run("UPDATE pp_pages SET ocr_status = 'pending', read_mode = NULL WHERE document_id = ?", [
      documentId,
    ]);
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
        params(Number(r["id"]), num(r["subject_id"]), String(r["name"]), num(r["parent_topic_id"])),
      );
    }
    for (const r of arr("streams", "catalog_streams")) {
      if (r["id"] == null || !r["name"]) continue;
      db.run(
        "INSERT INTO pp_catalog_streams (id, name, standard_id) VALUES (?, ?, ?)",
        params(Number(r["id"]), String(r["name"]), num(r["standard_id"])),
      );
    }
    ensureDefaultStandards(db);
  });
  return getCatalog();
}

export type PushQuestionReceipt = {
  questionId: string;
  contentHash: string;
};

export async function readPushLedger(documentId: string): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = queryAll(
    db,
    "SELECT question_id, content_hash FROM pp_push_questions WHERE document_id = ?",
    [documentId],
  );
  const ledger = new Map<string, string>();
  for (const row of rows) ledger.set(String(row["question_id"]), String(row["content_hash"]));
  return ledger;
}

export async function markPushLedger(
  documentId: string,
  entries: PushQuestionReceipt[],
): Promise<void> {
  if (!entries.length) return;
  const pushedAt = nowIso();
  await withWrite((db) => {
    for (const entry of entries) {
      db.run(
        `INSERT INTO pp_push_questions (document_id, question_id, content_hash, pushed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(document_id, question_id) DO UPDATE SET
           content_hash = excluded.content_hash,
           pushed_at = excluded.pushed_at`,
        [documentId, entry.questionId, entry.contentHash, pushedAt],
      );
    }
  });
}

export async function removePushLedger(documentId: string, questionIds: string[]): Promise<void> {
  if (!questionIds.length) return;
  await withWrite((db) => {
    for (const questionId of questionIds) {
      db.run("DELETE FROM pp_push_questions WHERE document_id = ? AND question_id = ?", [
        documentId,
        questionId,
      ]);
    }
  });
}

export async function readRetiredGroups(documentId: string): Promise<string[]> {
  const db = await getDb();
  const rows = queryAll(db, "SELECT group_id FROM pp_push_retired_groups WHERE document_id = ?", [
    documentId,
  ]);
  return rows.map((row) => String(row["group_id"]));
}

export async function rememberRetiredGroups(documentId: string, groupIds: string[]): Promise<void> {
  const ids = [...new Set(groupIds.filter(Boolean))];
  if (!ids.length) return;
  await withWrite((db) => {
    for (const groupId of ids) {
      db.run(
        `INSERT INTO pp_push_retired_groups (document_id, group_id) VALUES (?, ?)
         ON CONFLICT(document_id, group_id) DO NOTHING`,
        [documentId, groupId],
      );
    }
  });
}

export async function forgetRetiredGroups(documentId: string, groupIds: string[]): Promise<void> {
  const ids = [...new Set(groupIds.filter(Boolean))];
  if (!ids.length) return;
  await withWrite((db) => {
    for (const groupId of ids) {
      db.run("DELETE FROM pp_push_retired_groups WHERE document_id = ? AND group_id = ?", [
        documentId,
        groupId,
      ]);
    }
  });
}

export async function savePushStatus(
  documentId: string,
  status: {
    status: "in_progress" | "incomplete" | "complete";
    total: number;
    synced: number;
    error: string | null;
  },
): Promise<void> {
  await withWrite((db) => {
    db.run(
      `INSERT INTO pp_push_documents (
         document_id, status, total_count, synced_count, last_error, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(document_id) DO UPDATE SET
         status = excluded.status,
         total_count = excluded.total_count,
         synced_count = excluded.synced_count,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      [documentId, status.status, status.total, status.synced, status.error, nowIso()],
    );
  });
}
