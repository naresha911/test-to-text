/** Normalized page reading. Reader-specific payloads stay behind the adapter. */

export const READER_BLOCK_TYPES = ["text", "formula", "figure", "table", "unknown"] as const;

export type ReaderBlockType = (typeof READER_BLOCK_TYPES)[number];

export type ReaderBlock = {
  id: string;
  type: ReaderBlockType;
  text?: string | null;
  latex?: string | null;
  /** [x, y, width, height] normalised to the page, 0..1. */
  bbox?: [number, number, number, number] | null;
  confidence?: number | null;
};

export type RawReaderResult = {
  reader_id: string;
  reader_version: string;
  page_width?: number | null;
  page_height?: number | null;
  blocks: ReaderBlock[];
  created_at: string;
  /** JPEG of this page, present when the upload is over the plain-text OCR size limit. */
  page_jpeg_base64?: string | null;
  jpeg_width?: number | null;
  jpeg_height?: number | null;
};

export type SourcePageInput = {
  imageDataUrl: string;
  page: number;
  hint?: string | null;
};

export type SourceReader = {
  id: string;
  readPage(input: SourcePageInput): Promise<RawReaderResult>;
};
