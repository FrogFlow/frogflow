-- Кейс 3, Задача 3 — баллы за покупки.
--
-- 1 балл = 1 единица валюты заказа. Баланс живёт прямо на bot_users
-- (списывается/начисляется через CAS по текущему значению — тот же приём,
-- что used_count у promo_codes и delivery_index у orders), отдельного
-- леджера не заводим. points_used/points_earned на orders — снимок для
-- истории и админки, не источник истины баланса.

BEGIN;

ALTER TABLE public.bot_users
  ADD COLUMN IF NOT EXISTS loyalty_points INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS points_used   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_earned INTEGER NOT NULL DEFAULT 0;

COMMIT;

NOTIFY pgrst, 'reload schema';
