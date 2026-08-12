-- ═══════════════════════════════════════════════════════════════════════════
-- ФАЗА 1 — фундамент мультитенантности. БЕЗОПАСНО ДЛЯ ЖИВОГО БОТА.
--
-- Только аддитивные изменения: новые таблицы, новые колонки, бэкфилл.
-- Ни один существующий запрос приложения не сломается — работающий бот
-- продолжит работать ровно как сейчас.
--
-- Что НЕ делается в этой фазе (см. MIGRATION-02): смена первичных ключей,
-- NOT NULL на bot_id, RLS-политики изоляции. Это ломающие изменения, их
-- нельзя применять до того, как код научится проставлять bot_id.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Бот Анастасии — единственный существующий арендатор. Все текущие данные
-- принадлежат ему.
DO $$
DECLARE existing_bot UUID;
BEGIN
  SELECT id INTO existing_bot FROM public.bots ORDER BY created_at LIMIT 1;
  IF existing_bot IS NULL THEN
    RAISE EXCEPTION 'В таблице bots нет ни одной записи — миграция прервана';
  END IF;
  PERFORM set_config('migration.bot_id', existing_bot::text, true);
END $$;

-- ─── 1. bot_id там, где его ещё нет ────────────────────────────────────────
-- DEFAULT намеренно временный: пока в базе один арендатор, он гарантирует,
-- что новые строки живого бота остаются привязанными. В ФАЗЕ 2, когда код
-- начнёт проставлять bot_id явно, DEFAULT снимается (иначе он замаскирует
-- ошибку и чужие данные молча припишутся Анастасии).

ALTER TABLE public.bot_users            ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES public.bots(id) ON DELETE CASCADE;
ALTER TABLE public.cart_items           ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES public.bots(id) ON DELETE CASCADE;
ALTER TABLE public.product_images       ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES public.bots(id) ON DELETE CASCADE;
ALTER TABLE public.broadcast_recipients ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES public.bots(id) ON DELETE CASCADE;
ALTER TABLE public.zernio_logs          ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES public.bots(id) ON DELETE CASCADE;
ALTER TABLE public.zernio_automations   ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES public.bots(id) ON DELETE CASCADE;
ALTER TABLE public.ig_watched_posts     ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES public.bots(id) ON DELETE CASCADE;
ALTER TABLE public.ig_keywords          ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES public.bots(id) ON DELETE CASCADE;
ALTER TABLE public.ig_exclusions        ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES public.bots(id) ON DELETE CASCADE;
ALTER TABLE public.ig_comment_actions   ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES public.bots(id) ON DELETE CASCADE;
ALTER TABLE public.ig_post_leads        ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES public.bots(id) ON DELETE CASCADE;

-- Бэкфилл + временный DEFAULT для всех таблиц с bot_id
DO $$
DECLARE
  b UUID := current_setting('migration.bot_id')::uuid;
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bot_users','cart_items','product_images','broadcast_recipients',
    'zernio_logs','zernio_automations','ig_watched_posts','ig_keywords',
    'ig_exclusions','ig_comment_actions','ig_post_leads',
    'products','categories','orders','order_items','app_settings',
    'payment_methods','broadcasts','ig_poll_runs'
  ] LOOP
    EXECUTE format('UPDATE public.%I SET bot_id = %L WHERE bot_id IS NULL', t, b);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN bot_id SET DEFAULT %L', t, b);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_bot_id ON public.%I(bot_id)', t, t);
  END LOOP;
END $$;

-- ─── 2. Колонки, которые есть у переносимых клиентов, но нет здесь ─────────

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS file_url    TEXT,
  ADD COLUMN IF NOT EXISTS file_url_kz TEXT;

ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS qr_code_path TEXT;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS file_url_snapshot          TEXT,
  ADD COLUMN IF NOT EXISTS file_url_kz_snapshot       TEXT,
  ADD COLUMN IF NOT EXISTS material_files_snapshot    JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS material_files_kz_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ─── 3. Таблицы, которых нет в целевой базе ───────────────────────────────
-- Уникальность сразу составная (bot_id, ...): эти таблицы пока пустые,
-- поэтому правильные ключи можно заложить без ломающей миграции потом.

CREATE TABLE IF NOT EXISTS public.blocked_users (
  bot_id      UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL,
  username    TEXT,
  first_name  TEXT,
  reason      TEXT,
  blocked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, telegram_id)
);

CREATE TABLE IF NOT EXISTS public.vip_tariffs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id       UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price        NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'KZT',
  duration_days INT NOT NULL DEFAULT 30,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vip_subscriptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id             UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  telegram_id        BIGINT NOT NULL,
  username           TEXT,
  first_name         TEXT,
  last_name          TEXT,
  tariff_id          UUID REFERENCES public.vip_tariffs(id) ON DELETE RESTRICT,
  status             TEXT NOT NULL DEFAULT 'pending_payment',
  payment_proof_path TEXT,
  group_invite_link  TEXT,
  started_at         TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ NOT NULL,
  imported           BOOLEAN NOT NULL DEFAULT false,
  admin_note         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vip_status_check CHECK (status IN ('pending_payment','active','expired','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_vip_subs_bot_tg   ON public.vip_subscriptions(bot_id, telegram_id);
CREATE INDEX IF NOT EXISTS idx_vip_subs_expires  ON public.vip_subscriptions(bot_id, expires_at);

CREATE TABLE IF NOT EXISTS public.vip_member_profiles (
  bot_id             UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  telegram_id        BIGINT NOT NULL,
  username           TEXT,
  first_name         TEXT,
  last_name          TEXT,
  assigned_tariff_id UUID REFERENCES public.vip_tariffs(id) ON DELETE SET NULL,
  assigned_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_source    TEXT NOT NULL DEFAULT 'deep_link'
    CHECK (assigned_source IN ('deep_link','payment','admin')),
  PRIMARY KEY (bot_id, telegram_id)
);

-- Материал товара как набор файлов/фото (а не один файл на язык)
CREATE TABLE IF NOT EXISTS public.product_material_files (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id     UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  language   TEXT NOT NULL DEFAULT 'ru' CHECK (language IN ('ru','kz')),
  file_path  TEXT NOT NULL,
  file_name  TEXT,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pmf_product ON public.product_material_files(product_id, language, sort_order);

-- ─── 4. RLS + доступ для service_role на новых таблицах ───────────────────

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'blocked_users','vip_tariffs','vip_subscriptions',
    'vip_member_profiles','product_material_files'
  ] LOOP
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service Role All %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "Service Role All %s" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t, t);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── Проверка после применения ────────────────────────────────────────────
-- Строк с незаполненным bot_id быть не должно (ожидается 0 во всех строках):
--
-- SELECT 'products' t, count(*) FROM products WHERE bot_id IS NULL
-- UNION ALL SELECT 'orders',      count(*) FROM orders      WHERE bot_id IS NULL
-- UNION ALL SELECT 'bot_users',   count(*) FROM bot_users   WHERE bot_id IS NULL
-- UNION ALL SELECT 'cart_items',  count(*) FROM cart_items  WHERE bot_id IS NULL
-- UNION ALL SELECT 'app_settings',count(*) FROM app_settings WHERE bot_id IS NULL;
