-- Canonical Instagram / Unipile identifiers for comments, leads and posts

ALTER TABLE public.ig_post_leads
  ADD COLUMN IF NOT EXISTS dm_recipient_id TEXT,
  ADD COLUMN IF NOT EXISTS author_profile_id TEXT,
  ADD COLUMN IF NOT EXISTS unipile_comment_id TEXT;

ALTER TABLE public.ig_keywords
  ADD COLUMN IF NOT EXISTS comments_post_id TEXT;

ALTER TABLE public.ig_watched_posts
  ADD COLUMN IF NOT EXISTS comments_post_id TEXT,
  ADD COLUMN IF NOT EXISTS post_display_id TEXT,
  ADD COLUMN IF NOT EXISTS post_shortcode TEXT;

ALTER TABLE public.ig_comment_actions
  ADD COLUMN IF NOT EXISTS debug_info JSONB;

CREATE INDEX IF NOT EXISTS ig_post_leads_dm_recipient_idx
  ON public.ig_post_leads (dm_recipient_id)
  WHERE dm_recipient_id IS NOT NULL;
