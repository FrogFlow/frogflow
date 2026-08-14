-- ═══════════════════════════════════════════════════════════════════════════
-- ФАЗА 6 (control-plane) — подписки и платежи.
--
-- Прайс делает ежемесячную подписку обязательной для всех продуктов, значит
-- нужен ответ на вопрос «кто оплачен до какого числа». Отсюда же берётся
-- автоматическое предупреждение и перевод в suspended при просрочке —
-- поведение настраивается в bots.settings (CONTROL-PLANE-PLAN.md §10),
-- поле заведено ещё в Фазе 0.
--
-- Применять после MIGRATION-08. Кода не ломает: до появления платежей
-- subscription_expires_at остаётся тем, чем был.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Платежи по подписке ────────────────────────────────────────────────
-- Одна строка — один оплаченный период. Источник истины про «оплачен до»
-- именно здесь, а bots.subscription_expires_at — производная (см. п.2).
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id       UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  amount       NUMERIC(12,2) NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'KZT',
  paid_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscription_payments_period_order CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_bot_id
  ON public.subscription_payments(bot_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_period_end
  ON public.subscription_payments(bot_id, period_end DESC);

-- ─── 2. «Оплачен до» пересчитывается сам ──────────────────────────────────
-- Двух источников истины быть не должно. Триггер, а не код панели: платежи
-- за прошлые месяцы удобнее заводить пачкой прямо в SQL, и забыть обновить
-- дату вручную — вопрос времени.
CREATE OR REPLACE FUNCTION public.sync_subscription_expiry() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target UUID := COALESCE(NEW.bot_id, OLD.bot_id);
BEGIN
  UPDATE public.bots b
  SET subscription_expires_at = (
    SELECT MAX(period_end)::timestamp
    FROM public.subscription_payments p
    WHERE p.bot_id = target
  )
  WHERE b.id = target;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_sync_subscription_expiry ON public.subscription_payments;
CREATE TRIGGER trg_sync_subscription_expiry
  AFTER INSERT OR UPDATE OR DELETE ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_subscription_expiry();

-- ─── 3. RLS — закрыто для арендатора ──────────────────────────────────────
-- Как и bot_events/operator_broadcasts: включённый RLS без единой политики
-- закрывает таблицу для любой роли без BYPASSRLS. Клиент не должен видеть
-- ни своих платежей, ни тем более чужих.
GRANT ALL ON public.subscription_payments TO service_role;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
-- 1. Триггер пересчитывает дату:
--      INSERT INTO subscription_payments (bot_id, period_start, period_end, amount)
--      VALUES ('<uuid>', '2026-08-01', '2026-09-01', 15000);
--      SELECT subscription_expires_at FROM bots WHERE id = '<uuid>';  -- 2026-09-01
--
-- 2. Удаление платежа откатывает дату к предыдущему периоду (или в NULL).
--
-- 3. tenant_bot таблицу не видит:
--      SET LOCAL ROLE tenant_bot;
--      SET LOCAL request.jwt.claims = '{"role":"tenant_bot","bot_id":"<uuid>"}';
--      SELECT count(*) FROM subscription_payments;   -- 0
--      RESET ROLE;
-- ═══════════════════════════════════════════════════════════════════════════
