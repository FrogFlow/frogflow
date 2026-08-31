-- ═══════════════════════════════════════════════════════════════════════════
-- Напоминание о дате получения физического заказа (Ниши, доводка после
-- Блока 8.3) — продавцу и покупателю за ~сутки до fulfillment_at. Раньше
-- такого не было: покупатель и продавец узнавали о приближающейся дате
-- получения только из текста, показанного при оформлении, — ничего не
-- напоминало о ней ближе к делу.
--
-- fulfillment_reminder_sent_at — идемпотентность тем же приёмом, что
-- bot_users.cart_reminder_sent_at (MIGRATION-44): нулевая по умолчанию,
-- CAS-проставляется cron'ом ровно один раз на заказ, повторный запуск в
-- то же 24-часовое окно ничего не отправляет повторно.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.fulfillment_reminder_sent_at IS
  'Когда напоминание о fulfillment_at было отправлено (и продавцу, и покупателю) — NULL значит ещё не отправлено. Ставится cron''ом /api/cron/fulfillment-reminder ровно один раз на заказ.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name = 'fulfillment_reminder_sent_at';
-- ═══════════════════════════════════════════════════════════════════════════
