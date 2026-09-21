/**
 * Document store backed by Lovable Cloud (Postgres + private image bucket).
 * Runs inside server functions only; the admin client is imported lazily so
 * this module stays safe to reference from *.functions.ts files.
 */
import type { Catalog, DocumentKind, DocumentMeta, PageRecord } from "@/lib/document-types";
import type { Question } from "@/lib/question-schema";

const BUCKET = "paper-images";
const SIGNED_URL_TTL = 60 * 60 * 8;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}

function num(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function str(value: unknown): string | null {
  return value == null ? null : String(value);
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
    section_timing: row["section_timing"] === true,
    negative_marking: row["negative_marking"] !== false,
    allow_pause: row["allow_pause"] !== false,
    max_attempts: num(row["max_attempts"]) ?? 1,
    default_marks: num(row["default_marks"]),
    default_negative_marks: num(row["default_negative_marks"]),
    created_at: String(row["created_at"]),
    updated_at: String(row["updated_at"]),
  };
}

function toQuestions(value: unknown): Question[] {
  return Array.isArray(value) ? (value as Question[]) : [];
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

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const [head, payload] = dataUrl.includes(",") ? dataUrl.split(",") : ["", dataUrl];
  const contentType = /data:([^;]+)/.exec(head ?? "")?.[1] ?? "image/jpeg";
  const binary = atob(payload ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}

async function signPath(path: string): Promise<string | undefined> {
  const db = await admin();
  const { data } = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl;
}

export async function listDocuments(): Promise<
  Array<DocumentMeta & { question_count: number; page_count: number }>
> {
  const db = await admin();
  const { data, error } = await db
    .from("pp_documents")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) fail("Could not list documents", error);
  const rows = (data ?? []) as Record<string, unknown>[];
  const counts = new Map<string, number>();
  if (rows.length) {
    const { data: pageRows } = await db
      .from("pp_pages")
      .select("document_id")
      .in("document_id", rows.map((r) => String(r["id"])));
    for (const p of (pageRows ?? []) as Record<string, unknown>[]) {
      const key = String(p["document_id"]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
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
  const db = await admin();
  const { data: row } = await db.from("pp_documents").select("*").eq("id", id).maybeSingle();
  if (!row) return null;
  const { data: pageRows } = await db
    .from("pp_pages")
    .select("*")
    .eq("document_id", id)
    .order("page_index", { ascending: true });

  const pages: PageRecord[] = [];
  for (const raw of (pageRows ?? []) as Record<string, unknown>[]) {
    const page = rowToPage(raw);
    const url = await signPath(page.file_path);
    pages.push(url ? { ...page, dataUrl: url } : page);
  }

  const figureUrls: Record<string, string> = {};
  const { data: objects } = await db.storage.from(BUCKET).list(id, { limit: 1000 });
  for (const obj of objects ?? []) {
    if (!obj.name.includes("fig-")) continue;
    const path = `${id}/${obj.name}`;
    const url = await signPath(path);
    if (url) figureUrls[path] = url;
  }

  return {
    document: rowToMeta(row as Record<string, unknown>),
    questions: toQuestions((row as Record<string, unknown>)["questions"]),
    pages,
    figureUrls,
  };
}

export type DocumentPatch = Partial<Omit<DocumentMeta, "id" | "created_at" | "updated_at">> & {
  questions?: Question[];
};

export async function createDocument(kind: DocumentKind, title?: string): Promise<DocumentMeta> {
  const db = await admin();
  const { data, error } = await db
    .from("pp_documents")
    .insert({ kind, title: title?.trim() || "Untitled" })
    .select("*")
    .single();
  if (error || !data) fail("Could not create the document", error);
  return rowToMeta(data as Record<string, unknown>);
}

export async function updateDocument(
  id: string,
  patch: DocumentPatch,
): Promise<DocumentMeta | null> {
  const db = await admin();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    update[key === "questions" ? "questions" : key] = value;
  }
  const { data, error } = await db
    .from("pp_documents")
    .update(update)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) fail("Could not save the document", error);
  return data ? rowToMeta(data as Record<string, unknown>) : null;
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await admin();
  const { data: objects } = await db.storage.from(BUCKET).list(id, { limit: 1000 });
  const paths = (objects ?? []).map((o) => `${id}/${o.name}`);
  if (paths.length) await db.storage.from(BUCKET).remove(paths);
  const { error } = await db.from("pp_documents").delete().eq("id", id);
  if (error) fail("Could not delete the document", error);
}

async function uploadImage(path: string, dataUrl: string): Promise<void> {
  const db = await admin();
  const { bytes, contentType } = dataUrlToBytes(dataUrl);
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) fail("Could not store the page image", error);
}

