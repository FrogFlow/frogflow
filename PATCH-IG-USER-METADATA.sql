-- Добавление колонки метаданных для хранения информации о подписчиках Instagram и др.
ALTER TABLE public.bot_users ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.bot_users.metadata IS 'Хранит дополнительные данные: followerCount, isVerified, и др. из Zernio';
