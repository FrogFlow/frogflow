-- ═══════════════════════════════════════════════════════════════════════════
-- ФАЗА 6 — подключение did_02 и razvivashka.
--
-- Выполнять ЦЕЛИКОМ и ДО запуска скриптов переноса данных.
-- Порядок внутри файла важен: сначала снимаем страховочный DEFAULT, потом
-- дополняем схему, потом заводим арендаторов.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Снять временный DEFAULT с bot_id ──────────────────────────────────
--
-- В Фазе 1 на все таблицы был поставлен DEFAULT с bot_id Анастасии, чтобы
-- старый код (ещё не знавший про арендаторов) продолжал работать. Сейчас все
-- деплои проставляют bot_id сами, а DEFAULT превратился в ловушку: деплой с
-- забытой переменной BOT_ID не упадёт с ошибкой, а молча запишет товары и
-- заказы нового клиента в данные Анастасии.
--
-- После снятия такая вставка вернёт NOT NULL violation — то есть громкую
-- ошибку вместо тихого перемешивания клиентов.

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bot_users','cart_items','product_images','broadcast_recipients',
    'zernio_logs','zernio_automations','ig_watched_posts','ig_keywords',
    'ig_exclusions','ig_comment_actions','ig_post_leads',
    'products','categories','orders','order_items','app_settings',
    'payment_methods','broadcasts','ig_poll_runs'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN bot_id DROP DEFAULT', t);
  END LOOP;
END $$;

-- ─── 2. Колонки, которые есть у новых клиентов, но нет здесь ──────────────
--
-- Схема VIP-модуля у did_02 и razvivashka ушла вперёд относительно той, что
-- была заведена в Фазе 1. Без этих колонок перенос отбросит часть данных.

ALTER TABLE public.vip_tariffs
  ADD COLUMN IF NOT EXISTS duration_minutes INT,
  ADD COLUMN IF NOT EXISTS is_entry         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_public        BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.vip_member_profiles
  ADD COLUMN IF NOT EXISTS admin_label   TEXT,
  ADD COLUMN IF NOT EXISTS legacy_locked BOOLEAN NOT NULL DEFAULT false;

-- razvivashka пишет сюда данные диалога из Instagram (zernio-bot.server.ts),
-- поэтому колонка нужна, даже если сейчас во всех строках пусто.
ALTER TABLE public.bot_users
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ─── 3. Новые арендаторы ──────────────────────────────────────────────────
--
-- bot_token не используется кодом (бот берёт токен из переменной окружения),
-- поэтому здесь заглушка. Но на колонке висит UNIQUE, так что одинаковую
-- заглушку двум ботам поставить нельзя — делаем её разной по имени клиента.
-- modules отражают то, чем клиент реально пользуется: у обоих активен
-- VIP-доступ, у razvivashka вдобавок Instagram.

INSERT INTO public.bots (id, bot_token, bot_name, owner_id, status, modules, subscription_plan)
VALUES
  ('19ce949b-8877-4fa7-b072-c09980eb7ee3', 'pending:did_02', 'DID 02', 'did_02', 'active',
   '{"shop": true, "vip": true, "instagram": false, "broadcasts": true, "multi_currency": true}'::jsonb, 'pro'),
  ('d6331748-52e2-4b88-af41-ccd545f789a8', 'pending:razvivashka', 'Развивашка', 'razvivashka', 'active',
   '{"shop": true, "vip": true, "instagram": true, "broadcasts": true, "multi_currency": true}'::jsonb, 'pro')
ON CONFLICT (id) DO NOTHING;

-- ─── 4. Счётчики заказов ──────────────────────────────────────────────────
--
-- did_02: покупатели уже видели номера с 16 по 27 (заказы 1–15 были удалены).
-- Ставим счётчик на 27, а сами перенесённые заказы получат order_no, равный
-- прежнему id — иначе история в админке разойдётся с тем, что человек видел
-- в переписке с ботом.
--
-- razvivashka: заказов нет вообще, начинаем с нуля — первый будет №1.

INSERT INTO public.order_counters (bot_id, last_no) VALUES
  ('19ce949b-8877-4fa7-b072-c09980eb7ee3', 27),
  ('d6331748-52e2-4b88-af41-ccd545f789a8', 0)
ON CONFLICT (bot_id) DO UPDATE SET last_no = EXCLUDED.last_no;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
--   SELECT id, owner_id, bot_name FROM public.bots ORDER BY created_at;
--   SELECT * FROM public.order_counters;
--
--   -- DEFAULT должен исчезнуть (ожидается пусто):
--   SELECT table_name, column_default
--   FROM information_schema.columns
--   WHERE column_name = 'bot_id' AND table_schema = 'public'
--     AND column_default IS NOT NULL;
-- ═══════════════════════════════════════════════════════════════════════════
