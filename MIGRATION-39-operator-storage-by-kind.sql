-- Per-client storage breakdown by file kind, for the operator dashboard's
-- storage donuts (main page: % of the DB per client + free space; each
-- client's own card: split by file purpose).
--
-- Same methodology as operator_bot_stats() (MIGRATION-10) — count only
-- files a live application row still references (products/product_material_files/
-- product_images/orders), not every object physically sitting in the bucket.
-- That keeps this function's per-bot totals, summed across kinds, equal to
-- operator_bot_stats().storage_bytes for the same bot: the dashboard would
-- otherwise show two different "storage used" numbers for one client.
--
-- Same 3-bucket coverage as operator_bot_stats() too (product-files,
-- product-images, payment-proofs) — legal-docs/instruction-videos/
-- broadcast-images aren't in either function yet; extending both to cover
-- them is separate work, not something to do half in just one of the two.
--
-- Apply after MIGRATION-10.

BEGIN;

CREATE OR REPLACE FUNCTION public.operator_storage_by_kind()
RETURNS TABLE (
  bot_id        uuid,
  storage_kind  text,
  storage_bytes bigint
)
LANGUAGE sql
STABLE
-- SECURITY DEFINER нужен ради storage.objects — та же причина, что и в
-- operator_bot_stats().
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH paths AS (
    SELECT p.bot_id, 'product-files'::text AS bucket, 'Материалы'::text AS kind, p.file_path AS name
      FROM public.products p WHERE p.file_path IS NOT NULL
    UNION ALL
    SELECT p.bot_id, 'product-files', 'Материалы', p.file_path_kz
      FROM public.products p WHERE p.file_path_kz IS NOT NULL
    UNION ALL
    SELECT m.bot_id, 'product-files', 'Материалы', m.file_path
      FROM public.product_material_files m WHERE m.file_path IS NOT NULL
    UNION ALL
    SELECT i.bot_id, 'product-images', 'Фото товаров', i.image_path
      FROM public.product_images i WHERE i.image_path IS NOT NULL
    UNION ALL
    SELECT o.bot_id, 'payment-proofs', 'Чеки оплаты', o.payment_proof_path
      FROM public.orders o WHERE o.payment_proof_path IS NOT NULL
  ),
  -- Та же ссылка может встретиться дважды в пределах одного вида (материал
  -- продублирован в product_material_files) — без DISTINCT посчитали бы её
  -- вес дважды.
  distinct_paths AS (
    SELECT DISTINCT bot_id, bucket, kind, name FROM paths
  )
  SELECT d.bot_id, d.kind, SUM(COALESCE((so.metadata->>'size')::bigint, 0))::bigint
  FROM distinct_paths d
  -- LEFT JOIN намеренно: ссылка на удалённый файл не должна ронять отчёт.
  LEFT JOIN storage.objects so ON so.bucket_id = d.bucket AND so.name = d.name
  GROUP BY d.bot_id, d.kind;
$$;

REVOKE ALL ON FUNCTION public.operator_storage_by_kind() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.operator_storage_by_kind() FROM anon, authenticated, tenant_bot;
GRANT EXECUTE ON FUNCTION public.operator_storage_by_kind() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
-- Сумма по видам для каждого bot_id должна совпасть со storage_bytes из
-- operator_bot_stats() для того же клиента:
--   SELECT bot_id, SUM(storage_bytes) FROM public.operator_storage_by_kind() GROUP BY bot_id;
--   SELECT bot_id, storage_bytes FROM public.operator_bot_stats();
-- ═══════════════════════════════════════════════════════════════════════════