export async function appendPage(input: {
  documentId: string;
  dataUrl: string;
  originalName: string;
}): Promise<PageRecord> {
  const db = await admin();
  const { count } = await db
    .from("pp_pages")
    .select("id", { count: "exact", head: true })
    .eq("document_id", input.documentId);
  const page_index = count ?? 0;
  const file_path = `${input.documentId}/page-${page_index + 1}.jpg`;
  await uploadImage(file_path, input.dataUrl);
  const { data, error } = await db
    .from("pp_pages")
    .insert({
      document_id: input.documentId,
      page_index,
      file_path,
      original_name: input.originalName,
      ocr_status: "pending",
    })
    .select("*")
    .single();
  if (error || !data) fail("Could not add the page", error);
  await db
    .from("pp_documents")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", input.documentId);
  return { ...rowToPage(data as Record<string, unknown>), dataUrl: input.dataUrl };
}

export async function saveFigure(input: {
  documentId: string;
  dataUrl: string;
  filename: string;
}): Promise<string> {
  const path = `${input.documentId}/${input.filename}`;
  await uploadImage(path, input.dataUrl);
  return path;
}

export async function removePage(pageId: string): Promise<void> {
  const db = await admin();
  const { data: row } = await db.from("pp_pages").select("*").eq("id", pageId).maybeSingle();
  if (!row) return;
  const page = rowToPage(row as Record<string, unknown>);
  await db.storage.from(BUCKET).remove([page.file_path]);
  await db.from("pp_pages").delete().eq("id", pageId);
  const { data: remaining } = await db
    .from("pp_pages")
    .select("id")
    .eq("document_id", page.document_id)
    .order("page_index", { ascending: true });
  let index = 0;
  for (const p of (remaining ?? []) as Record<string, unknown>[]) {
    await db.from("pp_pages").update({ page_index: index }).eq("id", String(p["id"]));
    index += 1;
  }
  await db
    .from("pp_documents")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", page.document_id);
}

export async function markPageOcr(pageId: string, status: string): Promise<void> {
  const db = await admin();
  await db.from("pp_pages").update({ ocr_status: status }).eq("id", pageId);
}

export async function getCatalog(): Promise<Catalog> {
  const db = await admin();
  const [standards, subjects, topics, streams] = await Promise.all([
    db.from("pp_catalog_standards").select("*").order("display_order", { ascending: true }),
    db.from("pp_catalog_subjects").select("*").order("name", { ascending: true }),
    db.from("pp_catalog_topics").select("*").order("name", { ascending: true }),
    db.from("pp_catalog_streams").select("*").order("name", { ascending: true }),
  ]);
  const rows = (result: { data: unknown }) => (result.data ?? []) as Record<string, unknown>[];
  return {
    standards: rows(standards).map((r) => ({
      id: Number(r["id"]),
      name: String(r["name"]),
      display_order: num(r["display_order"]),
    })),
    subjects: rows(subjects).map((r) => ({
      id: Number(r["id"]),
      name: String(r["name"]),
      code: str(r["code"]),
    })),
    topics: rows(topics).map((r) => ({
      id: Number(r["id"]),
      subject_id: num(r["subject_id"]),
      name: String(r["name"]),
      parent_topic_id: num(r["parent_topic_id"]),
    })),
    streams: rows(streams).map((r) => ({
      id: Number(r["id"]),
      name: String(r["name"]),
      standard_id: num(r["standard_id"]),
    })),
  };
}

export async function importCatalogDump(raw: unknown): Promise<Catalog> {
  const db = await admin();
  const obj = (raw ?? {}) as Record<string, unknown>;
  const arr = (...keys: string[]) => {
    for (const key of keys) {
      const value = obj[key];
      if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
    return [] as Record<string, unknown>[];
  };

  await db.from("pp_catalog_streams").delete().gte("id", -2147483648);
  await db.from("pp_catalog_topics").delete().gte("id", -2147483648);
  await db.from("pp_catalog_subjects").delete().gte("id", -2147483648);
  await db.from("pp_catalog_standards").delete().gte("id", -2147483648);

  const standards = arr("standards", "catalog_standards")
    .filter((r) => r["id"] != null && r["name"])
    .map((r) => ({
      id: Number(r["id"]),
      name: String(r["name"]),
      display_order: num(r["display_order"]),
    }));
  const subjects = arr("subjects", "catalog_subjects")
    .filter((r) => r["id"] != null && r["name"])
    .map((r) => ({ id: Number(r["id"]), name: String(r["name"]), code: str(r["code"]) }));
  const topics = arr("topics", "catalog_topics")
    .filter((r) => r["id"] != null && r["name"])
    .map((r) => ({
      id: Number(r["id"]),
      subject_id: num(r["subject_id"]),
      name: String(r["name"]),
      parent_topic_id: num(r["parent_topic_id"]),
    }));
  const streams = arr("streams", "catalog_streams")
    .filter((r) => r["id"] != null && r["name"])
    .map((r) => ({ id: Number(r["id"]), name: String(r["name"]), standard_id: num(r["standard_id"]) }));

  if (standards.length) await db.from("pp_catalog_standards").insert(standards);
  if (subjects.length) await db.from("pp_catalog_subjects").insert(subjects);
  if (topics.length) await db.from("pp_catalog_topics").insert(topics);
  if (streams.length) await db.from("pp_catalog_streams").insert(streams);

  return getCatalog();
}
