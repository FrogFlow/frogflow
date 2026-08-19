-- ═══════════════════════════════════════════════════════════════════════════
-- orders.display_no — номер заказа, который один раз показан покупателю и
-- больше никогда не меняется.
--
-- ── Что сломалось ──
-- Покупателю писали «Заказ №563 отправлен на проверку», а когда продавец его
-- подтвердил — «Заказ #366 подтверждён». Тот же заказ, два разных числа.
--
-- Причина в том, что «витринный» order_no (MIGRATION-03) периодически
-- пересчитывается заново — renumber_orders() в nightly_orders_maintenance()
-- (MIGRATION-23/24) каждую ночь перенумеровывает 1..N все заказы бота, чтобы
-- в списке не было дыр от удалённых/просроченных заказов. Это осознанный
-- выбор оператора («номер — позиция в списке», не постоянный идентификатор),
-- и здесь не меняется.
--
-- Проблема была не в самой перенумерации, а в том, что часть сообщений
-- покупателю бралась из orders.id (внутренний, постоянный PK, никогда не
-- показывался и не должен) вместо order_no, а часть — из order_no, читаемого
-- заново в момент отправки, то есть уже после того, как ночная перенумерация
-- могла его сдвинуть. Заказ мог провисеть в «Ждёт подтверждения» и день, и
-- неделю — вполне достаточно, чтобы попасть под перенумерацию между «отправил
-- чек» и «продавец подтвердил».
--
-- ── Решение ──
-- display_no замораживается ровно один раз — в момент, когда order_no
-- впервые присваивается новому заказу (assign_order_no(), MIGRATION-03), — и
-- дальше не трогается НИКЕМ, включая renumber_orders(). Все сообщения
-- покупателю (создание, чек отправлен, подтверждён, отклонён, письмо на
-- почту) теперь показывают display_no. Панель оператора и админ-уведомления
-- по-прежнему могут показывать живой order_no — это их отдельная, осознанная
-- область ответственности («короткий сквозной номер в списке»), не то, что
-- обещано конкретному покупателю в переписке.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS display_no BIGINT;

-- Обратная совместимость для уже существующих заказов: замораживаем текущий
-- order_no как есть. Дальше он никогда не пересчитается заново — даже если
-- отличается от того, что покупатель видел в исходном сообщении месяц назад,
-- это не хуже статус-кво и не требует лезть в историю переписки.
UPDATE public.orders SET display_no = order_no WHERE display_no IS NULL;

-- Имя с префиксом zzz — сортируется после trg_zz_assign_order_no
-- (Postgres выполняет триггеры одного события в алфавитном порядке имён),
-- то есть order_no на NEW уже гарантированно присвоен к этому моменту.
CREATE OR REPLACE FUNCTION public.freeze_display_no() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.display_no IS NULL THEN
    NEW.display_no := NEW.order_no;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_zzz_freeze_display_no ON public.orders;
CREATE TRIGGER trg_zzz_freeze_display_no
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.freeze_display_no();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.orders'::regclass AND NOT tgisinternal
--    ORDER BY tgname;
--   -- ожидается порядок: trg_force_bot_id, trg_zz_assign_order_no,
--   --                     trg_zzz_freeze_display_no
--
--   SELECT count(*) FROM public.orders WHERE display_no IS NULL;
--   -- ожидается: 0
--
--   -- Новый заказ получает одинаковый order_no и display_no сразу:
--   -- INSERT ... RETURNING id, order_no, display_no;
--
--   -- Перенумерация НЕ трогает display_no:
--   -- SELECT public.renumber_orders('<bot_id>');
--   -- SELECT id, order_no, display_no FROM public.orders WHERE bot_id = '<bot_id>';
--   -- display_no у всех строк должен остаться тем же, что был до вызова.
-- ═══════════════════════════════════════════════════════════════════════════
