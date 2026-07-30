-- === МИГРАЦИЯ БАЗЫ ДАННЫХ ДЛЯ ИНТЕГРАЦИИ INSTAGRAM (ZERNIO API) ===
-- Выполните этот скрипт в SQL Editor Supabase для поддержки мультиплатформенного бота (Telegram + Instagram)

-- 1. Модернизация таблицы bot_users
ALTER TABLE public.bot_users 
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'telegram',
  ADD COLUMN IF NOT EXISTS user_key TEXT,
  ADD COLUMN IF NOT EXISTS zernio_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS zernio_account_id TEXT,
  ADD COLUMN IF NOT EXISTS opt_out BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_auto_dm_at TIMESTAMPTZ;

-- Генерируем user_key для существующих пользователей Telegram
UPDATE public.bot_users 
SET user_key = 'tg_' || telegram_id::text 
WHERE user_key IS NULL AND telegram_id IS NOT NULL;

-- Сначала удаляем ограничение первичного ключа (PRIMARY KEY) с CASCADE
ALTER TABLE public.bot_users DROP CONSTRAINT IF EXISTS bot_users_pkey CASCADE;

-- Теперь снимаем ограничение NOT NULL с колонки telegram_id
ALTER TABLE public.bot_users ALTER COLUMN telegram_id DROP NOT NULL;

-- Делаем user_key обязательным и устанавливаем его новым первичным ключом
ALTER TABLE public.bot_users ALTER COLUMN user_key SET NOT NULL;

DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_users_user_key_pkey'
  ) THEN
    ALTER TABLE public.bot_users ADD CONSTRAINT bot_users_user_key_pkey PRIMARY KEY (user_key);
  END IF;
END $$;

-- Создаем уникальный индекс по telegram_id для пользователей Telegram
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_users_telegram_id_unique ON public.bot_users(telegram_id) WHERE telegram_id IS NOT NULL;

-- 2. Модернизация таблицы cart_items
ALTER TABLE public.cart_items 
  ADD COLUMN IF NOT EXISTS user_key TEXT;

ALTER TABLE public.cart_items 
  ALTER COLUMN telegram_id DROP NOT NULL;

UPDATE public.cart_items 
SET user_key = 'tg_' || telegram_id::text 
WHERE user_key IS NULL AND telegram_id IS NOT NULL;

ALTER TABLE public.cart_items DROP CONSTRAINT IF EXISTS cart_items_telegram_id_product_id_key;

DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_user_key_product_id_key'
  ) THEN
    ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_user_key_product_id_key UNIQUE (user_key, product_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cart_items_user_key ON public.cart_items(user_key);

-- 3. Модернизация таблицы orders
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'telegram',
  ADD COLUMN IF NOT EXISTS user_key TEXT,
  ADD COLUMN IF NOT EXISTS zernio_conversation_id TEXT;

ALTER TABLE public.orders 
  ALTER COLUMN telegram_id DROP NOT NULL;

UPDATE public.orders 
SET user_key = 'tg_' || telegram_id::text 
WHERE user_key IS NULL AND telegram_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_user_key ON public.orders(user_key);
CREATE INDEX IF NOT EXISTS idx_orders_platform ON public.orders(platform);

-- 4. Создание таблицы Comment-to-DM автоматизаций в Instagram
CREATE TABLE IF NOT EXISTS public.zernio_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  reply_text TEXT NOT NULL,
  dm_text TEXT,
  post_id TEXT, -- ID поста/Reels (или NULL для всех постов)
  is_active BOOLEAN NOT NULL DEFAULT true,
  trigger_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.zernio_automations TO service_role;
ALTER TABLE public.zernio_automations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service Role All zernio_automations" ON public.zernio_automations;
CREATE POLICY "Service Role All zernio_automations"
ON public.zernio_automations FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 5. Создание таблицы логов и обработанных событий (дедупликация и исключения)
CREATE TABLE IF NOT EXISTS public.zernio_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT UNIQUE,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed', -- 'processed', 'ignored', 'failed', 'opt_out'
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.zernio_logs TO service_role;
ALTER TABLE public.zernio_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service Role All zernio_logs" ON public.zernio_logs;
CREATE POLICY "Service Role All zernio_logs"
ON public.zernio_logs FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_zernio_logs_event_id ON public.zernio_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_zernio_logs_type ON public.zernio_logs(event_type);
