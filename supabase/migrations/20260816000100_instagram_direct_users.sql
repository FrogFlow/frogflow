-- Instagram Direct users share the existing cart and order tables with Telegram.
-- Telegram's bigint primary key is retained for backward compatibility; Instagram
-- users receive a deterministic negative synthetic ID in application code.
ALTER TABLE public.bot_users
  ADD COLUMN IF NOT EXISTS user_key TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'telegram',
  ADD COLUMN IF NOT EXISTS zernio_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS zernio_account_id TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_users_user_key_unique
  ON public.bot_users (user_key)
  WHERE user_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bot_users_zernio_conversation
  ON public.bot_users (zernio_conversation_id)
  WHERE zernio_conversation_id IS NOT NULL;

-- Preserve the channel identity on an order, while keeping telegram_id as the
-- foreign key that ties orders and cart rows to a single customer record.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS user_key TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'telegram';

CREATE INDEX IF NOT EXISTS idx_orders_user_key
  ON public.orders (user_key)
  WHERE user_key IS NOT NULL;
