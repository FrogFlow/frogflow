-- ═══════════════════════════════════════════════════════════════════════════
-- ФАЗА 0 (control-panel) — предохранители перед панелью управления.
--
-- Только это применяет код: НИЧЕГО. Это чистая миграция схемы + данных,
-- см. CONTROL-PLANE-PLAN.md §7–8. Порядок обязателен: без неё Фаза 1
-- (чтение bots.modules во время выполнения вместо сборочных VITE_FEATURE_*)
-- молча выключит модули у живых клиентов, чьи ключи в bots.modules сегодня
-- не совпадают с каноническим набором.
--
-- Что делает:
--   1. Нормализует bots.modules — единый набор ключей из реестра модулей
--      (src/lib/modules/registry.ts, ещё не существует — заводится в Фазе 1).
--   2. Зануляет bots.bot_token — там живёт настоящий рабочий токен Анастасии.
--   3. Добавляет колонки под панель (app_url, internal_secret, owner_*,
--      paused_message, notes), расширяет status до active|paused|suspended,
--      проставляет дефолт bots.settings под политику неоплаты (§10 плана).
--   4. Заводит bot_events и operator_broadcasts, закрытые от tenant_bot.
--
-- Применять вручную через Supabase SQL Editor (project fnwksbasxakktscdjlfp).
-- В репозитории нет скрипта, исполняющего DDL: SUPABASE_SERVICE_ROLE_KEY —
-- это ключ PostgREST (Data API), а не пароль от Postgres, DDL через него не
-- выполнить. Так же применялись MIGRATION-01…07.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Нормализация bots.modules ──────────────────────────────────────────
--
-- Канонический набор — 13 ключей будущего реестра (§3 плана): shop, vip,
-- blocked, instagram, dm_shop, broadcasts, multi_currency, robokassa,
-- receipt_ocr, legal_docs, courses, coupons, referral.
--
-- Значения определены не по коду (после слияния он у всех пятерых
-- одинаковый) и не по статичной таблице из §8 плана (она сама помечена как
-- устаревшая), а по двум источникам, в порядке приоритета:
--   а) что реально стоит в bots.modules сегодня (2026-08-13) — самый свежий
--      факт, для did_02/razvivashka он новее самого плана;
--   б) для ключей, которых в текущей строке нет вообще, — какой код изначально
--      был в собственном репозитории клиента до слияния (CONSOLIDATION-PLAN.md
--      §2 «Модули по репозиториям»), чтобы не погасить работающую в проде
--      функцию. Это касается: robokassa/receipt_ocr/legal_docs/dm_shop —
--      были только в репозитории Анастасии (линия A), blocked — был в паре с
--      vip у Дидактики/Развивашки (линия B, тот же набор из 12 файлов).
--
-- Это реконструкция, не решение оператора. Перед тем как полагаться на неё
-- в биллинге — свериться с прайсом и с самими клиентами (§8 п.1 плана прямо
-- требует сверки с владельцем, не только с фактами из кода/базы).

UPDATE public.bots SET modules = '{
  "shop": true,
  "vip": false,
  "blocked": false,
  "instagram": true,
  "dm_shop": true,
  "broadcasts": true,
  "multi_currency": true,
  "robokassa": true,
  "receipt_ocr": true,
  "legal_docs": true,
  "courses": true,
  "coupons": false,
  "referral": false
}'::jsonb
WHERE id = '0bac1f86-5231-4e57-838d-2faa44d427e7'; -- Анастасия

UPDATE public.bots SET modules = '{
  "shop": true,
  "vip": false,
  "blocked": false,
  "instagram": false,
  "dm_shop": false,
  "broadcasts": false,
  "multi_currency": true,
  "robokassa": false,
  "receipt_ocr": false,
  "legal_docs": false,
  "courses": false,
  "coupons": false,
  "referral": false
}'::jsonb
WHERE id = 'de44b934-c8db-47ac-9aa9-535c762cf8c7'; -- Салтанат

UPDATE public.bots SET modules = '{
  "shop": true,
  "vip": false,
  "blocked": false,
  "instagram": false,
  "dm_shop": false,
  "broadcasts": false,
  "multi_currency": true,
  "robokassa": false,
  "receipt_ocr": false,
  "legal_docs": false,
  "courses": false,
  "coupons": false,
  "referral": false
}'::jsonb
WHERE id = '89d155d1-91e1-4c2d-981e-43741a0badc3'; -- Print KZ

