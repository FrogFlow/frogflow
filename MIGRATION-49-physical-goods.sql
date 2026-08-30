-- ═══════════════════════════════════════════════════════════════════════════
-- Ниши (VERTICAL) и физические товары. Первый клиент за пределами цифровых
-- материалов — кондитерская: торты и десерты на заказ, а не файл, который
-- можно отправить в чат сразу после оплаты.
--
-- Ниша (bots.vertical) — не то же самое, что тип товара
-- (products.fulfillment_kind). Ниша задаёт умолчания и тексты деплоя
-- (см. src/lib/verticals/registry.ts, читается из VERTICAL — переменной
-- окружения проекта Vercel, не из этой колонки: рантайм её не запрашивает).
-- Конкретный товар всё равно решает сам, цифровой он или физический —
-- кондитер может продать PDF-рецепт, образовательный проект — печатный
-- воркбук. bots.vertical нужна только панели оператора: знать, что
-- показывать в карточке клиента и какую строку VERTICAL= положить в блок
-- переменных при подключении/переезде (см. env-block.server.ts).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Товар: тип и срок изготовления ──
-- lead_time_days отдельно от stock_quantity (MIGRATION-46) — это разные
-- оси: остаток «сколько есть сейчас», срок — «сколько делается с нуля».
-- NULL/0 = есть в наличии (витринная позиция, решает stock_quantity), N =
-- под заказ, готовится N дней. Одно поле закрывает оба сценария кондитера
-- («и то и другое» — готовая витрина и позиции на заказ).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS fulfillment_kind TEXT NOT NULL DEFAULT 'digital',
  ADD COLUMN IF NOT EXISTS lead_time_days INTEGER;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_fulfillment_kind_check;
ALTER TABLE public.products ADD CONSTRAINT products_fulfillment_kind_check
  CHECK (fulfillment_kind IN ('digital', 'physical'));

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_lead_time_days_nonneg;
ALTER TABLE public.products ADD CONSTRAINT products_lead_time_days_nonneg
  CHECK (lead_time_days IS NULL OR lead_time_days >= 0);

COMMENT ON COLUMN public.products.fulfillment_kind IS
  'digital (умолчание) — выдача файлом, как сегодня. physical — товар, который нужно изготовить/выдать руками; продажа не требует прикреплённых файлов (см. productHasFiles()).';
COMMENT ON COLUMN public.products.lead_time_days IS
  'Срок изготовления в днях для fulfillment_kind=physical. NULL/0 — есть в наличии сейчас. Используется чекаутом для минимальной даты получения.';

-- ── Заказ: снимок типа + данные получения ──
-- fulfillment_kind на заказе — снимок на момент оформления, тем же приёмом,
-- что price_snapshot в order_items: смена типа товара задним числом не
-- должна задним числом менять уже размещённые заказы.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_kind TEXT NOT NULL DEFAULT 'digital',
  ADD COLUMN IF NOT EXISTS fulfillment_type TEXT,
  ADD COLUMN IF NOT EXISTS fulfillment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulfillment_address TEXT,
  ADD COLUMN IF NOT EXISTS fulfillment_note TEXT,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_fulfillment_kind_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_fulfillment_kind_check
  CHECK (fulfillment_kind IN ('digital', 'physical'));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_fulfillment_type_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_fulfillment_type_check
  CHECK (fulfillment_type IS NULL OR fulfillment_type IN ('pickup', 'delivery'));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_paid_amount_nonneg;
ALTER TABLE public.orders ADD CONSTRAINT orders_paid_amount_nonneg
  CHECK (paid_amount >= 0);

COMMENT ON COLUMN public.orders.fulfillment_kind IS
  'Снимок products.fulfillment_kind на момент оформления — как price_snapshot у order_items. Решает, какая машина выдачи ведёт заказ (deliverOrder для digital, fulfillment.server.ts для physical).';
COMMENT ON COLUMN public.orders.fulfillment_type IS
  'pickup/delivery для physical-заказов. NULL у digital.';
COMMENT ON COLUMN public.orders.fulfillment_at IS
  'Когда покупатель получает заказ. У physical — обязательна к моменту оформления; у digital не используется. Ночная чистка (nightly_orders_maintenance) не удаляет заказ, пока эта дата в будущем — см. правку ниже.';
COMMENT ON COLUMN public.orders.fulfillment_address IS
  'Адрес доставки. Заполняется только при fulfillment_type=delivery.';
COMMENT ON COLUMN public.orders.fulfillment_note IS
  'Комментарий покупателя к заказу (надпись на торте, пожелания). Необязателен.';
COMMENT ON COLUMN public.orders.paid_amount IS
  'Сколько уже внесено. У digital и у физического заказа с полной оплатой равен total к моменту оплаты. Остаток = total - paid_amount.';

-- ── Оператор: ниша деплоя ──
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS vertical TEXT NOT NULL DEFAULT 'digital';

COMMENT ON COLUMN public.bots.vertical IS
  'Ниша деплоя для панели оператора — что показывать в карточке клиента и какую строку VERTICAL= выдать в блоке переменных (env-block.server.ts). Рантайм клиента читает переменную окружения VERTICAL, не эту колонку — см. lib/verticals/vertical.server.ts.';

-- ── Очередь производства ──
CREATE INDEX IF NOT EXISTS idx_orders_bot_status_fulfillment_at
  ON public.orders (bot_id, status, fulfillment_at);

-- ── Мина 1: ночная чистка не должна удалять заказ с будущей датой получения ──
-- Кондитерская: торт заказан за три недели, задаток внесён, статус висит в
-- awaiting_confirmation/accepted/in_production дольше недели — это не
-- брошенная корзина, а нормальный срок изготовления. Старое условие
-- (MIGRATION-24) удаляло такие заказы вместе с задатком.
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
    AND (fulfillment_at IS NULL OR fulfillment_at < now());

  FOR b IN SELECT id FROM public.bots LOOP
    PERFORM public.renumber_orders(b.id);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--    WHERE table_name = 'products' AND column_name IN ('fulfillment_kind','lead_time_days');
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--    WHERE table_name = 'orders' AND column_name LIKE 'fulfillment_%' OR column_name = 'paid_amount';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'bots' AND column_name = 'vertical';
--   -- существующие товары/заказы не должны были измениться:
--   SELECT count(*) FROM public.products WHERE fulfillment_kind <> 'digital';   -- ожидается: 0
--   SELECT count(*) FROM public.orders WHERE fulfillment_kind <> 'digital';     -- ожидается: 0
--   -- нельзя вставить некорректный тип:
--   -- UPDATE products SET fulfillment_kind = 'bogus' WHERE id = ...;  -- должно упасть на CHECK
-- ═══════════════════════════════════════════════════════════════════════════
