-- Кейс 3, Задача 7 — подарочные сертификаты.
--
-- Сертификат выдаёт продавец вручную через админку (оплата вне бота — bank
-- transfer, наличные, жест лояльности) и отдаёт код покупателю; тот вводит
-- код при оформлении как скидку на фиксированную сумму — тем же путём, что
-- и промокод (MIGRATION-40), включая CAS на редемпшене.

BEGIN;

CREATE TABLE IF NOT EXISTS public.gift_certificates (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id                 UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  code                   TEXT NOT NULL,
  amount                 NUMERIC NOT NULL CHECK (amount > 0),
  currency               TEXT NOT NULL DEFAULT 'KZT',
  note                   TEXT,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'cancelled')),
  redeemed_by_telegram_id BIGINT,
  redeemed_order_id      BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_at            TIMESTAMPTZ,
  UNIQUE (bot_id, code)
);

ALTER TABLE public.gift_certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.gift_certificates;
CREATE POLICY tenant_isolation ON public.gift_certificates
  FOR ALL TO tenant_bot
  USING      (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

DROP TRIGGER IF EXISTS trg_force_bot_id ON public.gift_certificates;
CREATE TRIGGER trg_force_bot_id
  BEFORE INSERT ON public.gift_certificates
  FOR EACH ROW EXECUTE FUNCTION public.force_bot_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gift_certificates TO tenant_bot;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS gift_certificate_code     TEXT,
  ADD COLUMN IF NOT EXISTS gift_certificate_discount NUMERIC NOT NULL DEFAULT 0;

COMMIT;

NOTIFY pgrst, 'reload schema';
