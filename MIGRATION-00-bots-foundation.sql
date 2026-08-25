-- ═══════════════════════════════════════════════════════════════════════════
-- DDL для `bots` — воссоздано задним числом (Блок 6.1, кейс 2).
--
-- `bots` не заведена ни одной миграцией в этом репозитории: MIGRATION-01 уже
-- читает из неё и вешает на неё внешние ключи, MIGRATION-08/15 добавляют ей
-- колонки через ALTER TABLE ... ADD COLUMN IF NOT EXISTS — то есть таблица
-- была создана вручную до того, как здесь появилась первая миграция, и её
-- начальная форма нигде не записана. Итог: если базу нужно поднять с нуля
-- (восстановление после потери, копия для тестового стенда), применение
-- миграций по порядку падает на первом же обращении к несуществующей `bots`.
--
-- Этот файл — не расшифровка какого-то забытого CREATE TABLE, а реконструкция
-- ФИНАЛЬНОЙ формы таблицы (как она выглядит сегодня, после MIGRATION-08 и
-- MIGRATION-15) по трём источникам:
--   1. src/integrations-supabase/types.ts — сгенерирован интроспекцией живой
--      базы (scripts/sync-db-types.mjs), это источник правды по набору
--      колонок, их nullability и JSON-типам.
--   2. MIGRATION-08-operator-foundations.sql и MIGRATION-15-status-and-archive.sql
--      — оттуда взяты CHECK на status, DEFAULT на settings, типы новых колонок
--      панели (app_url, internal_secret, owner_*, paused_message, notes,
--      archived_at).
--   3. Комментарии в src/lib/operator/*.server.ts — owner_id это человеко-
--      читаемый слаг (TEXT, без DB-уникальности — см. onboard.server.ts, там
--      уникальность проверяется в коде, а не констрейнтом).
--
-- Не проверено против реальной живой схемы (`\d bots` в psql) — сделать это
-- перед тем, как полагаться на этот файл для настоящего аварийного
-- восстановления. Каждый CREATE/ADD — IF NOT EXISTS, поэтому применение
-- этого файла к уже существующей `bots` ничего не меняет и безопасно.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_name                TEXT NOT NULL,
  -- Человекочитаемый идентификатор клиента ("saltanat"), используется в
  -- служебных именах и ссылках панели. Уникальность держит код (см.
  -- onboard.server.ts), не DB-констрейнт.
  owner_id                TEXT NOT NULL,
  bot_token               TEXT,
  status                  TEXT NOT NULL DEFAULT 'active',
  modules                 JSONB DEFAULT '{}'::jsonb,
  settings                JSONB DEFAULT '{"on_overdue": "warn", "warn_days_before": 5, "grace_days": 3}'::jsonb,
  subscription_plan       TEXT,
  subscription_expires_at TIMESTAMPTZ,
  -- Панель управления клиентами (MIGRATION-08, CONTROL-PLANE-PLAN.md §0).
  app_url                 TEXT,
  internal_secret         TEXT,
  owner_telegram_id       BIGINT,
  owner_name              TEXT,
  owner_contact           TEXT,
  paused_message          TEXT,
  notes                   TEXT,
  -- Архив клиента (MIGRATION-15) — отдельно от status: одно описывает
  -- поведение бота сейчас, другое — ушёл ли клиент вовсе.
  archived_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.bots DROP CONSTRAINT IF EXISTS bots_status_check;
ALTER TABLE public.bots ADD CONSTRAINT bots_status_check
  CHECK (status IN ('active', 'paused', 'suspended'));

CREATE INDEX IF NOT EXISTS idx_bots_archived_at ON public.bots(archived_at);

COMMENT ON COLUMN public.bots.app_url IS
  'Адрес клиентского деплоя — для ссылок в панели и вызовов /api/internal/*';
COMMENT ON COLUMN public.bots.internal_secret IS
  'Секрет заголовка x-internal-secret для /api/internal/notify-owner и /api/internal/reload';
COMMENT ON COLUMN public.bots.owner_telegram_id IS
  'chat_id владельца — куда клиентский деплой шлёт сообщения от панели';
COMMENT ON COLUMN public.bots.paused_message IS
  'Текст, которым бот отвечает, пока status <> active';
COMMENT ON COLUMN public.bots.archived_at IS
  'Когда клиент убран из работы. Строка и его данные остаются: заказы, выгрузки и история платежей должны переживать уход клиента.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
-- На живой базе (таблица уже существует) — должно не измениться ничего:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'bots'
--   ORDER BY ordinal_position;
--   -- сравнить со списком колонок в src/integrations-supabase/types.ts
--
-- На свежей базе (аварийное восстановление) — применять ДО MIGRATION-01,
-- затем MIGRATION-01 → 33 по порядку, и завести хотя бы одну строку в bots
-- до MIGRATION-01 (она проверяет, что таблица не пуста).
-- ═══════════════════════════════════════════════════════════════════════════
