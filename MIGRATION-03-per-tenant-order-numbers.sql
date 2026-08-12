-- ═══════════════════════════════════════════════════════════════════════════
-- ФАЗА 3 — своя нумерация заказов у каждого клиента.
--
-- ПРИМЕНЯТЬ ПОСЛЕ ФАЗЫ 1, ДО ДЕПЛОЯ КОДА. От Фазы 2 не зависит: всё, что
-- касается роли tenant_bot, выполняется только если роль уже создана, а
-- current_bot_id() создаётся здесь же (CREATE OR REPLACE, повторно безопасно).
-- Причина такого порядка: код показывает order_no, и без этой колонки его
-- запросы к orders вернут ошибку, а не пустое поле.
--
-- orders.id остаётся глобальным и внутренним: на него ссылается order_items,
-- им же уходит InvId в Robokassa и callback_data кнопок админа. Менять его
-- нельзя — сверка платежей и связи развалятся.
--
-- Для покупателя добавляется order_no — сквозной номер в пределах одного бота.
-- У Анастасии нумерация не прерывается: существующим заказам order_no = id,
-- то есть следующий заказ продолжит текущий ряд. Новые клиенты начинают с 1.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Та же функция, что и в Фазе 2 — продублирована, чтобы этот файл можно было
-- применить раньше неё. CREATE OR REPLACE делает повтор безопасным.
CREATE OR REPLACE FUNCTION public.current_bot_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::json ->> 'bot_id', '')::uuid
$$;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_no BIGINT;

-- Счётчик на каждого арендатора. Отдельная таблица, а не max(order_no)+1:
-- UPDATE ... RETURNING блокирует строку счётчика, поэтому два одновременных
-- заказа одного бота не получат одинаковый номер, а разные боты друг друга
-- не блокируют.
CREATE TABLE IF NOT EXISTS public.order_counters (
  bot_id  UUID PRIMARY KEY REFERENCES public.bots(id) ON DELETE CASCADE,
  last_no BIGINT NOT NULL DEFAULT 0
);
GRANT ALL ON public.order_counters TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_bot') THEN
    GRANT SELECT, INSERT, UPDATE ON public.order_counters TO tenant_bot;
  END IF;
END $$;

-- ─── Бэкфилл: сохраняем текущие номера как есть ──────────────────────────
UPDATE public.orders SET order_no = id WHERE order_no IS NULL;

INSERT INTO public.order_counters (bot_id, last_no)
SELECT bot_id, COALESCE(MAX(order_no), 0)
FROM public.orders
WHERE bot_id IS NOT NULL
GROUP BY bot_id
ON CONFLICT (bot_id) DO UPDATE
  SET last_no = GREATEST(public.order_counters.last_no, EXCLUDED.last_no);

ALTER TABLE public.orders ALTER COLUMN order_no SET NOT NULL;

-- Номер уникален внутри бота, но не между ботами — в этом весь смысл.
DROP INDEX IF EXISTS orders_bot_order_no_idx;
CREATE UNIQUE INDEX orders_bot_order_no_idx ON public.orders(bot_id, order_no);

-- ─── Выдача следующего номера ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_order_no() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE target_bot uuid := COALESCE(NEW.bot_id, public.current_bot_id());
BEGIN
  IF NEW.order_no IS NULL AND target_bot IS NOT NULL THEN
    INSERT INTO public.order_counters (bot_id, last_no)
    VALUES (target_bot, 1)
    ON CONFLICT (bot_id) DO UPDATE
      SET last_no = public.order_counters.last_no + 1
    RETURNING last_no INTO NEW.order_no;
  END IF;
  RETURN NEW;
END $$;

-- ВАЖНО: имя намеренно начинается с trg_zz. Триггеры одного момента
-- срабатывают в алфавитном порядке, а этот обязан идти ПОСЛЕ
-- trg_force_bot_id — иначе NEW.bot_id ещё не проставлен из JWT и номер
-- уйдёт из счётчика чужого бота.
DROP TRIGGER IF EXISTS trg_zz_assign_order_no ON public.orders;
CREATE TRIGGER trg_zz_assign_order_no
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_order_no();

-- Полный сброс данных клиента должен обнулять и его нумерацию.
ALTER TABLE public.order_counters ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_bot') THEN
    DROP POLICY IF EXISTS tenant_isolation ON public.order_counters;
    CREATE POLICY tenant_isolation ON public.order_counters
      FOR ALL TO tenant_bot
      USING (bot_id = public.current_bot_id())
      WITH CHECK (bot_id = public.current_bot_id());
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── Проверка ────────────────────────────────────────────────────────────
-- Нумерация каждого бота должна быть непрерывной и начинаться с 1
-- (у Анастасии — продолжать историю):
--
--   SELECT bot_id, min(order_no), max(order_no), count(*) FROM orders GROUP BY bot_id;
--   SELECT * FROM order_counters;
