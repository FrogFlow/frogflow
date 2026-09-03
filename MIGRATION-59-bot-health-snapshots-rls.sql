-- ═══════════════════════════════════════════════════════════════════════════
-- bot_health_snapshots (MIGRATION-48) — единственная таблица платформы,
-- заведённая после MIGRATION-02 без ENABLE ROW LEVEL SECURITY и хотя бы одной
-- политики. MIGRATION-02 выдаёт tenant_bot ALTER DEFAULT PRIVILEGES на ВСЕ
-- будущие таблицы (GRANT SELECT, INSERT, UPDATE, DELETE), и без RLS эти
-- гранты действуют без единого ограничения: любой клиентский деплой мог
-- прочитать историю падений всех клиентов платформы разом (косвенно —
-- список bot_id, кто и как долго лежал), а также подделать или стереть её
-- (DELETE/UPDATE), хотя единственный источник вкладки "История падений" и
-- блока "Деплой" в панели оператора — именно эта таблица.
--
-- И чтение, и запись в проекте идут только из src/lib/operator/** (крон
-- health-snapshot-cron.server.ts и bots.server.ts) — оба работают под
-- service_role панели оператора (без SUPABASE_TENANT_KEY), ни один клиентский
-- деплой сюда напрямую не пишет и не читает. Поэтому закрываем таблицу
-- начисто, тем же приёмом, что и subscription_payments/operator_settings:
-- RLS без единой политики.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT ALL ON public.bot_health_snapshots TO service_role;
ALTER TABLE public.bot_health_snapshots ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
-- tenant_bot больше не видит таблицу вовсе:
--   SET LOCAL ROLE tenant_bot;
--   SET LOCAL request.jwt.claims = '{"role":"tenant_bot","bot_id":"<любой uuid>"}';
--   SELECT count(*) FROM bot_health_snapshots;   -- 0
--   DELETE FROM bot_health_snapshots;              -- 0 строк затронуто
--   RESET ROLE;
--
-- Панель оператора (без SUPABASE_TENANT_KEY) продолжает читать/писать без
-- ограничений, как и раньше — вкладка "История падений" и блок "Деплой"
-- работают без изменений.
-- ═══════════════════════════════════════════════════════════════════════════
