-- ═══════════════════════════════════════════════════════════════════════════
-- Кондитерская ветка (Ниши, физические товары) — ревизия. Три независимые
-- правки в одном заходе, все — на функции/таблицы, уже созданные Блоками
-- 49–54; каждая отдельно объяснена ниже.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. nightly_orders_maintenance() — MIGRATION-49/50 молча откатили
--    MIGRATION-35 (нашли живым чтением функции с боевой базы).
--
-- MIGRATION-35 сузила ночную перенумерацию заказов до "только у ботов, где
-- order_counters.last_no разъехался с count(*)" — на семи живых
-- арендаторах это было ~9500 переписанных версий строк за ночь, растущих
-- линейно с базой (см. обоснование в самой MIGRATION-35). MIGRATION-49 и
-- следом MIGRATION-50, добавляя защиту для физических заказов, скопировали
-- тело функции с более раннего CREATE OR REPLACE (до MIGRATION-35) и
-- вернули "FOR b IN SELECT id FROM public.bots LOOP" — полный проход по
-- всем ботам каждую ночь, без разбора чистых/грязных. Ни в одной из двух
-- миграций это не упомянуто — похоже, забыли, что правили не последнюю
-- версию функции.
--
-- Восстанавливаем условие MIGRATION-35 один в один, поверх уже сделанной
-- Блоком 50 защиты по fulfillment_kind (пункт 2 ниже).
--
-- 2. DELETE-условие — физический заказ с УЖЕ НАСТУПИВШЕЙ датой получения
--    больше не удаляется молча.
--
-- Старое условие (MIGRATION-50):
--   (fulfillment_kind <> 'physical' AND fulfillment_at IS NULL)
--   OR fulfillment_at < now()
-- защищало только БУДУЩую дату — если покупательница оформила торт на
-- 10-е, прислала чек 1-го, а продавец в отпуске и не глянул чек до 11-го,
-- заказ (вместе с чеком и записью об оплате) удалялся по второй ветке
-- ровно в тот момент, когда внимание к нему нужнее всего.
--
-- Новое условие: NULL fulfillment_at по-прежнему значит "можно удалять по
-- 7-дневному правилу" для обоих типов (для physical это заказ, который
-- вообще не дошёл до выбора даты — реально брошенный чекаут); а если дата
-- ВЫСТАВЛЕНА (будущая или уже прошедшая) — заказ трогать нельзя вовсе,
-- пока человек не решит вручную (принять/отклонить/удалить — все три пути
-- сейчас есть в /admin/orders, включая отмену уже принятого заказа).
--
-- 3. CHECK-и, которых не хватало сравнить с соседними миграциями:
--    orders.paid_amount <= total (не было вообще — Блок 1 добавил защиты
--    от двойной записи в коде, но без CHECK в БД оставался последний
--    рубеж), delivery_zones.price >= 0 (MIGRATION-53 у product_variants.price
--    такой CHECK ставит, MIGRATION-52 у delivery_zones.price — нет).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nightly_orders_maintenance() RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  b record;
BEGIN
  DELETE FROM public.orders
  WHERE status IN ('awaiting_confirmation', 'awaiting_payment')
    AND created_at < now() - interval '7 days'
    AND (fulfillment_kind <> 'physical' OR fulfillment_at IS NULL);

  FOR b IN
    SELECT bt.id
    FROM public.bots bt
    LEFT JOIN public.order_counters oc ON oc.bot_id = bt.id
    WHERE oc.bot_id IS NULL
       OR oc.last_no IS DISTINCT FROM (
         SELECT count(*) FROM public.orders o WHERE o.bot_id = bt.id
       )
  LOOP
    PERFORM public.renumber_orders(b.id);
  END LOOP;
END $$;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_paid_amount_le_total;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_paid_amount_le_total CHECK (paid_amount <= total);

ALTER TABLE public.delivery_zones
  DROP CONSTRAINT IF EXISTS delivery_zones_price_nonneg;
ALTER TABLE public.delivery_zones
  ADD CONSTRAINT delivery_zones_price_nonneg CHECK (price >= 0);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT pg_get_functiondef('public.nightly_orders_maintenance'::regproc);
--   -- убедиться: FOR b IN SELECT bt.id FROM ... LEFT JOIN order_counters ...
--   -- (не голый "SELECT id FROM public.bots")
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_paid_amount_le_total';
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.delivery_zones'::regclass AND conname = 'delivery_zones_price_nonneg';
-- ═══════════════════════════════════════════════════════════════════════════
