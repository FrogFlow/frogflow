-- ═══════════════════════════════════════════════════════════════════════════
-- ФАЗА 6 (control-plane), часть 2 — статистика по клиентам для панели.
--
-- Закрывает остаток §8: заказов за месяц, дата последнего заказа, занятое
-- место в хранилище. То, ради чего панель открывают ежедневно.
--
-- ПРИНЦИП, которым определён состав: наружу отдаются ТОЛЬКО агрегаты —
-- COUNT, MAX(дата), SUM(байт). Ни одной строки с содержимым: ни названий
-- товаров, ни имён покупателей, ни сумм заказов. Оператору нужно знать, что
-- клиент жив и растёт, а не что он кому продаёт. Расширять этот список —
-- отдельное решение, а не «раз уж всё равно service_role».
--
-- Применять после MIGRATION-09.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.operator_bot_stats()
RETURNS TABLE (
  bot_id          uuid,
  orders_total    bigint,
  orders_30d      bigint,
  last_order_at   timestamptz,
  products_total  bigint,
  customers_total bigint,
  storage_bytes   bigint
)
LANGUAGE sql
STABLE
-- SECURITY DEFINER нужен ради storage.objects: владелец схемы storage —
-- служебная роль, и обычный SELECT оттуда недоступен даже service_role
-- через PostgREST.
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH paths AS (
    -- Одна и та же ссылка может встретиться дважды (материал продублирован в
    -- product_material_files), поэтому ниже DISTINCT: место на диске занято
    -- один раз, и считать его дважды нельзя.
    SELECT p.bot_id, 'product-files'::text AS bucket, p.file_path AS name
      FROM public.products p WHERE p.file_path IS NOT NULL
    UNION ALL
    SELECT p.bot_id, 'product-files', p.file_path_kz
      FROM public.products p WHERE p.file_path_kz IS NOT NULL
    UNION ALL
    SELECT m.bot_id, 'product-files', m.file_path
      FROM public.product_material_files m WHERE m.file_path IS NOT NULL
    UNION ALL
    SELECT i.bot_id, 'product-images', i.image_path
      FROM public.product_images i WHERE i.image_path IS NOT NULL
    UNION ALL
    SELECT o.bot_id, 'payment-proofs', o.payment_proof_path
      FROM public.orders o WHERE o.payment_proof_path IS NOT NULL
  ),
  storage_per_bot AS (
    SELECT d.bot_id, SUM(COALESCE((so.metadata->>'size')::bigint, 0)) AS bytes
    FROM (SELECT DISTINCT bot_id, bucket, name FROM paths) d
    -- LEFT JOIN намеренно: ссылка на удалённый файл не должна ронять весь
    -- отчёт, она просто ничего не весит.
    LEFT JOIN storage.objects so
      ON so.bucket_id = d.bucket AND so.name = d.name
    GROUP BY d.bot_id
  )
  SELECT
    b.id,
    (SELECT count(*) FROM public.orders o WHERE o.bot_id = b.id),
    (SELECT count(*) FROM public.orders o
      WHERE o.bot_id = b.id AND o.created_at > now() - interval '30 days'),
    (SELECT max(o.created_at) FROM public.orders o WHERE o.bot_id = b.id),
    (SELECT count(*) FROM public.products p WHERE p.bot_id = b.id),
    (SELECT count(*) FROM public.bot_users u WHERE u.bot_id = b.id),
    COALESCE(s.bytes, 0)
  FROM public.bots b
  LEFT JOIN storage_per_bot s ON s.bot_id = b.id;
$$;

-- ─── Права: закрыть всё, открыть только панели ────────────────────────────
-- Функция SECURITY DEFINER выполняется от владельца и обходит RLS, поэтому
-- право её вызвать = право видеть сводку по ВСЕМ клиентам. Раздача прав здесь
-- важнее самой функции.
--
-- Мало отозвать у PUBLIC. В проекте Supabase на схему public настроены
-- ALTER DEFAULT PRIVILEGES, выдающие EXECUTE ролям anon и authenticated —
-- новая функция получает их автоматически, и REVOKE FROM PUBLIC на них не
-- действует. `anon` — это роль публикуемого ключа, а он по замыслу лежит в
-- клиентском бандле (VITE_SUPABASE_PUBLISHABLE_KEY): без строчки ниже сводку
-- по всем клиентам мог бы получить любой, кто открыл сайт клиента.
-- Проверено: без REVOKE у anon и authenticated стоял EXECUTE.
--
-- tenant_bot отзывается отдельно — MIGRATION-02 выдавал ему EXECUTE на все
-- функции схемы разом.
REVOKE ALL ON FUNCTION public.operator_bot_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.operator_bot_stats() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.operator_bot_stats() FROM tenant_bot;
GRANT EXECUTE ON FUNCTION public.operator_bot_stats() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
-- 1. Панель (service_role) видит сводку по всем:
--      SELECT * FROM public.operator_bot_stats();
--
-- 2. Никто, кроме панели, вызвать не может. Список прав должен содержать
--    ровно service_role и postgres — ни anon, ни authenticated, ни tenant_bot:
--      SELECT grantee, privilege_type FROM information_schema.routine_privileges
--       WHERE routine_name = 'operator_bot_stats';
--
--    И на живой роли — должно быть «permission denied»:
--      SET LOCAL ROLE tenant_bot;
--      SET LOCAL request.jwt.claims = '{"role":"tenant_bot","bot_id":"<uuid>"}';
--      SELECT * FROM public.operator_bot_stats();
--      RESET ROLE;
--
-- 3. Сумма места по клиентам меньше общего объёма бакетов — разница это
--    осиротевшие файлы, на которые больше никто не ссылается:
--      SELECT pg_size_pretty(sum(storage_bytes)) FROM public.operator_bot_stats();
--      SELECT pg_size_pretty(sum((metadata->>'size')::bigint)) FROM storage.objects;
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- ДОБАВЛЕНО ПО ХОДУ: закрыть reset_orders_sequence.
--
-- Найдено при проверке прав на функцию выше. reset_orders_sequence —
-- SECURITY DEFINER, и EXECUTE на ней стоял у anon, authenticated и
-- tenant_bot. Роль anon соответствует публикуемому ключу, который по замыслу
-- лежит в браузерном бандле каждого клиента, то есть функцию мог вызвать
-- кто угодно, открывший сайт: POST /rest/v1/rpc/reset_orders_sequence.
--
-- Она делает setval на последовательности orders.id — общей для всех пяти
-- арендаторов. MIGRATION-README и CONSOLIDATION-PLAN §4 прямо запрещают её
-- вызывать: откат счётчика выдаёт номера, уже занятые другими клиентами.
-- В коде она не вызывается нигде (проверено).
--
-- Отзываем права, а не удаляем: обратимо одним GRANT, если вдруг понадобится
-- для ручной починки нумерации. Удалить её совсем — отдельное решение.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
REVOKE ALL ON FUNCTION public.reset_orders_sequence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_orders_sequence() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_orders_sequence() FROM tenant_bot;
COMMIT;

NOTIFY pgrst, 'reload schema';
