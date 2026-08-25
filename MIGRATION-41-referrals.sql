-- Кейс 3, Задача 2 — реферальная программа.
--
-- Ссылка вида t.me/<bot>?start=ref_<telegram_id> — реферальный код это сам
-- telegram_id пригласившего, отдельной таблицы кодов не заводим. Награда —
-- персональный одноразовый промокод из promo_codes (MIGRATION-40), а не
-- отдельный кошелёк/баллы.

BEGIN;

CREATE TABLE IF NOT EXISTS public.referrals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id                UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  referrer_telegram_id  BIGINT NOT NULL,
  referred_telegram_id  BIGINT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rewarded')),
  reward_promo_code     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  rewarded_at           TIMESTAMPTZ,
  -- Один и тот же покупатель может быть «приглашённым» только один раз за
  -- всю историю этого бота — первый переход по ссылке побеждает.
  UNIQUE (bot_id, referred_telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_bot_id ON public.referrals(bot_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(bot_id, referrer_telegram_id);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.referrals;
CREATE POLICY tenant_isolation ON public.referrals
  FOR ALL TO tenant_bot
  USING      (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

DROP TRIGGER IF EXISTS trg_force_bot_id ON public.referrals;
CREATE TRIGGER trg_force_bot_id
  BEFORE INSERT ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.force_bot_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.referrals TO tenant_bot;

COMMIT;

NOTIFY pgrst, 'reload schema';
