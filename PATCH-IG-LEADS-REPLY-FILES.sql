-- Instagram follow-up automation: comment replies, DM file, lead-state queue

ALTER TABLE public.ig_keywords
  ADD COLUMN IF NOT EXISTS comment_reply_text TEXT,
  ADD COLUMN IF NOT EXISTS dm_file_path TEXT,
  ADD COLUMN IF NOT EXISTS dm_file_name TEXT,
  ADD COLUMN IF NOT EXISTS dm_file_kind TEXT;

ALTER TABLE public.ig_comment_actions
  ADD COLUMN IF NOT EXISTS lead_id UUID,
  ADD COLUMN IF NOT EXISTS attempt_no INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.ig_post_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id TEXT NOT NULL,
  keyword_id UUID REFERENCES public.ig_keywords(id) ON DELETE SET NULL,
  provider_user_id TEXT NOT NULL,
  username TEXT,
  first_comment_id TEXT,
  last_comment_id TEXT,
  last_comment_text TEXT,
  comment_replied_at TIMESTAMPTZ,
  dm_status TEXT NOT NULL DEFAULT 'new',
  dm_attempts INT NOT NULL DEFAULT 0,
  first_dm_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  retry_until_at TIMESTAMPTZ,
  dm_sent_at TIMESTAMPTZ,
  closed_reason TEXT,
  last_error TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, provider_user_id)
);

GRANT ALL ON public.ig_post_leads TO service_role;
ALTER TABLE public.ig_post_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service Role All ig_post_leads" ON public.ig_post_leads;
CREATE POLICY "Service Role All ig_post_leads"
ON public.ig_post_leads FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ig_comment_actions_lead_id_fkey'
  ) THEN
    ALTER TABLE public.ig_comment_actions
      ADD CONSTRAINT ig_comment_actions_lead_id_fkey
      FOREIGN KEY (lead_id) REFERENCES public.ig_post_leads(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ig_post_leads_post_id_idx
  ON public.ig_post_leads (post_id);

CREATE INDEX IF NOT EXISTS ig_post_leads_status_retry_idx
  ON public.ig_post_leads (dm_status, next_retry_at);

CREATE INDEX IF NOT EXISTS ig_comment_actions_lead_id_idx
  ON public.ig_comment_actions (lead_id);
