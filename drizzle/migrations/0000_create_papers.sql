CREATE TABLE public.papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Untitled paper',
  subject text,
  exam text,
  notes text,
  image_paths text[] NOT NULL DEFAULT '{}',
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.papers TO authenticated;
GRANT ALL ON public.papers TO service_role;

ALTER TABLE public.papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own papers" ON public.papers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own papers" ON public.papers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own papers" ON public.papers
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own papers" ON public.papers
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER papers_touch_updated_at
BEFORE UPDATE ON public.papers
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX papers_user_created_idx ON public.papers (user_id, created_at DESC);