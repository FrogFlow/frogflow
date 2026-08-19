-- ═══════════════════════════════════════════════════════════════════════════
-- module_requests — заявки клиента «Заказать подключение» из новой вкладки
-- «Модули» в его собственной админ-панели (/admin/modules). Витрина
-- показывает готовые (status: "available" в src/lib/modules/registry.ts)
-- модули, которых у клиента ещё нет; кнопка одновременно (а) пишет сюда
-- строку и (б) открывает Telegram-ссылку на оператора — так решил оператор
-- явно, вместо любого одного из двух вариантов.
--
-- Тот же класс таблицы, что admin_login_attempts (MIGRATION-22): per-tenant,
-- bot_id NOT NULL, обычная tenant_isolation политика. Деплой клиента пишет и
-- читает только свои заявки под SUPABASE_TENANT_KEY; панель оператора видит
-- все — service_role уже проходит мимо RLS без отдельной политики, тем же
-- образом, каким уже читает admin_login_attempts.
--
-- Частичный уникальный индекс не даёт наплодить дубликаты одной и той же
-- необработанной заявки повторными кликами по кнопке.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.module_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id       UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  module_key   TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_module_requests_bot_at
  ON public.module_requests(bot_id, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_module_requests_pending
  ON public.module_requests(bot_id, module_key)
  WHERE status = 'pending';

ALTER TABLE public.module_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.module_requests
  FOR ALL
  USING      (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'module_requests';
--   -- ожидается: t
--
--   SELECT count(*) FROM pg_policies WHERE tablename = 'module_requests';
--   -- ожидается: 1 (tenant_isolation)
-- ═══════════════════════════════════════════════════════════════════════════
