-- ═══════════════════════════════════════════════════════════════════════════
-- Доставка по зонам с ценой (Ниши, доводка после Блока 8.3). Сегодня
-- доставка физического заказа — только свободный текстовый адрес, без
-- стоимости: продавец узнаёт цену доставки и сообщает её покупателю сам, в
-- переписке, уже после оформления заказа. delivery_zones даёт продавцу
-- завести именованные зоны с ценой («Центр — 500 ₸»), а чекауту — спросить
-- зону до показа реквизитов, так что сумма к оплате сразу включает доставку.
--
-- Отдельная таблица, а не app_settings: зоне нужен стабильный id для FK с
-- orders, независимый CRUD и сортировка — то же рассуждение, что уже
-- привело к отдельной таблице payment_methods вместо JSON-блока в
-- app_settings (список именованных сущностей с ценой, а не одиночный
-- скаляр). RLS и триггер bot_id — тем же приёмом, что gift_certificates
-- (MIGRATION-45)/promo_codes (MIGRATION-40).
--
-- Без своей колонки валюты: цена зоны — в той же валюте, что уже посчитан
-- заказ (доставка в одном городе/стране на практике). Если позже
-- понадобится цена зоны по странам — отдельная задача.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.delivery_zones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id     UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  price      NUMERIC(10,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.delivery_zones;
CREATE POLICY tenant_isolation ON public.delivery_zones
  FOR ALL TO tenant_bot
  USING      (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

DROP TRIGGER IF EXISTS trg_force_bot_id ON public.delivery_zones;
CREATE TRIGGER trg_force_bot_id
  BEFORE INSERT ON public.delivery_zones
  FOR EACH ROW EXECUTE FUNCTION public.force_bot_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_zones TO tenant_bot;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_zone_id UUID REFERENCES public.delivery_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_zone_name TEXT,
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON TABLE public.delivery_zones IS
  'Именованные зоны доставки продавца с ценой — покупатель выбирает зону в чекауте физического заказа (Ниши, Блок 8.3), её цена добавляется к orders.total.';
COMMENT ON COLUMN public.orders.delivery_zone_name IS
  'Снимок delivery_zones.name на момент оформления — как name_snapshot у order_items: переименование/удаление зоны продавцом не должно менять историю уже оформленных заказов.';
COMMENT ON COLUMN public.orders.delivery_fee IS
  'Сумма доставки, уже включённая в orders.total. 0 по умолчанию — для самовывоза и для заказов без выбранной зоны.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'delivery_zones';
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name LIKE 'delivery_%';
-- ═══════════════════════════════════════════════════════════════════════════
