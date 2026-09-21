export const DOCUMENT_KINDS = ["past_paper", "practice_test"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export type Catalog = {
  standards: { id: number; name: string; display_order: number | null }[];
  subjects: { id: number; name: string; code: string | null }[];
  topics: { id: number; subject_id: number | null; name: string; parent_topic_id: number | null }[];
  streams: { id: number; name: string; standard_id: number | null }[];
};

export type DocumentMeta = {
  id: string;
  kind: DocumentKind;
  title: string;
  year: number | null;
  standard_id: number | null;
  stream_id: number | null;
  subject_id: number | null;
  duration_minutes: number | null;
  total_marks: number | null;
  difficulty: Difficulty | null;
  exam: string | null;
  notes: string | null;
  source: string | null;
  description: string | null;
  section_timing: boolean;
  negative_marking: boolean;
  allow_pause: boolean;
  max_attempts: number;
  default_marks: number | null;
  default_negative_marks: number | null;
  created_at: string;
  updated_at: string;
};

export type PageRecord = {
  id: string;
  document_id: string;
  page_index: number;
  file_path: string;
  original_name: string;
  ocr_status: string;
  dataUrl?: string;
};