UPDATE public.bots SET modules = '{
  "shop": true,
  "vip": true,
  "blocked": true,
  "instagram": false,
  "dm_shop": false,
  "broadcasts": true,
  "multi_currency": true,
  "robokassa": false,
  "receipt_ocr": false,
  "legal_docs": false,
  "courses": false,
  "coupons": false,
  "referral": false
}'::jsonb
WHERE id = '19ce949b-8877-4fa7-b072-c09980eb7ee3'; -- Дидактика

UPDATE public.bots SET modules = '{
  "shop": true,
  "vip": true,
  "blocked": true,
  "instagram": true,
  "dm_shop": false,
  "broadcasts": true,
  "multi_currency": true,
  "robokassa": false,
  "receipt_ocr": false,
  "legal_docs": false,
  "courses": false,
  "coupons": false,
  "referral": false
}'::jsonb
WHERE id = 'd6331748-52e2-4b88-af41-ccd545f789a8'; -- Развивашка

-- Предохранитель: если в bots появился шестой клиент между написанием этой
-- миграции и её применением, он остался бы без нормализации молча. Явно
-- проверяем, что затронуты ровно ожидаемые пять строк.
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.bots
  WHERE id IN (
    '0bac1f86-5231-4e57-838d-2faa44d427e7',
    'de44b934-c8db-47ac-9aa9-535c762cf8c7',
    '89d155d1-91e1-4c2d-981e-43741a0badc3',
    '19ce949b-8877-4fa7-b072-c09980eb7ee3',
    'd6331748-52e2-4b88-af41-ccd545f789a8'
  );
  IF cnt <> 5 THEN
    RAISE EXCEPTION 'Ожидалось 5 известных ботов, найдено %. Список bot_id в миграции устарел — проверить public.bots вручную.', cnt;
  END IF;

  SELECT count(*) INTO cnt FROM public.bots;
  IF cnt <> 5 THEN
    RAISE WARNING 'В public.bots всего % строк, а не 5 — есть клиент(ы), не учтённые этой миграцией. bots.modules у них не тронут.', cnt;
  END IF;
END $$;

-- ─── 2. bots.bot_token — зануляем ──────────────────────────────────────────
-- Не читается в коде (проверено), но у Анастасии там живой рабочий токен.
-- Столбец не удаляем (может пригодиться история/аудит), только освобождаем
-- от NOT NULL и очищаем.
ALTER TABLE public.bots ALTER COLUMN bot_token DROP NOT NULL;
UPDATE public.bots SET bot_token = NULL WHERE bot_token IS NOT NULL;

-- ─── 3. Новые колонки под панель ────────────────────────────────────────────
ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS app_url            TEXT,
  ADD COLUMN IF NOT EXISTS internal_secret    TEXT,
  ADD COLUMN IF NOT EXISTS owner_telegram_id  BIGINT,
  ADD COLUMN IF NOT EXISTS owner_name         TEXT,
  ADD COLUMN IF NOT EXISTS owner_contact      TEXT,
  ADD COLUMN IF NOT EXISTS paused_message     TEXT,
  ADD COLUMN IF NOT EXISTS notes              TEXT;

