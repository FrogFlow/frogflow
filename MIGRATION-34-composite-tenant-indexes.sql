-- ═══════════════════════════════════════════════════════════════════════════
-- Составные индексы для самых горячих запросов (Блок 3.4, кейс 2).
--
-- У каждой арендаторской таблицы уже есть одиночный idx_<table>_bot_id
-- (MIGRATION-01), но при 7 арендаторах его селективность ~1/7 — планировщик
-- его чаще игнорирует и уходит в последовательное сканирование. Ниже —
-- составные индексы под конкретные запросы кода, начинающиеся с bot_id, по
-- убыванию ценности:
--
--   1. zernio_logs (bot_id, status, created_at) — главный. Крон повторов
--      (zernio-retry, */2 * * * *, ~5000 запусков в сутки на всех деплоях)
--      ищет свои pending/error строки в таблице на 32 587 строк / 72 МБ,
--      обычно находя ноль.
--   2. orders (bot_id, telegram_id, status, created_at DESC) — приём чека
--      и «мои заказы» покупателя.
--   3. orders (bot_id, status, created_at) — очередь выдачи и счётчики
--      дашборда админки.
--   4. bot_users — pg_trgm/GIN под ILIKE '%q%' в поиске пользователей
--      админки (users-search.functions.ts): без него это полный скан
--      таблицы на каждое нажатие клавиши.
--   5. bot_events (bot_id, at DESC), bot_users (bot_id, platform).
--
-- Только добавляет индексы — ничего не удаляет и не блокирует надолго на
-- нынешних объёмах (десятки тысяч строк). Старые одиночные idx_*_bot_id
-- намеренно не трогаем: они всё ещё дешевле для запросов, которым не нужны
-- остальные колонки составного индекса, и удалять их — отдельное решение.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. zernio-retry: WHERE bot_id = ? AND status IN ('pending','error') ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_zernio_logs_bot_status_created
  ON public.zernio_logs (bot_id, status, created_at);

-- 2. Приём чека и «мои заказы»: WHERE bot_id = ? AND telegram_id = ? [AND status = ?] ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_orders_bot_telegram_status_created
  ON public.orders (bot_id, telegram_id, status, created_at DESC);

-- 3. Очередь выдачи и счётчики дашборда: WHERE bot_id = ? AND status = ? ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_orders_bot_status_created
  ON public.orders (bot_id, status, created_at);

-- 4. Поиск пользователей админки: username/first_name/last_name ILIKE '%q%'.
-- Ведущий '%' исключает обычный B-tree; pg_trgm — единственный способ не
-- сканировать таблицу целиком на каждое нажатие клавиши. RLS (bot_id =
-- current_bot_id()) применяется как фильтр поверх битовой карты — сама
-- по себе таблица bot_users не настолько велика, чтобы точить составной
-- индекс bot_id+trgm ради этого.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_bot_users_username_trgm
  ON public.bot_users USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_bot_users_first_name_trgm
  ON public.bot_users USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_bot_users_last_name_trgm
  ON public.bot_users USING gin (last_name gin_trgm_ops);

-- 5. Мелкие, но дешёвые.
CREATE INDEX IF NOT EXISTS idx_bot_events_bot_at
  ON public.bot_events (bot_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_users_bot_platform
  ON public.bot_users (bot_id, platform);

COMMIT;

-- ─── Проверка ────────────────────────────────────────────────────────────
-- До/после — сравнить план и время:
--   EXPLAIN ANALYZE SELECT * FROM zernio_logs
--     WHERE bot_id = '<bot_id>' AND status IN ('pending','error')
--     ORDER BY created_at LIMIT 50;
--   EXPLAIN ANALYZE SELECT * FROM orders
--     WHERE bot_id = '<bot_id>' AND telegram_id = <id>
--     ORDER BY created_at DESC LIMIT 20;
--   EXPLAIN ANALYZE SELECT telegram_id, username, first_name, last_name
--     FROM bot_users
--     WHERE bot_id = '<bot_id>'
--       AND (username ILIKE '%ан%' OR first_name ILIKE '%ан%' OR last_name ILIKE '%ан%')
--     LIMIT 20;
-- Ожидание: Index Scan / Bitmap Index Scan вместо Seq Scan на всех трёх.
