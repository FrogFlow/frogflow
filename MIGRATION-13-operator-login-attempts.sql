-- ═══════════════════════════════════════════════════════════════════════════
-- operator_login_attempts — попытки входа в панель оператора.
--
-- Панель это мастер-ключ: кто вошёл, тот выпускает ключи арендаторов всех
-- клиентов, переставляет вебхуки и пишет владельцам. При этом вход защищён
-- одной строкой OPERATOR_PASSWORD, без задержки, без блокировки и без следа:
-- подобрать пароль можно было молча и сколько угодно раз.
--
-- Отдельная таблица, а не bot_events: там bot_id NOT NULL, а неудачный вход
-- не относится ни к какому клиенту.
--
-- RLS включается без единой политики — как bot_events и operator_broadcasts
-- (MIGRATION-08 §8): читать и писать может только service_role, то есть сама
-- панель. Деплой клиента под ключом арендатора не видит эту таблицу вовсе.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.operator_login_attempts (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  username TEXT NOT NULL,
  -- Источник запроса. Может быть пустым: за прокси заголовка может не быть,
  -- и это не повод не записать саму попытку.
  ip       TEXT,
  ok       BOOLEAN NOT NULL
);

-- Счёт неудач за последние минуты — единственный горячий запрос к таблице.
CREATE INDEX IF NOT EXISTS idx_operator_login_attempts_at ON public.operator_login_attempts(at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_login_attempts_ip_at
  ON public.operator_login_attempts(ip, at DESC);

ALTER TABLE public.operator_login_attempts ENABLE ROW LEVEL SECURITY;

-- Явно отбираем права у ролей, которым MIGRATION-02 выдал их через
-- ALTER DEFAULT PRIVILEGES на все будущие таблицы.
REVOKE ALL ON public.operator_login_attempts FROM anon, authenticated, tenant_bot;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'operator_login_attempts';
--   -- ожидается: t
--
--   SELECT count(*) FROM pg_policies WHERE tablename = 'operator_login_attempts';
--   -- ожидается: 0 — таблица закрыта для всех, кроме service_role
--
--   SELECT at, username, ip, ok FROM public.operator_login_attempts
--    ORDER BY at DESC LIMIT 20;
-- ═══════════════════════════════════════════════════════════════════════════