-- internal_secret — секрет для POST /api/internal/* клиентского деплоя (§5).
-- 64 hex-символа из двух gen_random_uuid(): не требует pgcrypto, случайности
-- 2×122 бита достаточно для внутреннего shared-secret.
UPDATE public.bots
SET internal_secret = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE internal_secret IS NULL;

-- app_url заполняется вручную после миграции — адреса деплоев знает оператор,
-- угадывать их нельзя (см. CONTROL-PLANE-PLAN.md §8 п.4):
--   UPDATE public.bots SET app_url = 'https://…' WHERE id = '…';

COMMENT ON COLUMN public.bots.app_url           IS 'Адрес клиентского деплоя — для ссылок в панели и вызовов /api/internal/*';
COMMENT ON COLUMN public.bots.internal_secret   IS 'Секрет заголовка x-internal-secret для /api/internal/notify-owner и /api/internal/reload';
COMMENT ON COLUMN public.bots.owner_telegram_id IS 'chat_id владельца — куда клиентский деплой шлёт сообщения от панели';
COMMENT ON COLUMN public.bots.paused_message    IS 'Текст, которым бот отвечает, пока status <> active';

-- ─── 4. status: active | paused | suspended ────────────────────────────────
ALTER TABLE public.bots ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE public.bots DROP CONSTRAINT IF EXISTS bots_status_check;
ALTER TABLE public.bots ADD CONSTRAINT bots_status_check
  CHECK (status IN ('active', 'paused', 'suspended'));

-- ─── 5. settings — дефолт политики при неоплате (§10 плана) ───────────────
-- Поле заводится в Фазе 0, чтобы не трогать схему в Фазе 6, когда появятся
-- подписки/платежи. Значение по умолчанию — мягкое предупреждение.
ALTER TABLE public.bots ALTER COLUMN settings
  SET DEFAULT '{"on_overdue": "warn", "warn_days_before": 5, "grace_days": 3}'::jsonb;

UPDATE public.bots
SET settings = '{"on_overdue": "warn", "warn_days_before": 5, "grace_days": 3}'::jsonb
WHERE settings IS NULL OR settings = '{}'::jsonb;

-- ─── 6. bot_events — журнал действий оператора ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.bot_events (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id  UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor   TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('module_on', 'module_off', 'pause', 'resume', 'onboard', 'message')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_bot_events_bot_id ON public.bot_events(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_events_at     ON public.bot_events(at DESC);

-- ─── 7. operator_broadcasts — рассылки владельцам и их доставка ───────────
-- Одна рассылка может идти нескольким/всем клиентам — по одному HTTP-запросу
-- на деплой (§6 плана), поэтому статус доставки хранится как массив в results,
-- а не отдельной строкой на получателя.
CREATE TABLE IF NOT EXISTS public.operator_broadcasts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor        TEXT NOT NULL,
  message_text TEXT NOT NULL,
  target       TEXT NOT NULL, -- 'all' | 'selected'
  results      JSONB NOT NULL DEFAULT '[]'::jsonb -- [{bot_id, status: 'sent'|'failed'|'unreachable', error?, at}]
);
CREATE INDEX IF NOT EXISTS idx_operator_broadcasts_created_at ON public.operator_broadcasts(created_at DESC);

-- ─── 8. RLS — полностью закрыть для tenant_bot ─────────────────────────────
-- MIGRATION-02 выдал tenant_bot ALTER DEFAULT PRIVILEGES на все будущие
-- таблицы (SELECT/INSERT/UPDATE/DELETE) — эти две новые таблицы такие права
-- уже унаследовали. Включённый RLS без единой политики отменяет это для
-- любой роли без BYPASSRLS: ни строки не видно, ни вставить нельзя. У
-- service_role (панель, крон, сервер) BYPASSRLS есть — доступ не ограничен,
-- но GRANT добавлен явно, тем же стилем, что и в существующих таблицах
-- (broadcasts, broadcast_recipients — supabase/migrations/20260718120000).
GRANT ALL ON public.bot_events          TO service_role;
GRANT ALL ON public.operator_broadcasts TO service_role;
ALTER TABLE public.bot_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_broadcasts ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА (после применения)
--
-- 1. Токен точно вычищен:
--      SELECT id, bot_token FROM public.bots;               -- везде NULL
--
-- 2. Модули — канонический набор из 13 ключей у всех пяти, старых мусорных
--    ключей (ai_assistant, crm_integration…) нет:
--      SELECT id, jsonb_object_keys(modules) FROM public.bots ORDER BY 1;
--
-- 3. tenant_bot не видит новые таблицы (403/пусто), даже с валидным bot_id:
--      SET LOCAL ROLE tenant_bot;
--      SET LOCAL request.jwt.claims = '{"role":"tenant_bot","bot_id":"0bac1f86-5231-4e57-838d-2faa44d427e7"}';
--      SELECT count(*) FROM public.bot_events;               -- 0 строк
--      INSERT INTO public.bot_events (bot_id, actor, kind) VALUES
--        ('0bac1f86-5231-4e57-838d-2faa44d427e7', 'test', 'pause');  -- должно упасть
--      RESET ROLE;
--
-- 4. status принимает только три значения:
--      UPDATE public.bots SET status = 'bogus' WHERE id = '0bac1f86-5231-4e57-838d-2faa44d427e7'; -- должно упасть
--
-- 5. internal_secret заполнен у всех пяти и различается:
--      SELECT id, internal_secret FROM public.bots;
--
-- ОСТАЛОСЬ РУКАМИ: app_url для всех пяти (адреса деплоев знает оператор, в
-- репозитории и в плане они не записаны намеренно).
-- ═══════════════════════════════════════════════════════════════════════════
