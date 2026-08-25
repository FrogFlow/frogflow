-- MIGRATION-38: capture the buyer's delivery-language choice at checkout
-- time, when app_settings.delivery_lang_timing = "before" (see
-- product-materials.ts DeliveryLangChoice, bot.server.ts
-- proceedToLanguageOrPlace/placeOrderInner).
--
-- NULL means "not chosen up front" — either the setting is "after" (the
-- existing after-payment language-picker keeps working exactly as before),
-- the multi_language module is off, or the order's cart only ever had one
-- language available so there was nothing to ask. A non-NULL value tells
-- deliverOrder() to skip that picker and deliver straight to the chosen
-- language(s) — "all" meaning every language available for each item.

BEGIN;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_lang_choice TEXT;

COMMENT ON COLUMN public.orders.delivery_lang_choice IS
  'Язык доставки материалов, выбранный ДО оформления (app_settings.delivery_lang_timing = "before"): код языка ("ru"/"kk"/"en"/"uz") или "all" — все доступные для каждой позиции. NULL — выбор языка (если нужен) остаётся после оплаты, как раньше.';

COMMIT;
