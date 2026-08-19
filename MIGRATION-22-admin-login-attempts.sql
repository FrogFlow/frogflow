-- ═══════════════════════════════════════════════════════════════════════════
-- admin_login_attempts — попытки входа в админку магазина конкретного
-- арендатора.
--
-- Тот же класс проблемы, что MIGRATION-13 закрыла для панели оператора:
-- вход в /admin/* был защищён одним сравнением ADMIN_USERNAME/ADMIN_PASSWORD
-- без задержки, без блокировки и без следа. Код уже умеет писать сюда
-- (src/lib/admin-login-guard.server.ts) и деградирует до простой задержки +
-- timing-safe сравнения, пока эта миграция не применена — включать можно в
-- любой момент, без риска для уже работающего входа.
--
-- В отличие от operator_login_attempts (общая для всех клиентов, видна
-- только service_role), эта таблица per-tenant: bot_id NOT NULL, обычная
-- политика tenant_isolation из MIGRATION-02 — деплой клиента видит и пишет
-- только свои попытки под SUPABASE_TENANT_KEY.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  bot_id  UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  ip      TEXT,
  ok      BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_bot_at
  ON public.admin_login_attempts(bot_id, at DESC);

ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.admin_login_attempts
  FOR ALL
  USING      (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'admin_login_attempts';
--   -- ожидается: t
--
--   SELECT count(*) FROM pg_policies WHERE tablename = 'admin_login_attempts';
--   -- ожидается: 1 (tenant_isolation)
-- ═══════════════════════════════════════════════════════════════════════════
