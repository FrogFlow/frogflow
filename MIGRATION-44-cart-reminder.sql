-- Кейс 3, Задача 6 — возврат брошенной корзины.
--
-- cart_reminder_sent_at на bot_users, а не отдельная таблица: одна метка на
-- покупателя достаточна, потому что напоминание сравнивается с моментом
-- последней активности в его же корзине (MAX(cart_items.created_at)) — см.
-- src/lib/cart-reminder.ts shouldSendCartReminder().

BEGIN;

ALTER TABLE public.bot_users
  ADD COLUMN IF NOT EXISTS cart_reminder_sent_at TIMESTAMPTZ;

COMMIT;

NOTIFY pgrst, 'reload schema';
