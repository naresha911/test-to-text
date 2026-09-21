CREATE TABLE public.pp_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL DEFAULT 'past_paper',
  title TEXT NOT NULL DEFAULT 'Untitled',
  year INTEGER,
  standard_id INTEGER,
  stream_id INTEGER,
  subject_id INTEGER,
  duration_minutes INTEGER,
  total_marks NUMERIC,
  difficulty TEXT,
  exam TEXT,
  notes TEXT,
  source TEXT,
  description TEXT,
  section_timing BOOLEAN NOT NULL DEFAULT false,
  negative_marking BOOLEAN NOT NULL DEFAULT true,
  allow_pause BOOLEAN NOT NULL DEFAULT true,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  default_marks NUMERIC,
  default_negative_marks NUMERIC,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.pp_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.pp_documents(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  ocr_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pp_pages_document_idx ON public.pp_pages(document_id, page_index);

CREATE TABLE public.pp_catalog_standards (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  display_order INTEGER
);
CREATE TABLE public.pp_catalog_subjects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT
);
CREATE TABLE public.pp_catalog_topics (
  id INTEGER PRIMARY KEY,
  subject_id INTEGER,
  name TEXT NOT NULL,
  parent_topic_id INTEGER
);
CREATE TABLE public.pp_catalog_streams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  standard_id INTEGER
);

GRANT ALL ON public.pp_documents TO service_role;
GRANT ALL ON public.pp_pages TO service_role;
GRANT ALL ON public.pp_catalog_standards TO service_role;
GRANT ALL ON public.pp_catalog_subjects TO service_role;
GRANT ALL ON public.pp_catalog_topics TO service_role;
GRANT ALL ON public.pp_catalog_streams TO service_role;

ALTER TABLE public.pp_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_catalog_standards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_catalog_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_catalog_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_catalog_streams ENABLE ROW LEVEL SECURITY;