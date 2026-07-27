-- Fix IG comments pipeline + poll observability

ALTER TABLE public.ig_keywords
  ADD COLUMN IF NOT EXISTS post_shortcode TEXT;

COMMENT ON COLUMN public.ig_keywords.post_id IS 'Unipile provider_id for comments API (not display id)';

CREATE TABLE IF NOT EXISTS public.ig_poll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ok',
  rules_count INT NOT NULL DEFAULT 0,
  posts_polled INT NOT NULL DEFAULT 0,
  comments_scanned INT NOT NULL DEFAULT 0,
  matched INT NOT NULL DEFAULT 0,
  sent INT NOT NULL DEFAULT 0,
  skipped INT NOT NULL DEFAULT 0,
  errors TEXT,
  note TEXT
);
GRANT ALL ON public.ig_poll_runs TO service_role;
ALTER TABLE public.ig_poll_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service Role All ig_poll_runs" ON public.ig_poll_runs;
CREATE POLICY "Service Role All ig_poll_runs"
ON public.ig_poll_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.app_settings (key, value) VALUES
  ('ig_log_all_comments', 'false')
ON CONFLICT (key) DO NOTHING;
