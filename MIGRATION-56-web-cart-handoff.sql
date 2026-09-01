-- ═══════════════════════════════════════════════════════════════════════════
-- Веб-витрина → Telegram: временная корзина для deep link ?start=wc_<token>.
--
-- Покупатель собирает корзину на /shop, жмёт «Оплатить в Telegram», получает
-- ссылку t.me/<bot>?start=wc_<token>. При первом /start бот переносит позиции
-- в cart_items (даже если пользователь никогда раньше не открывал бота).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.web_cart_handoffs (
  token text PRIMARY KEY,
  bot_id uuid NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz NULL,
  claimed_telegram_id bigint NULL
);

CREATE INDEX IF NOT EXISTS web_cart_handoffs_bot_id_idx
  ON public.web_cart_handoffs (bot_id);

CREATE INDEX IF NOT EXISTS web_cart_handoffs_expires_unclaimed_idx
  ON public.web_cart_handoffs (expires_at)
  WHERE claimed_at IS NULL;

ALTER TABLE public.web_cart_handoffs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.web_cart_handoffs IS
  'Одноразовые корзины с веб-витрины до перехода в Telegram (deep link wc_<token>).';

COMMIT;

-- Проверка:
-- SELECT * FROM public.web_cart_handoffs ORDER BY created_at DESC LIMIT 5;
