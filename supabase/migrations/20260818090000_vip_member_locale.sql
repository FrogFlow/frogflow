-- VIP bot: explicit per-customer UI language, selected via /start's language
-- picker (never inferred from Telegram's device language) — mirrors
-- bot_users.state.locale used by the shop bot. Stored on vip_member_profiles
-- since it is already the per-(bot_id, telegram_id) VIP customer profile row.
ALTER TABLE public.vip_member_profiles
  ADD COLUMN IF NOT EXISTS locale TEXT;
