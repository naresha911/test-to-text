import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AssetRef, AssetStore, AssetWrite } from "@/lib/assets/types";

type Manifest = Record<string, AssetRef>;

async function checksumOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function extensionFor(mime: string): string {
  if (mime === "image/svg+xml") return ".svg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return ".jpg";
}

function storageKey(input: AssetWrite): string {
  const ext = extensionFor(input.mime_type);
  if (input.kind === "generated") {
    if (!input.question_id) throw new Error("A generated asset needs a question id.");
    return `${input.document_id}/generated/${input.question_id}/${input.asset_id}${ext}`;
  }
  return `${input.document_id}/source/${input.asset_id}${ext}`;
}

function toRef(input: AssetWrite, key: string, checksum: string): AssetRef {
  return {
    asset_id: input.asset_id,
    kind: input.kind,
    role: input.role,
    mime_type: input.mime_type,
    storage_key: key,
    width: input.width ?? null,
    height: input.height ?? null,
    size_bytes: input.bytes.byteLength,
    checksum,
    generation_method: input.generation_method ?? null,
    source_asset_id: input.source_asset_id ?? null,
    spec_version: input.spec_version ?? null,
  };
}

export function createMemoryAssetStore(): AssetStore & { snapshot(): AssetRef[] } {
  const records = new Map<string, { ref: AssetRef; bytes: Uint8Array }>();
  return {
    snapshot: () => [...records.values()].map((entry) => entry.ref),
    async get(assetId) {
      return records.get(assetId)?.ref ?? null;
    },
    async put(input) {
      const checksum = await checksumOf(input.bytes);
      const existing = records.get(input.asset_id);
      if (existing?.ref.kind === "source" && input.kind === "generated") {
        throw new Error("Generated writes cannot overwrite a source asset.");
      }
      if (existing && existing.ref.checksum === checksum && existing.ref.kind === input.kind) {
        return existing.ref;
      }
      const key = existing?.ref.kind === input.kind ? existing.ref.storage_key : storageKey(input);
      if (input.kind === "generated" && key.includes("/source/")) {
        throw new Error("Generated assets cannot use a source path.");
      }
      const ref = toRef(input, key, checksum);
      records.set(input.asset_id, { ref, bytes: input.bytes });
      return ref;
    },
  };
}

async function readManifest(file: string): Promise<Manifest> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Manifest;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function createFileAssetStore(root: string): AssetStore {
  return {
    async get(assetId) {
      const manifest = await readManifest(path.join(root, "_manifest.json"));
      return manifest[assetId] ?? null;
    },
    async put(input) {
      const checksum = await checksumOf(input.bytes);
      const manifestPath = path.join(root, "_manifest.json");
      const manifest = await readManifest(manifestPath);
      const existing = manifest[input.asset_id];
      if (existing?.kind === "source" && input.kind === "generated") {
        throw new Error("Generated writes cannot overwrite a source asset.");
      }
      if (existing && existing.checksum === checksum && existing.kind === input.kind) {
        return existing;
      }
      const key = storageKey(input);
      if (input.kind === "generated" && !key.includes("/generated/")) {
        throw new Error("Generated assets must stay under the generated path.");
      }
      const absolute = path.join(root, ...key.split("/"));
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, input.bytes);
      const ref = toRef(input, key, checksum);
      manifest[input.asset_id] = ref;
      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, JSON.stringify(manifest));
      return ref;
    },
  };
}

export function createLocalImageAssetStore(): AssetStore {
  return createFileAssetStore(path.resolve(process.cwd(), "data", "images"));
}
