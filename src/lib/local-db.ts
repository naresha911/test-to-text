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
  isLoadableQuestionImage,
  normalizeStoredImagePath,
} from "@/lib/question-images";
import { ensureSvgRootAttributes } from "@/lib/assets/svg-sanitize";
import { patternSubtypeOf, patternTypeOf } from "@/lib/generation/pattern-classifier";
import { detectSkill } from "@/lib/generation/skill-detect";
import { pageImageFilePath, pagesWithLostImage } from "@/lib/page-image-path";
import type { Question } from "@/lib/question-schema";
import { skillByType } from "@/lib/question-taxonomy";
import { CONTENT_MODES, type ContentMode } from "@/lib/reading/mode";
import type {
  AgentProposal,
  CalibrationAlert,
  CalibrationAlertMetric,
  CalibrationCase,
  CalibrationProfile,
  CalibrationRun,
  CalibrationRunStatus,
  CalibrationScope,
  CalibrationSummary,
  ProposalStatus,
} from "@/lib/generation/calibration/types";

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
      topic_id INTEGER,
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
      used_for_training INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS pp_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS pp_question_index (
      question_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      standard_id INTEGER,
      subject_id INTEGER,
      stream_id INTEGER,
      topic_id INTEGER,
      skill_type TEXT,
      pattern_type TEXT,
      pattern_subtype TEXT,
      difficulty TEXT,
      marks REAL,
      approved INTEGER NOT NULL DEFAULT 0,
      is_mock INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pp_question_index_scope_idx
      ON pp_question_index(standard_id, subject_id, stream_id, skill_type, pattern_subtype);
    CREATE INDEX IF NOT EXISTS pp_question_index_document_idx ON pp_question_index(document_id);
    CREATE INDEX IF NOT EXISTS pp_question_index_mock_idx ON pp_question_index(is_mock, skill_type);
    CREATE INDEX IF NOT EXISTS pp_question_index_approved_idx
      ON pp_question_index(approved, is_mock, skill_type);

    CREATE TABLE IF NOT EXISTS pp_calibration_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      summary_json TEXT
    );

    CREATE TABLE IF NOT EXISTS pp_calibration_cases (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      skill_type TEXT NOT NULL,
      standard_id INTEGER,
      subject_id INTEGER,
      stream_id INTEGER,
      pattern_subtype TEXT,
      reference_question_id TEXT,
      reference_document_id TEXT,
      generated_question_id TEXT,
      generated_json TEXT,
      reference_stem TEXT,
      structural_json TEXT,
      judge_json TEXT,
      score REAL NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pp_calibration_cases_skill_idx
      ON pp_calibration_cases(skill_type, created_at);

    CREATE TABLE IF NOT EXISTS pp_calibration_alerts (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      severity TEXT NOT NULL,
      skill_type TEXT,
      standard_id INTEGER,
      subject_id INTEGER,
      stream_id INTEGER,
      reason TEXT NOT NULL,
      metric_json TEXT,
      source TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pp_calibration_alerts_open_idx
      ON pp_calibration_alerts(resolved_at, severity);

    CREATE TABLE IF NOT EXISTS pp_agent_proposals (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      applied_at TEXT,
      status TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      skill_type TEXT,
      kind TEXT NOT NULL,
      target_json TEXT NOT NULL,
      before TEXT,
      after TEXT NOT NULL,
      rationale TEXT
    );

    CREATE TABLE IF NOT EXISTS pp_calibration_profiles (
      scope_key TEXT NOT NULL,
      skill_type TEXT NOT NULL,
      exemplar_limit INTEGER,
      exemplar_scope TEXT,
      difficulty_bias INTEGER,
      detect_threshold REAL,
      updated_at TEXT NOT NULL,
      rationale TEXT,
      PRIMARY KEY (scope_key, skill_type)
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
  if (!dbPromise) {
    // The backfill runs on the raw handle before the promise settles, so every
    // caller waits for a populated index (and the withWrite -> getDb cycle is
    // avoided while the database promise is still resolving).
    dbPromise = (async () => {
      const db = await openDatabase();
      try {
        if (backfillQuestionIndexOn(db)) await persist(db);
      } catch {
        // A failed backfill must not reject the session's only db handle:
        // serve the db un-indexed — the index self-heals on the next save.
      }
      return db;
    })();
  }
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
    topic_id: num(row["topic_id"]),
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
    used_for_training: bool(row["used_for_training"], false),
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
  if (!names.has("topic_id")) {
    db.run("ALTER TABLE pp_documents ADD COLUMN topic_id INTEGER");
  }
  if (!names.has("used_for_training")) {
    db.run("ALTER TABLE pp_documents ADD COLUMN used_for_training INTEGER NOT NULL DEFAULT 0");
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
    if (lower.endsWith(".svg")) {
      const svg = ensureSvgRootAttributes(new TextDecoder().decode(buf));
      return bytesToDataUrl(new TextEncoder().encode(svg), "image/svg+xml");
    }
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
      if (isLoadableQuestionImage(rel)) found.push(rel);
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

/** Point a page that lost its photo at an empty unique file, and leave the shared file alone. */
async function detachLostPageImages(documentId: string): Promise<void> {
  const db = await getDb();
  const rows = queryAll(
    db,
    "SELECT id, page_index, file_path FROM pp_pages WHERE document_id = ? ORDER BY page_index ASC",
    [documentId],
  );
  const lost = pagesWithLostImage(
    rows.map((row) => ({
      id: String(row["id"]),
      page_index: Number(row["page_index"] ?? 0),
      file_path: String(row["file_path"] ?? ""),
    })),
  );
  if (!lost.length) return;
  await withWrite((writeDb) => {
    for (const page of lost) {
      writeDb.run(
        "UPDATE pp_pages SET file_path = ?, ocr_status = 'pending', read_mode = NULL WHERE id = ?",
        [pageImageFilePath(documentId, page.id), page.id],
      );
    }
  });
}

export async function getDocument(id: string): Promise<{
  document: DocumentMeta;
  questions: Question[];
  pages: PageRecord[];
  figureUrls: Record<string, string>;
} | null> {
  await detachLostPageImages(id);
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
      } else if (
        key === "section_timing" ||
        key === "negative_marking" ||
        key === "allow_pause" ||
        key === "used_for_training"
      ) {
        next[key] = value ? 1 : 0;
      } else {
        next[key] = value;
      }
    }
    next["updated_at"] = nowIso();
    next["questions_rev"] = patch.questions ? currentRev + 1 : currentRev;

    db.run(
      `UPDATE pp_documents SET
        kind = ?, title = ?, year = ?, standard_id = ?, stream_id = ?, subject_id = ?, topic_id = ?,
        duration_minutes = ?, total_marks = ?, difficulty = ?, exam = ?, notes = ?,
        source = ?, description = ?, section_timing = ?, negative_marking = ?,
        allow_pause = ?, used_for_training = ?, max_attempts = ?, default_marks = ?,
        default_negative_marks = ?,
        source_document_id = ?, generation_json = ?, questions = ?, questions_rev = ?, updated_at = ?
       WHERE id = ?`,
      params(
        next["kind"],
        next["title"],
        next["year"],
        next["standard_id"],
        next["stream_id"],
        next["subject_id"],
        next["topic_id"] ?? null,
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
        next["used_for_training"],
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
    if (row && patch.questions) {
      syncQuestionIndex(db, rowToMeta(row), patch.questions);
    }
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
    db.run("DELETE FROM pp_question_index WHERE document_id = ?", [id]);
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
    const id = uuid();
    const file_path = pageImageFilePath(input.documentId, id);
    await writeImage(file_path, input.dataUrl);
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

/* ------------------------------------------------------------------ *
 * Question index — the retrieval + learning surface for generation.
 * Derived from pp_documents.questions. Learned skills are aggregated
 * from this index (idempotent, so repeated saves do not inflate counts).
 * ------------------------------------------------------------------ */

/** Lightweight document load: questions and meta only, no page/figure images. */
export async function getStoredQuestions(
  id: string,
): Promise<{ document: DocumentMeta; questions: Question[] } | null> {
  const db = await getDb();
  const row = queryOne(db, "SELECT * FROM pp_documents WHERE id = ?", [id]);
  if (!row) return null;
  return { document: rowToMeta(row), questions: toQuestions(row["questions"]) };
}

function indexedSkill(question: Question): {
  skill_type: string | null;
  pattern_type: string | null;
  pattern_subtype: string | null;
} {
  const explicit =
    question.skill_type && skillByType(question.skill_type) ? question.skill_type : null;
  const detected =
    explicit ??
    detectSkill({
      stem: question.stem,
      instructions: question.instructions,
      type: question.type,
      figureCount: question.figures.length,
      optionImageCount: question.options.filter((option) => option.image_path).length,
      optionTexts: question.options.map((option) => option.text),
      passage: question.passage,
    });
  const skill = detected && detected !== "unsupported" ? detected : null;
  if (!skill) return { skill_type: null, pattern_type: null, pattern_subtype: null };
  return {
    skill_type: skill,
    pattern_type: patternTypeOf(skill),
    pattern_subtype:
      question.pattern_subtype ?? patternSubtypeOf({ skillType: skill, source: question }),
  };
}

function syncQuestionIndex(db: SqlJsDatabase, meta: DocumentMeta, questions: Question[]): void {
  db.run("DELETE FROM pp_question_index WHERE document_id = ?", [meta.id]);
  const createdAt = nowIso();
  const isMock = meta.kind === "ai_mock" ? 1 : 0;
  for (const question of questions) {
    if (question.approval_status === "rejected") continue;
    const { skill_type, pattern_type, pattern_subtype } = indexedSkill(question);
    const approved =
      question.approved ||
      question.approval_status === "reviewed" ||
      question.approval_status === "published"
        ? 1
        : 0;
    db.run(
      `INSERT INTO pp_question_index (
         question_id, document_id, kind, standard_id, subject_id, stream_id, topic_id,
         skill_type, pattern_type, pattern_subtype, difficulty, marks, approved, is_mock, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params(
        question.id,
        meta.id,
        meta.kind,
        meta.standard_id ?? null,
        question.subject_id ?? meta.subject_id ?? null,
        question.stream_id ?? meta.stream_id ?? null,
        question.topic_id ?? meta.topic_id ?? null,
        skill_type,
        pattern_type,
        pattern_subtype,
        question.difficulty ?? null,
        question.marks ?? null,
        approved,
        isMock,
        createdAt,
      ),
    );
  }
}

/** Re-index a document's questions. Called from updateDocument on every save. */
export async function syncDocumentQuestionIndex(documentId: string): Promise<void> {
  await withWrite((db) => {
    const row = queryOne(db, "SELECT * FROM pp_documents WHERE id = ?", [documentId]);
    if (!row) return;
    syncQuestionIndex(db, rowToMeta(row), toQuestions(row["questions"]));
  });
}

/** Index every document once. Returns true when it did work and the db needs persisting. */
function backfillQuestionIndexOn(db: SqlJsDatabase): boolean {
  const done = queryOne(db, "SELECT value FROM pp_meta WHERE key = 'question_index_backfilled'");
  if (done?.["value"] === "1") return false;
  const rows = queryAll(db, "SELECT * FROM pp_documents");
  for (const row of rows) {
    syncQuestionIndex(db, rowToMeta(row), toQuestions(row["questions"]));
  }
  db.run("INSERT OR REPLACE INTO pp_meta (key, value) VALUES ('question_index_backfilled', '1')");
  return true;
}

/** Index every document once, guarded so it runs a single time. */
export async function backfillQuestionIndex(): Promise<void> {
  await withWrite((db) => {
    backfillQuestionIndexOn(db);
  });
}

export type QuestionIndexScope = {
  standard_id?: number | null;
  subject_id?: number | null;
  stream_id?: number | null;
  skill_type?: string | null;
  pattern_subtype?: string | null;
  /** false = only source papers, true = only mocks, undefined = both. */
  is_mock?: boolean;
  /** Restrict to given source document kinds (agent memory separation). */
  kinds?: DocumentKind[];
  /** Restrict to one document (paper-scoped calibration training). */
  document_id?: string | null;
};

export type IndexedQuestionRef = {
  question_id: string;
  document_id: string;
  kind: string;
  skill_type: string | null;
  pattern_type: string | null;
  pattern_subtype: string | null;
  is_mock: number;
  created_at: string;
};

function scopeWhere(scope: QuestionIndexScope): { clause: string; bind: SqlValue[] } {
  const conditions: string[] = [];
  const bind: SqlValue[] = [];
  const add = (column: string, value: number | string | null | undefined) => {
    if (value == null || value === "") return;
    conditions.push(`${column} = ?`);
    bind.push(value as SqlValue);
  };
  add("standard_id", scope.standard_id);
  add("subject_id", scope.subject_id);
  add("stream_id", scope.stream_id);
  add("skill_type", scope.skill_type);
  add("pattern_subtype", scope.pattern_subtype);
  add("document_id", scope.document_id);
  if (scope.is_mock !== undefined) {
    conditions.push("is_mock = ?");
    bind.push(scope.is_mock ? 1 : 0);
  }
  if (scope.kinds?.length) {
    conditions.push(`kind IN (${scope.kinds.map(() => "?").join(", ")})`);
    bind.push(...scope.kinds);
  }
  return { clause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", bind };
}

/** Source questions matching a scope, most recent first, source papers preferred. */
export async function queryExemplarQuestions(
  scope: QuestionIndexScope,
  limit: number,
): Promise<IndexedQuestionRef[]> {
  const db = await getDb();
  const { clause, bind } = scopeWhere(scope);
  const rows = queryAll(
    db,
    `SELECT question_id, document_id, kind, skill_type, pattern_type, pattern_subtype, is_mock, created_at
       FROM pp_question_index ${clause}
     ORDER BY is_mock ASC, created_at DESC
     LIMIT ?`,
    [...bind, Math.max(1, Math.floor(limit))],
  );
  return rows.map((row) => ({
    question_id: String(row["question_id"]),
    document_id: String(row["document_id"]),
    kind: String(row["kind"]),
    skill_type: str(row["skill_type"]),
    pattern_type: str(row["pattern_type"]),
    pattern_subtype: str(row["pattern_subtype"]),
    is_mock: Number(row["is_mock"] ?? 0),
    created_at: String(row["created_at"]),
  }));
}

export type LearnedSkill = {
  standard_id: number | null;
  subject_id: number | null;
  stream_id: number | null;
  skill_type: string;
  pattern_subtype: string;
  source_count: number;
  mock_count: number;
  last_seen_at: string;
};

/** The agent's learned skill vocabulary for a scope, aggregated from the index. */
export async function readLearnedSkills(scope: QuestionIndexScope): Promise<LearnedSkill[]> {
  const db = await getDb();
  const { clause, bind } = scopeWhere(scope);
  const where = clause ? `${clause} AND skill_type IS NOT NULL` : "WHERE skill_type IS NOT NULL";
  const rows = queryAll(
    db,
    `SELECT standard_id, subject_id, stream_id, skill_type, pattern_subtype,
            SUM(CASE WHEN is_mock = 0 THEN 1 ELSE 0 END) AS source_count,
            SUM(CASE WHEN is_mock = 1 THEN 1 ELSE 0 END) AS mock_count,
            MAX(created_at) AS last_seen_at
       FROM pp_question_index ${where}
      GROUP BY standard_id, subject_id, stream_id, skill_type, pattern_subtype
      ORDER BY source_count DESC, mock_count DESC`,
    bind,
  );
  return rows.map((row) => ({
    standard_id: num(row["standard_id"]),
    subject_id: num(row["subject_id"]),
    stream_id: num(row["stream_id"]),
    skill_type: String(row["skill_type"]),
    pattern_subtype: String(row["pattern_subtype"] ?? ""),
    source_count: Number(row["source_count"] ?? 0),
    mock_count: Number(row["mock_count"] ?? 0),
    last_seen_at: String(row["last_seen_at"] ?? ""),
  }));
}

/**
 * Approved past-paper questions for a skill. These are the expected output the
 * calibrator compares generated questions against. Mocks are excluded.
 */
export async function queryApprovedReferenceQuestions(
  scope: QuestionIndexScope,
  limit: number,
): Promise<IndexedQuestionRef[]> {
  const db = await getDb();
  const { clause, bind } = scopeWhere(scope);
  const where = `${clause ? `${clause} AND` : "WHERE"} approved = 1 AND is_mock = 0`;
  const rows = queryAll(
    db,
    `SELECT question_id, document_id, kind, skill_type, pattern_type, pattern_subtype, is_mock, created_at
       FROM pp_question_index ${where}
     ORDER BY created_at DESC
     LIMIT ?`,
    [...bind, Math.max(1, Math.floor(limit))],
  );
  return rows.map((row) => ({
    question_id: String(row["question_id"]),
    document_id: String(row["document_id"]),
    kind: String(row["kind"]),
    skill_type: str(row["skill_type"]),
    pattern_type: str(row["pattern_type"]),
    pattern_subtype: str(row["pattern_subtype"]),
    is_mock: Number(row["is_mock"] ?? 0),
    created_at: String(row["created_at"]),
  }));
}

/** Distinct skills among a document's approved source questions (training input). */
export async function readApprovedDocumentSkills(documentId: string): Promise<string[]> {
  const db = await getDb();
  const rows = queryAll(
    db,
    `SELECT DISTINCT skill_type FROM pp_question_index
      WHERE document_id = ? AND approved = 1 AND is_mock = 0 AND skill_type IS NOT NULL
      ORDER BY skill_type`,
    params(documentId),
  );
  return rows.map((row) => String(row["skill_type"]));
}

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function rowToCalibrationRun(row: Record<string, unknown>): CalibrationRun {
  return {
    id: String(row["id"]),
    started_at: String(row["started_at"]),
    finished_at: str(row["finished_at"]),
    status: (str(row["status"]) as CalibrationRunStatus) ?? "running",
    scope: parseJsonColumn<CalibrationScope>(row["scope_json"], {
      standard_id: null,
      subject_id: null,
      stream_id: null,
      skills: [],
    }),
    summary: parseJsonColumn<CalibrationSummary | null>(row["summary_json"], null),
  };
}

function rowToCalibrationCase(row: Record<string, unknown>): CalibrationCase {
  return {
    id: String(row["id"]),
    run_id: String(row["run_id"]),
    skill_type: String(row["skill_type"]),
    standard_id: num(row["standard_id"]),
    subject_id: num(row["subject_id"]),
    stream_id: num(row["stream_id"]),
    pattern_subtype: str(row["pattern_subtype"]),
    reference_question_id: str(row["reference_question_id"]),
    reference_document_id: str(row["reference_document_id"]),
    generated_question_id: str(row["generated_question_id"]),
    generated: parseJsonColumn<Question | null>(row["generated_json"], null),
    reference_stem: str(row["reference_stem"]),
    structural: parseJsonColumn(row["structural_json"], null),
    judge: parseJsonColumn(row["judge_json"], null),
    score: Number(row["score"] ?? 0),
    passed: Number(row["passed"] ?? 0) !== 0,
    created_at: String(row["created_at"]),
  };
}

export async function createCalibrationRun(scope: CalibrationScope): Promise<CalibrationRun> {
  const run: CalibrationRun = {
    id: uuid(),
    started_at: nowIso(),
    finished_at: null,
    status: "running",
    scope,
    summary: null,
  };
  await withWrite((db) => {
    db.run(
      `INSERT INTO pp_calibration_runs (id, started_at, finished_at, status, scope_json, summary_json)
        VALUES (?, ?, NULL, 'running', ?, NULL)`,
      params(run.id, run.started_at, JSON.stringify(scope)),
    );
  });
  return run;
}

export async function finishCalibrationRun(
  id: string,
  input: { status: CalibrationRunStatus; summary: CalibrationSummary | null },
): Promise<void> {
  await withWrite((db) => {
    db.run(
      `UPDATE pp_calibration_runs SET finished_at = ?, status = ?, summary_json = ? WHERE id = ?`,
      params(nowIso(), input.status, input.summary ? JSON.stringify(input.summary) : null, id),
    );
  });
}

export async function listCalibrationRuns(limit = 20): Promise<CalibrationRun[]> {
  const db = await getDb();
  return queryAll(
    db,
    `SELECT * FROM pp_calibration_runs ORDER BY started_at DESC LIMIT ?`,
    params(Math.max(1, Math.floor(limit))),
  ).map(rowToCalibrationRun);
}

export async function getCalibrationRun(id: string): Promise<CalibrationRun | null> {
  const db = await getDb();
  const row = queryOne(db, `SELECT * FROM pp_calibration_runs WHERE id = ?`, params(id));
  return row ? rowToCalibrationRun(row) : null;
}

export async function insertCalibrationCase(record: CalibrationCase): Promise<void> {
  await withWrite((db) => {
    db.run(
      `INSERT OR REPLACE INTO pp_calibration_cases (
         id, run_id, skill_type, standard_id, subject_id, stream_id, pattern_subtype,
         reference_question_id, reference_document_id, generated_question_id,
         generated_json, reference_stem, structural_json, judge_json, score, passed, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params(
        record.id,
        record.run_id,
        record.skill_type,
        record.standard_id,
        record.subject_id,
        record.stream_id,
        record.pattern_subtype,
        record.reference_question_id,
        record.reference_document_id,
        record.generated_question_id,
        record.generated ? JSON.stringify(record.generated) : null,
        record.reference_stem,
        record.structural ? JSON.stringify(record.structural) : null,
        record.judge ? JSON.stringify(record.judge) : null,
        record.score,
        record.passed ? 1 : 0,
        record.created_at,
      ),
    );
  });
}

export async function listCalibrationCases(runId: string): Promise<CalibrationCase[]> {
  const db = await getDb();
  return queryAll(
    db,
    `SELECT * FROM pp_calibration_cases WHERE run_id = ? ORDER BY created_at ASC`,
    params(runId),
  ).map(rowToCalibrationCase);
}

function rowToCalibrationProfile(row: Record<string, unknown>): CalibrationProfile {
  const scope = str(row["exemplar_scope"]);
  return {
    scope_key: String(row["scope_key"]),
    skill_type: String(row["skill_type"]),
    exemplar_limit: num(row["exemplar_limit"]),
    exemplar_scope: scope === "exact" || scope === "skill" ? scope : null,
    difficulty_bias: num(row["difficulty_bias"]),
    detect_threshold: num(row["detect_threshold"]),
    updated_at: String(row["updated_at"]),
    rationale: str(row["rationale"]),
  };
}

export async function readCalibrationProfile(
  scopeKey: string,
  skillType: string,
): Promise<CalibrationProfile | null> {
  const db = await getDb();
  const row = queryOne(
    db,
    `SELECT * FROM pp_calibration_profiles WHERE scope_key = ? AND skill_type = ?`,
    params(scopeKey, skillType),
  );
  return row ? rowToCalibrationProfile(row) : null;
}

export async function listCalibrationProfiles(scopeKey: string): Promise<CalibrationProfile[]> {
  const db = await getDb();
  return queryAll(
    db,
    `SELECT * FROM pp_calibration_profiles WHERE scope_key = ?`,
    params(scopeKey),
  ).map(rowToCalibrationProfile);
}

export async function upsertCalibrationProfile(profile: CalibrationProfile): Promise<void> {
  await withWrite((db) => {
    db.run(
      `INSERT OR REPLACE INTO pp_calibration_profiles (
         scope_key, skill_type, exemplar_limit, exemplar_scope,
         difficulty_bias, detect_threshold, updated_at, rationale
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params(
        profile.scope_key,
        profile.skill_type,
        profile.exemplar_limit,
        profile.exemplar_scope,
        profile.difficulty_bias,
        profile.detect_threshold,
        profile.updated_at,
        profile.rationale,
      ),
    );
  });
}

function rowToCalibrationAlert(row: Record<string, unknown>): CalibrationAlert {
  return {
    id: String(row["id"]),
    created_at: String(row["created_at"]),
    resolved_at: str(row["resolved_at"]),
    severity: (str(row["severity"]) as CalibrationAlert["severity"]) ?? "warn",
    skill_type: str(row["skill_type"]),
    standard_id: num(row["standard_id"]),
    subject_id: num(row["subject_id"]),
    stream_id: num(row["stream_id"]),
    reason: String(row["reason"]),
    metric: parseJsonColumn<CalibrationAlertMetric>(row["metric_json"], {}),
    source: String(row["source"]),
  };
}

export async function insertCalibrationAlert(
  input: Omit<CalibrationAlert, "id" | "created_at" | "resolved_at">,
): Promise<CalibrationAlert> {
  const alert: CalibrationAlert = {
    ...input,
    id: uuid(),
    created_at: nowIso(),
    resolved_at: null,
  };
  await withWrite((db) => {
    db.run(
      `INSERT INTO pp_calibration_alerts (
         id, created_at, resolved_at, severity, skill_type, standard_id, subject_id,
         stream_id, reason, metric_json, source
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params(
        alert.id,
        alert.created_at,
        alert.severity,
        alert.skill_type,
        alert.standard_id,
        alert.subject_id,
        alert.stream_id,
        alert.reason,
        JSON.stringify(alert.metric),
        alert.source,
      ),
    );
  });
  return alert;
}

export async function listCalibrationAlerts(
  options: { openOnly?: boolean } = {},
): Promise<CalibrationAlert[]> {
  const db = await getDb();
  const where = options.openOnly ? "WHERE resolved_at IS NULL" : "";
  return queryAll(db, `SELECT * FROM pp_calibration_alerts ${where} ORDER BY created_at DESC`).map(
    rowToCalibrationAlert,
  );
}

export async function countOpenCalibrationAlerts(): Promise<number> {
  const db = await getDb();
  const row = queryOne(
    db,
    `SELECT COUNT(*) AS total FROM pp_calibration_alerts WHERE resolved_at IS NULL`,
  );
  return Number(row?.["total"] ?? 0);
}

export async function resolveCalibrationAlert(id: string): Promise<void> {
  await withWrite((db) => {
    db.run(
      `UPDATE pp_calibration_alerts SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL`,
      params(nowIso(), id),
    );
  });
}

function rowToAgentProposal(row: Record<string, unknown>): AgentProposal {
  return {
    id: String(row["id"]),
    created_at: String(row["created_at"]),
    applied_at: str(row["applied_at"]),
    status: (str(row["status"]) as ProposalStatus) ?? "proposed",
    agent_id: String(row["agent_id"]),
    skill_type: str(row["skill_type"]),
    kind: String(row["kind"]),
    target: parseJsonColumn(row["target_json"], { skill: "" }),
    before: str(row["before"]),
    after: String(row["after"] ?? ""),
    rationale: str(row["rationale"]),
  };
}

export async function insertAgentProposal(
  input: Omit<AgentProposal, "id" | "created_at" | "applied_at" | "status">,
): Promise<AgentProposal> {
  const proposal: AgentProposal = {
    ...input,
    id: uuid(),
    created_at: nowIso(),
    applied_at: null,
    status: "proposed",
  };
  await withWrite((db) => {
    db.run(
      `INSERT INTO pp_agent_proposals (
         id, created_at, applied_at, status, agent_id, skill_type, kind,
         target_json, before, after, rationale
       ) VALUES (?, ?, NULL, 'proposed', ?, ?, ?, ?, ?, ?, ?)`,
      params(
        proposal.id,
        proposal.created_at,
        proposal.agent_id,
        proposal.skill_type,
        proposal.kind,
        JSON.stringify(proposal.target),
        proposal.before,
        proposal.after,
        proposal.rationale,
      ),
    );
  });
  return proposal;
}

export async function listAgentProposals(status?: ProposalStatus): Promise<AgentProposal[]> {
  const db = await getDb();
  const where = status ? "WHERE status = ?" : "";
  const bind = status ? params(status) : [];
  return queryAll(
    db,
    `SELECT * FROM pp_agent_proposals ${where} ORDER BY created_at DESC`,
    bind,
  ).map(rowToAgentProposal);
}

export async function getAgentProposal(id: string): Promise<AgentProposal | null> {
  const db = await getDb();
  const row = queryOne(db, `SELECT * FROM pp_agent_proposals WHERE id = ?`, params(id));
  return row ? rowToAgentProposal(row) : null;
}

export async function setAgentProposalStatus(id: string, status: ProposalStatus): Promise<void> {
  await withWrite((db) => {
    db.run(
      `UPDATE pp_agent_proposals SET status = ?, applied_at = ? WHERE id = ?`,
      params(status, status === "applied" ? nowIso() : null, id),
    );
  });
}

/** Latest applied prompt edit per skill, for the prompt composer. */
export async function listAppliedPromptOverrides(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = queryAll(
    db,
    `SELECT skill_type, after, applied_at FROM pp_agent_proposals
      WHERE status = 'applied' AND kind = 'prompt_edit' AND skill_type IS NOT NULL
      ORDER BY applied_at ASC`,
  );
  const overrides: Record<string, string> = {};
  for (const row of rows) {
    const skill = str(row["skill_type"]);
    if (skill) overrides[skill] = String(row["after"] ?? "");
  }
  return overrides;
}
