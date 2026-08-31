-- ═══════════════════════════════════════════════════════════════════════════
-- Мина 1, доводка: ночная чистка не должна удалять физический заказ из
-- Instagram/WhatsApp только потому, что у него нет fulfillment_at.
--
-- MIGRATION-49 закрыла риск для Telegram-заказов («не удалять, если
-- fulfillment_at в будущем»), но для Direct-каналов (Instagram/WhatsApp)
-- чекаут физических заказов не сделан (Ниши, Блок 8.3 — сознательно вне
-- объёма): createOrderFromCart (direct-purchase.server.ts) никогда не
-- заполняет fulfillment_at, он всегда NULL. Старое условие
-- `fulfillment_at IS NULL OR fulfillment_at < now()` считало это «нет даты —
-- значит можно удалять» — а для физического заказа это ровно тот же риск,
-- от которого MIGRATION-49 защищает Telegram: заказ на торт, оплаченный
-- покупателем из Instagram, зависший в awaiting_confirmation дольше недели,
-- исчезал бы вместе с деньгами покупателя.
--
-- Правка: NULL fulfillment_at продолжает означать «можно удалять по
-- старому 7-дневному правилу» только для digital (где это нормально — там
-- этого поля никогда не было и не будет); для physical NULL значит
-- «дата ещё не согласована» и заказ не трогаем, пока продавец не выставит
-- дату (или заказ не закроется сам — доставлен/отклонён — тогда чистка его
-- не касается вовсе, условие ловит только awaiting_*).
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
    AND (
      (fulfillment_kind <> 'physical' AND fulfillment_at IS NULL)
      OR fulfillment_at < now()
    );

  FOR b IN SELECT id FROM public.bots LOOP
    PERFORM public.renumber_orders(b.id);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT pg_get_functiondef('public.nightly_orders_maintenance'::regproc);
--   -- убедиться, что условие DELETE содержит fulfillment_kind <> 'physical'
-- ═══════════════════════════════════════════════════════════════════════════
