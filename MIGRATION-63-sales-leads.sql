-- ═══════════════════════════════════════════════════════════════════════════
-- Лиды для собственного отдела продаж FrogFlow (поиск новых клиентов-владельцев
-- ботов), а не данные ни одного клиентского магазина — платформенная таблица,
-- как operator_settings/subscription_invoices (MIGRATION-58): нет bot_id,
-- видна только панели оператора (service_role, без SUPABASE_TENANT_KEY).
--
-- Пайплайн: new (добавлен) → qualified/rejected (после AI-оценки, решение за
-- оператором) → contacted (письмо отправлено) → replied (ответил) →
-- hot (готов к сделке) → converted (стал клиентом) / lost (отвалился).
-- score/score_reason и draft_message — совет от ИИ, не финальное решение:
-- стадию всегда двигает оператор вручную.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.sales_leads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  business_name    TEXT NOT NULL,
  niche            TEXT,
  city             TEXT,
  website_url      TEXT,
  instagram_handle TEXT,
  phone            TEXT,
  email            TEXT,
  -- Свободный текст: что конкретно наблюдали и что намекает на потребность в
  -- боте ("запись только через WhatsApp вручную", "нет онлайн-записи на
  -- сайте", "300+ отзывов, менеджер не успевает отвечать").
  signals          TEXT,
  source           TEXT NOT NULL DEFAULT 'manual',
  stage            TEXT NOT NULL DEFAULT 'new'
                     CHECK (stage IN
                       ('new', 'qualified', 'rejected', 'contacted', 'replied', 'hot', 'converted', 'lost')),
  score            INTEGER CHECK (score BETWEEN 0 AND 100),
  score_reason     TEXT,
  draft_message    TEXT,
  notes            TEXT,
  created_by       TEXT,
  contacted_at     TIMESTAMPTZ,
  replied_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sales_leads_stage ON public.sales_leads(stage);

-- Тот же приём, что и у operator_settings/subscription_payments: RLS без
-- единой политики закрывает таблицу для tenant_bot начисто (даже случайно
-- открытая /admin на деплое панели ничего отсюда не прочитает — там нет
-- SUPABASE_TENANT_KEY вовсе), а панель оператора обходит RLS через
-- service_role и видит/пишет без ограничений обычным supabaseAdmin.
GRANT ALL ON public.sales_leads TO service_role;
ALTER TABLE public.sales_leads ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
-- 1. tenant_bot не видит sales_leads вовсе:
--      SET LOCAL ROLE tenant_bot;
--      SET LOCAL request.jwt.claims = '{"role":"tenant_bot","bot_id":"<uuid>"}';
--      SELECT count(*) FROM sales_leads;   -- 0
--      RESET ROLE;
--
-- 2. Панель оператора (без SUPABASE_TENANT_KEY) видит и пишет без ограничений
--    обычным запросом supabaseAdmin, как и остальные платформенные таблицы.
-- ═══════════════════════════════════════════════════════════════════════════
