-- Ниши, Блок D — простой список вариантов товара («Торт 1 кг» / «Торт 2 кг»).
--
-- Не полная multi-атрибутная система (размер × начинка × …) — по решению
-- пользователя, самый дешёвый вариант, покрывающий реальный кейс
-- кондитерской. Один товар — список именованных вариантов с ценой,
-- покупатель выбирает вариант перед «В корзину».
--
-- products.price/country_prices НЕ трогаем схемой (колонка NOT NULL,
-- менять на nullable — лишний риск): если у товара есть варианты, его
-- собственная price становится неиспользуемым легаси-значением, а
-- показывается/продаётся всегда цена варианта (см. pricing.server.ts).
--
-- product_variants — без is_active и без снимка цены отдельной колонкой:
-- вариант удаляется/пересоздаётся целиком при сохранении товара (как
-- product_images/product_material_files), а цена и так снимается в
-- order_items.price_snapshot/name_snapshot (имя варианта склеивается в
-- name_snapshot, например «Торт — 1 кг»).

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_variants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id     UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  price      NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants(product_id, sort_order);

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.product_variants;
CREATE POLICY tenant_isolation ON public.product_variants
  FOR ALL TO tenant_bot
  USING      (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

DROP TRIGGER IF EXISTS trg_force_bot_id ON public.product_variants;
CREATE TRIGGER trg_force_bot_id
  BEFORE INSERT ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.force_bot_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO tenant_bot;

-- Выбранный вариант — на строке корзины и на снимке позиции заказа.
-- ON DELETE SET NULL: удаление варианта не должно ронять исторический
-- order_item (name_snapshot/price_snapshot уже несут его цену и имя) или
-- молча стирать строку корзины — просто теряется ссылка на уже
-- несуществующий вариант, что cart_items UI обязан пережить как «вариант
-- больше недоступен», а не крашем.
ALTER TABLE public.cart_items
  ADD COLUMN IF NOT EXISTS product_variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS product_variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;

COMMENT ON TABLE public.product_variants IS
  'Ниши, Блок D — простой список вариантов товара (имя + цена), например «1 кг» / «2 кг». Заменяется целиком при сохранении товара, как product_images.';
COMMENT ON COLUMN public.cart_items.product_variant_id IS
  'Выбранный вариант товара (NULL — товар без вариантов, обычная цена products.price).';
COMMENT ON COLUMN public.order_items.product_variant_id IS
  'Вариант, из которого сложился этот снимок позиции (name_snapshot/price_snapshot) — NULL для товаров без вариантов.';

COMMIT;

NOTIFY pgrst, 'reload schema';
