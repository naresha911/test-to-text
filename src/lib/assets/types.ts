export const ASSET_ROLES = [
  "page",
  "source_figure",
  "question_figure",
  "option_figure",
  "answer_figure",
] as const;

export type AssetRole = (typeof ASSET_ROLES)[number];

export type AssetKind = "source" | "generated";

export type AssetGenerationMethod = "cropped" | "svg" | "canvas" | "image_model" | "uploaded";

export type AssetRef = {
  asset_id: string;
  kind: AssetKind;
  role: AssetRole;
  mime_type: string;
  storage_key: string;
  width: number | null;
  height: number | null;
  size_bytes: number;
  checksum: string;
  generation_method: AssetGenerationMethod | null;
  source_asset_id: string | null;
  spec_version: string | null;
};

export type AssetWrite = {
  asset_id: string;
  kind: AssetKind;
  role: AssetRole;
  mime_type: string;
  bytes: Uint8Array;
  document_id: string;
  question_id?: string | null;
  width?: number | null;
  height?: number | null;
  generation_method?: AssetGenerationMethod | null;
  source_asset_id?: string | null;
  spec_version?: string | null;
};

export interface AssetStore {
  put(input: AssetWrite): Promise<AssetRef>;
  get(assetId: string): Promise<AssetRef | null>;
}
