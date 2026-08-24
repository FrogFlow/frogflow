-- ═══════════════════════════════════════════════════════════════════════════
-- Целостность vip_subscriptions: два частичных UNIQUE-индекса и триггер
-- updated_at.
--
-- Сейчас «одна активная / одна ожидающая подписка на человека» — это
-- соглашение, которое держится только на ручной чистке в коде
-- (expireOtherActivesAndRevokeInvites, схлопывание дублей в
-- handleBuyTariff), а не на ограничении в базе, и легко нарушается гонками
-- и продлением через extendVipSubscription, которое не закрывает старые
-- активные строки при продлении. На проде такие дубли уже есть: у части
-- подписчиков одновременно по две активные строки — отсюда повторные
-- напоминания cron'а с чужой датой истечения и лишние отзывы ссылок.
--
-- Дубль pending_payment ещё опаснее: .maybeSingle() в handlePhoto
-- (vip-bot.server.ts) молча возвращает null при больше чем одной подходящей
-- строке (PostgREST PGRST116) — оплативший клиент, приславший чек, слышит
-- «у вас нет подписки, ожидающей оплаты», а админ не узнаёт вообще ничего.
--
-- Миграция сначала схлопывает существующие дубли (иначе UNIQUE не встанет
-- на уже нарушенных данных), потом ставит ограничение. Дальше повторное
-- нарушение станет ошибкой записи, а не тихо появившейся второй строкой.
-- Код, который активирует подписку (activateVipSubscription,
-- addVipSubscriptionManual), теперь закрывает старые активные строки ДО
-- этой записи, а не после — иначе он сам первым наткнётся на новый индекс.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Схлопнуть существующие дубли pending_payment: оставить самую новую
--    строку на (bot_id, telegram_id), остальные — в cancelled. Та же логика,
--    что уже применяет handleBuyTariff при обнаружении гонки создания заявки.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY bot_id, telegram_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.vip_subscriptions
  WHERE status = 'pending_payment'
)
UPDATE public.vip_subscriptions v
SET status = 'cancelled'
FROM ranked
WHERE v.id = ranked.id AND ranked.rn > 1;

-- 2. Схлопнуть существующие дубли active: оставить строку с самым поздним
--    expires_at — та же логика, что pickLatestPerUser применяет при выборе,
--    кого предупреждать. Остальные — в expired. Ссылку в базе обнуляем;
--    отозвать её через Telegram API отсюда не выйдет (это чистый SQL), но
--    она либо уже не единственная активная (member_limit исчерпан после
--    P0-2), либо истечёт сама по её собственному expire_date.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY bot_id, telegram_id
           ORDER BY expires_at DESC, id DESC
         ) AS rn
  FROM public.vip_subscriptions
  WHERE status = 'active'
)
UPDATE public.vip_subscriptions v
SET status = 'expired',
    group_invite_link = NULL,
    admin_note = 'migration_31_dedup'
FROM ranked
WHERE v.id = ranked.id AND ranked.rn > 1;

-- 3. Ограничения: одна pending_payment и одна active строка на (bot_id,
--    telegram_id). Частичные — expired/cancelled копятся как история и
--    дублей в них не бывает по определению этого сценария.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vip_subs_one_pending
  ON public.vip_subscriptions (bot_id, telegram_id)
  WHERE status = 'pending_payment';

CREATE UNIQUE INDEX IF NOT EXISTS uq_vip_subs_one_active
  ON public.vip_subscriptions (bot_id, telegram_id)
  WHERE status = 'active';

-- 4. updated_at была объявлена с DEFAULT now() в MIGRATION-01, но без
--    триггера равна времени создания строки навсегда. От неё зависит
--    кулдаун повторной отправки чека в handlePhoto (vip-bot.server.ts) —
--    сейчас он не работает ни в одну сторону. Функция уже используется для
--    bot_users/orders (setup-database.sql) — CREATE OR REPLACE на случай
--    окружения, где этой части бутстрапа не было.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_vip_subscriptions_touch ON public.vip_subscriptions;
CREATE TRIGGER trg_vip_subscriptions_touch BEFORE UPDATE ON public.vip_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
