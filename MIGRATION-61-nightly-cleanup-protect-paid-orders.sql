-- ═══════════════════════════════════════════════════════════════════════════
-- nightly_orders_maintenance() — не удалять заказ, за который уже есть
-- деньги или присланный чек, независимо от того, заполнена ли дата
-- получения.
--
-- MIGRATION-55 сознательно расширила условие "можно удалять по 7-дневному
-- правилу" на физические заказы с NULL fulfillment_at — с чёткой
-- формулировкой в комментарии: "для physical это заказ, который вообще не
-- дошёл до выбора даты — реально брошенный чекаут". Решение верное само по
-- себе — но оно предполагает, что NULL fulfillment_at у физического заказа
-- ⇔ покупатель бросил чекаут ДО оплаты. Это предположение не гарантировано
-- кодом: claim.checkout_fulfillment_at! в zernio-bot.server.ts (Direct-канал)
-- — TypeScript non-null assertion, ничего не проверяющая в рантайме, — при
-- потере/гонке состояния может уйти как undefined в fulfillment.at заказа,
-- у которого чек уже прислан и paid_amount уже стоит (status =
-- 'awaiting_confirmation'). Такой заказ — не брошенный чекаут, а реальные
-- деньги покупателя, которые через 7 дней исчезали бы вместе с чеком и
-- записью об оплате, без единого следа в журнале (Кондитеры, находка C2).
--
-- Правка не меняет уже принятое решение про NULL-дату — она уточняет его
-- формулировкой из самого же комментария MIGRATION-55: "реально брошенный"
-- значит "по нему ничего не заплачено и чек не присылали". Заказ с
-- payment_proof_path или paid_amount > 0 этому не соответствует ни при
-- каком fulfillment_at.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

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
    AND (fulfillment_kind <> 'physical' OR fulfillment_at IS NULL)
    AND platform <> 'manual'
    AND payment_proof_path IS NULL
    AND COALESCE(paid_amount, 0) = 0;

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

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT pg_get_functiondef('public.nightly_orders_maintenance'::regproc);
--   -- убедиться: DELETE ... AND payment_proof_path IS NULL
--   --                  AND COALESCE(paid_amount, 0) = 0 присутствуют
--   -- (сравнить с телом до этой миграции — MIGRATION-57)
-- ═══════════════════════════════════════════════════════════════════════════
