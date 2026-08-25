-- Кейс 3, Задача 1 — промокоды и скидки на заказ.
--
-- Скидка на весь заказ (не на отдельные позиции — см. commit message):
-- процент или фиксированная сумма, необязательный лимит использований и
-- срок действия. used_count растёт через CAS-обновление в момент
-- оформления заказа (redeemPromoCode в bot.server.ts), тем же приёмом, что
-- и delivery_index в orders.server.ts — конкурентное исчерпание лимита не
-- даёт продать больше использований, чем разрешено.

BEGIN;

CREATE TABLE IF NOT EXISTS public.promo_codes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id         UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC NOT NULL CHECK (discount_value > 0),
  -- NULL = без ограничения по количеству использований.
  max_uses       INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  used_count     INTEGER NOT NULL DEFAULT 0,
  -- NULL = без ограничения по сроку.
  valid_until    TIMESTAMPTZ,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Код хранится в верхнем регистре (savePromoCode приводит перед вставкой) —
  -- сравнение при вводе покупателем тоже идёт по upper(), без учёта регистра.
  UNIQUE (bot_id, code)
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_bot_id ON public.promo_codes(bot_id);

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.promo_codes;
CREATE POLICY tenant_isolation ON public.promo_codes
  FOR ALL TO tenant_bot
  USING      (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

DROP TRIGGER IF EXISTS trg_force_bot_id ON public.promo_codes;
CREATE TRIGGER trg_force_bot_id
  BEFORE INSERT ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.force_bot_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.promo_codes TO tenant_bot;

-- Снимок применённой скидки на заказе — итог уже посчитан с её учётом
-- (orders.total), эти два поля только для истории/чека.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS promo_code TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC NOT NULL DEFAULT 0;

COMMIT;

NOTIFY pgrst, 'reload schema';
