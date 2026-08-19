-- ═══════════════════════════════════════════════════════════════════════════
-- Ночная уборка (MIGRATION-23) чистила только «Ждёт подтверждения». Теперь
-- туда же добавляется «Ждёт оплаты» старше тех же 7 дней — по прямому
-- запросу оператора.
--
-- Масштаб на момент написания: 160 заказов во всей базе висят
-- awaiting_payment, из них 128 (122 + 6, на двух клиентах) старше 7 дней —
-- то есть это по факту брошенные корзины, а не заказы, ожидающие обработки.
--
-- ── Риск, который стоит понимать ──
-- В отличие от awaiting_confirmation (покупатель уже прислал чек, ждёт
-- решения админа), awaiting_payment — это ещё не оплаченный заказ. Если
-- покупатель тем не менее платит спустя неделю через Robokassa, а заказ к
-- этому моменту уже удалён — callback найдёт по InvId (= orders.id) пустое
-- место, деньги спишутся, а выдать заказ будет не из чего. 7 дней — тот же
-- срок, что и так уже действует на awaiting_confirmation, и на практике
-- Robokassa присылает результат в течение минут-часов после оплаты, а не
-- дней; риск реален только для очень нетипичного сценария (оплата через
-- неделю после начала оформления) и принят оператором осознанно, тем же
-- решением, что и сама эта миграция.
--
-- renumber_orders(bot_id) и права на функции не меняются — только список
-- статусов внутри nightly_orders_maintenance().
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
    AND created_at < now() - interval '7 days';

  FOR b IN SELECT id FROM public.bots LOOP
    PERFORM public.renumber_orders(b.id);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT public.nightly_orders_maintenance();
--   SELECT status, count(*) FROM public.orders
--    WHERE status IN ('awaiting_confirmation','awaiting_payment') GROUP BY status;
--   SELECT count(*) FROM public.orders
--    WHERE status IN ('awaiting_confirmation','awaiting_payment')
--      AND created_at < now() - interval '7 days';
--   -- ожидается: 0
-- ═══════════════════════════════════════════════════════════════════════════
