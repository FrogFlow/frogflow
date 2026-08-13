-- ═══════════════════════════════════════════════════════════════════════════
-- ФАЗА 7 — функция поиска товаров search_products.
--
-- Её вызывают боты saltanat и razvivashka, но в общей базе её нет: она жила
-- только в отдельных базах клиентов и при переезде не поехала. Код ошибку RPC
-- не проверяет (`const { data } = await s.rpc(...)`), поэтому вместо сбоя бот
-- молча отвечает «Ничего не нашлось» на любой запрос. У saltanat поиск не
-- работает с самого переезда.
--
-- Отличия от исходной версии:
--   • category_ids здесь jsonb, а не uuid[];
--   • добавлен фильтр по арендатору — без него поиск возвращал бы товары всех
--     клиентов сразу;
--   • некорректный поисковый запрос больше не роняет функцию.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.search_products(search_query text)
RETURNS TABLE (
  id             uuid,
  category_id    uuid,
  category_ids   jsonb,
  name           text,
  description    text,
  keywords       text,
  price          numeric,
  currency       text,
  country_prices jsonb,
  file_path      text,
  file_name      text,
  file_path_kz   text,
  file_name_kz   text,
  is_active      boolean,
  sort_order     int,
  created_at     timestamptz,
  product_images jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  q tsquery;
  b uuid := public.current_bot_id();
BEGIN
  -- Покупатель пишет в поиск что угодно: «скидка!», «2:1», пустую строку.
  -- to_tsquery на таком падает с ошибкой, а падение RPC бот показать не умеет.
  BEGIN
    q := to_tsquery('simple', search_query);
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  RETURN QUERY
  SELECT
    p.id, p.category_id, p.category_ids, p.name, p.description, p.keywords,
    p.price, p.currency, p.country_prices, p.file_path, p.file_name,
    p.file_path_kz, p.file_name_kz, p.is_active, p.sort_order, p.created_at,
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object('image_path', pi.image_path, 'sort_order', pi.sort_order)
                ORDER BY pi.sort_order)
       FROM public.product_images pi
       WHERE pi.product_id = p.id),
      '[]'::jsonb
    ) AS product_images
  FROM public.products p
  WHERE p.is_active = true
    -- Арендатор берётся из claim'а подключения. Под service_role он NULL, и
    -- сравнение не даёт ни одной строки — то есть функция закрыта по умолчанию
    -- и не может отдать чужой каталог даже в обход RLS.
    AND p.bot_id = b
    AND to_tsvector('simple',
          p.name || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(p.keywords, '')
        ) @@ q
  ORDER BY p.name
  LIMIT 30;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_products(text) TO tenant_bot, service_role;

COMMIT;

-- ─── Проверка ────────────────────────────────────────────────────────────
-- Под service_role вернёт 0 строк — это ожидаемо (bot_id не определён).
-- Настоящая проверка — из бота: отправить слово из названия товара в поиск.
