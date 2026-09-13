-- ═══════════════════════════════════════════════════════════════════════════
-- BOVI consultant production runtime.
--
-- Durable message ledger replaces text/time-only deduplication. Every
-- webhook and Inbox poll attempt converges on (bot_id, message_id), while the
-- same rows retain the AI/tool/validator/send trace needed by the BOVI admin
-- panel. Handoffs are first-class work items instead of a JSON array in
-- app_settings. Catalog imports are append-only operational history.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.consultant_message_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id                UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  message_id            TEXT NOT NULL,
  event_id              TEXT,
  platform_message_id   TEXT,
  conversation_id       TEXT NOT NULL,
  account_id            TEXT,
  user_key              TEXT NOT NULL,
  direction             TEXT NOT NULL DEFAULT 'incoming'
                          CHECK (direction IN ('incoming', 'outgoing')),
  source                TEXT NOT NULL DEFAULT 'webhook'
                          CHECK (source IN ('webhook', 'poll', 'admin_test')),
  status                TEXT NOT NULL DEFAULT 'received'
                          CHECK (status IN (
                            'received', 'processing', 'replied',
                            'retryable_failed', 'terminal_failed', 'cancelled'
                          )),
  incoming_text         TEXT,
  reply_text            TEXT,
  reply_kind            TEXT,
  reply_fingerprint     TEXT,
  outbound_message_id   TEXT,
  model                 TEXT,
  prompt_version        TEXT,
  catalog_version       TEXT,
  rate_value            NUMERIC,
  rate_updated_at       TIMESTAMPTZ,
  rate_source           TEXT,
  tool_trace            JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_usage           JSONB NOT NULL DEFAULT '{}'::jsonb,
  validator_result      JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code            TEXT,
  error_message         TEXT,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at            TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  next_retry_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consultant_message_runs_message_key UNIQUE (bot_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_consultant_runs_status_retry
  ON public.consultant_message_runs(bot_id, status, next_retry_at, received_at);
CREATE INDEX IF NOT EXISTS idx_consultant_runs_conversation
  ON public.consultant_message_runs(bot_id, conversation_id, received_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_consultant_runs_outbound_message
  ON public.consultant_message_runs(bot_id, outbound_message_id)
  WHERE outbound_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.consultant_handoffs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  run_id          UUID REFERENCES public.consultant_message_runs(id) ON DELETE SET NULL,
  user_key        TEXT NOT NULL,
  conversation_id TEXT,
  reason          TEXT NOT NULL
                    CHECK (reason IN (
                      'purchase', 'out_of_stock', 'manager_request',
                      'unsupported_country', 'ai_error', 'catalog_error',
                      'validation_error', 'other'
                    )),
  customer_text   TEXT,
  product_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'done')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  CONSTRAINT consultant_handoffs_run_key UNIQUE (bot_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_consultant_handoffs_open
  ON public.consultant_handoffs(bot_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultant_handoffs_user
  ON public.consultant_handoffs(bot_id, user_key, created_at DESC);

CREATE TABLE IF NOT EXISTS public.consultant_catalog_imports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id        UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  version       TEXT NOT NULL,
  source        TEXT NOT NULL,
  source_url    TEXT,
  status        TEXT NOT NULL
                  CHECK (status IN ('published', 'failed')),
  product_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  errors        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consultant_catalog_imports_version_key UNIQUE (bot_id, version)
);

CREATE INDEX IF NOT EXISTS idx_consultant_catalog_imports_recent
  ON public.consultant_catalog_imports(bot_id, created_at DESC);

GRANT ALL ON public.consultant_message_runs TO service_role;
GRANT ALL ON public.consultant_handoffs TO service_role;
GRANT ALL ON public.consultant_catalog_imports TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_message_runs TO tenant_bot;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_handoffs TO tenant_bot;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_catalog_imports TO tenant_bot;

ALTER TABLE public.consultant_message_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultant_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultant_catalog_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.consultant_message_runs;
CREATE POLICY tenant_isolation ON public.consultant_message_runs
  FOR ALL TO tenant_bot
  USING (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

DROP POLICY IF EXISTS tenant_isolation ON public.consultant_handoffs;
CREATE POLICY tenant_isolation ON public.consultant_handoffs
  FOR ALL TO tenant_bot
  USING (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

DROP POLICY IF EXISTS tenant_isolation ON public.consultant_catalog_imports;
CREATE POLICY tenant_isolation ON public.consultant_catalog_imports
  FOR ALL TO tenant_bot
  USING (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

DROP TRIGGER IF EXISTS trg_force_bot_id ON public.consultant_message_runs;
CREATE TRIGGER trg_force_bot_id
  BEFORE INSERT ON public.consultant_message_runs
  FOR EACH ROW EXECUTE FUNCTION public.force_bot_id();

DROP TRIGGER IF EXISTS trg_force_bot_id ON public.consultant_handoffs;
CREATE TRIGGER trg_force_bot_id
  BEFORE INSERT ON public.consultant_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.force_bot_id();

DROP TRIGGER IF EXISTS trg_force_bot_id ON public.consultant_catalog_imports;
CREATE TRIGGER trg_force_bot_id
  BEFORE INSERT ON public.consultant_catalog_imports
  FOR EACH ROW EXECUTE FUNCTION public.force_bot_id();

DROP TRIGGER IF EXISTS trg_consultant_runs_touch ON public.consultant_message_runs;
CREATE TRIGGER trg_consultant_runs_touch
  BEFORE UPDATE ON public.consultant_message_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- Проверка
--
-- SELECT status, count(*) FROM consultant_message_runs GROUP BY status;
-- SELECT status, count(*) FROM consultant_handoffs GROUP BY status;
-- SELECT * FROM consultant_catalog_imports ORDER BY created_at DESC LIMIT 5;
-- ═══════════════════════════════════════════════════════════════════════════
