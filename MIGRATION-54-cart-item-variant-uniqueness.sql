-- Ниши, Блок D — найдено живым тестом (не в исходном плане Блока D).
--
-- cart_items несёт унаследованный уникальный индекс
-- cart_items_bot_user_key_product_id_key ON (bot_id, user_key, product_id) —
-- он не знает о product_variant_id (MIGRATION-53) и блокирует ровно тот
-- сценарий, ради которого варианты и делались: у Direct-каналов (Instagram/
-- WhatsApp), где user_key всегда заполнен, вторая строка корзины для того же
-- товара с ДРУГИМ вариантом падала на этом индексе — INSERT молча не
-- проходил (или падал бы с ошибкой уникальности, если бы addToCart её не
-- проглатывал), и в корзине оставался только первый выбранный вариант.
-- В Telegram той же проблемы нет: там user_key в cart_items не пишется,
-- остаётся NULL, а NULL <> NULL в уникальном индексе Postgres — но полагаться
-- на это как на объяснение "почему у нас всё работает" неправильно, чинить
-- нужно сам индекс, а не оставлять разное поведение каналов на волю случая.
--
-- Решение — COALESCE в самом индексе: для товара без вариантов
-- (product_variant_id IS NULL) все "пустые" варианты по-прежнему схлопываются
-- в одну строку (как и раньше — не даёт продублировать позицию без варианта),
-- а разные реальные варианты одного товара теперь физически разные строки.

BEGIN;

DROP INDEX IF EXISTS public.cart_items_bot_user_key_product_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS cart_items_bot_user_key_product_variant_key
  ON public.cart_items (
    bot_id,
    user_key,
    product_id,
    COALESCE(product_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
