-- ═══════════════════════════════════════════════════════════════════════════
-- Воронка продаж FrogFlow: очередь касаний, дожимы, журнал событий по лиду.
-- Таблица sales_leads (MIGRATION-63) остаётся источником карточки; здесь —
-- то, без чего крон и кнопка «Прогнать воронку» не знают, кому писать сегодня
-- и что уже пробовали.
--
-- Автоматизация: поиск → оценка → qualify/reject по порогу → черновик →
-- next_action. WhatsApp/Instagram с сервера не шлём (спам). Проигрыш по
-- тишине после max follow-up — да, чтобы очередь не гнила.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS next_action TEXT,
  ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_touch_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outreach_channel TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_draft TEXT,
  ADD COLUMN IF NOT EXISTS auto_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lost_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_leads_next_action_at
  ON public.sales_leads(next_action_at)
  WHERE next_action_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sales_lead_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID NOT NULL REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor      TEXT NOT NULL DEFAULT 'pipeline',
  kind       TEXT NOT NULL,
  detail     TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_lead_events_lead
  ON public.sales_lead_events(lead_id, created_at DESC);

GRANT ALL ON public.sales_lead_events TO service_role;
ALTER TABLE public.sales_lead_events ENABLE ROW LEVEL SECURITY;

-- Уже лежащие «новые» сразу попадают в очередь «сегодня», иначе крон
-- проигнорирует пачку до первой ручной смены стадии.
UPDATE public.sales_leads
SET next_action = 'Оценить и квалифицировать',
    next_action_at = COALESCE(next_action_at, now())
WHERE stage = 'new' AND next_action IS NULL;

UPDATE public.sales_leads
SET next_action = 'Написать первое сообщение',
    next_action_at = COALESCE(next_action_at, now())
WHERE stage = 'qualified' AND next_action IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- Проверка
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'sales_leads' AND column_name LIKE 'next_action%';
--   SELECT count(*) FROM sales_lead_events;  -- 0 на старте
-- ═══════════════════════════════════════════════════════════════════════════
