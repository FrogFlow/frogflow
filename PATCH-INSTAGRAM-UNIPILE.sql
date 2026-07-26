-- Instagram / Unipile: keyword comments → DM

CREATE TABLE IF NOT EXISTS public.ig_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL,
  reply_text TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.ig_keywords TO service_role;
ALTER TABLE public.ig_keywords ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service Role All ig_keywords" ON public.ig_keywords;
CREATE POLICY "Service Role All ig_keywords"
ON public.ig_keywords FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ig_watched_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id TEXT NOT NULL UNIQUE,
  caption_snapshot TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.ig_watched_posts TO service_role;
ALTER TABLE public.ig_watched_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service Role All ig_watched_posts" ON public.ig_watched_posts;
CREATE POLICY "Service Role All ig_watched_posts"
ON public.ig_watched_posts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ig_exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id TEXT,
  username TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.ig_exclusions TO service_role;
ALTER TABLE public.ig_exclusions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service Role All ig_exclusions" ON public.ig_exclusions;
CREATE POLICY "Service Role All ig_exclusions"
ON public.ig_exclusions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS ig_exclusions_provider_user_id_uidx
  ON public.ig_exclusions (provider_user_id)
  WHERE provider_user_id IS NOT NULL AND provider_user_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS ig_exclusions_username_uidx
  ON public.ig_exclusions (lower(username))
  WHERE username IS NOT NULL AND username <> '';

CREATE TABLE IF NOT EXISTS public.ig_comment_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  provider_user_id TEXT,
  username TEXT,
  keyword_id UUID REFERENCES public.ig_keywords(id) ON DELETE SET NULL,
  comment_text TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, comment_id)
);
GRANT ALL ON public.ig_comment_actions TO service_role;
ALTER TABLE public.ig_comment_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service Role All ig_comment_actions" ON public.ig_comment_actions;
CREATE POLICY "Service Role All ig_comment_actions"
ON public.ig_comment_actions FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.app_settings (key, value) VALUES
  ('unipile_account_id', ''),
  ('unipile_account_name', ''),
  ('unipile_account_status', ''),
  ('ig_dm_enabled', 'false'),
  ('ig_default_reply', 'Спасибо за интерес! Напишите нам, чем можем помочь.')
ON CONFLICT (key) DO NOTHING;
