-- MIGRATION-46: складской учёт (Кейс 4) — необязательный лимит остатка на
-- товар. NULL (по умолчанию, для всех уже существующих товаров) означает
-- «остаток не отслеживается» — ровно текущее поведение, без изменений.
-- Заданное число трактуется как «доступно к продаже» и убывает атомарно
-- (CAS) при оформлении заказа — см. decrementStock()/addToCart() в
-- bot.server.ts. Модуль `stock` в registry.ts решает, применяется ли лимит
-- вообще: без модуля колонка читается, но никогда не используется.

BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_quantity INTEGER;

ALTER TABLE public.products ADD CONSTRAINT products_stock_quantity_nonneg
  CHECK (stock_quantity IS NULL OR stock_quantity >= 0);

COMMENT ON COLUMN public.products.stock_quantity IS
  'Остаток на складе. NULL — не отслеживается (безлимитно, поведение по умолчанию). Убывает атомарно при оформлении заказа, если модуль stock включён.';

COMMIT;

NOTIFY pgrst, 'reload schema';
