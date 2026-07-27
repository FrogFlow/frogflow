-- Per-post rules: keyword + reply bound to a specific Unipile post_id
ALTER TABLE public.ig_keywords
  ADD COLUMN IF NOT EXISTS post_id TEXT,
  ADD COLUMN IF NOT EXISTS post_note TEXT;

CREATE INDEX IF NOT EXISTS ig_keywords_post_id_idx ON public.ig_keywords (post_id);

COMMENT ON COLUMN public.ig_keywords.post_id IS 'Unipile post_id this keyword applies to (required for matching)';
