-- ═══════════════════════════════════════════════════════════════════════════
-- nightly_orders_maintenance() удаляет заказ, оформленный сотрудником по
-- телефону/из переписки в Instagram (createManualOrder, orders.functions.ts,
-- platform='manual'), если к нему ещё не выбрана дата получения и он не
-- оплачен — то есть fulfillment_at IS NULL и status='awaiting_payment', то
-- же самое условие, что и у реально брошенного бот-чекаута (MIGRATION-55).
--
-- Разница в том, что бот-чекаут без даты и оплаты старше 7 дней — это
-- достоверно брошенная попытка: покупатель ушёл до конца сценария. Заказ,
-- заведённый вручную кондитером (звонок, комментарий в директе), — это
-- реальный заказ живого клиента; дату/оплату к нему просто ещё не внесли
-- в панели. Без исключения такой заказ мог тихо исчезнуть без следа через
-- неделю — ровно то, ради чего вообще существует ручной ввод (Блок 4,
-- находка 4.12 того же ревью, что и Direct-остаток, того же характера).
--
-- Единственная правка — новое условие AND platform <> 'manual' в первом
-- DELETE; тело функции иначе не меняется.
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
    AND platform <> 'manual';

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
--   -- убедиться: DELETE ... AND platform <> 'manual' присутствует
--   -- (сравнить с телом до этой миграции — MIGRATION-55)
-- ═══════════════════════════════════════════════════════════════════════════
