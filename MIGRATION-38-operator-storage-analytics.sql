-- Exact Storage usage for the operator dashboard.
-- Every tenant-owned object is stored under the bot UUID prefix, so this
-- counts what actually occupies Supabase Storage rather than only files that
-- are still referenced by application rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.operator_storage_usage()
RETURNS TABLE (
  bot_id uuid,
  storage_kind text,
  storage_bytes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH objects AS (
    SELECT
      b.id AS matched_bot_id,
      CASE so.bucket_id
        WHEN 'product-files' THEN 'Материалы'
        WHEN 'product-images' THEN 'Фото товаров'
        WHEN 'payment-proofs' THEN 'Чеки оплаты'
        WHEN 'instruction-videos' THEN 'Видео-инструкции'
        WHEN 'legal-docs' THEN 'Документы'
        WHEN 'broadcast-images' THEN 'Изображения рассылок'
        ELSE 'Прочие файлы'
      END AS kind,
      COALESCE((so.metadata->>'size')::bigint, 0) AS bytes
    FROM storage.objects so
    LEFT JOIN public.bots b ON so.name LIKE b.id::text || '/%'
  )
  SELECT matched_bot_id, kind, SUM(bytes)::bigint
  FROM objects
  GROUP BY matched_bot_id, kind;
$$;

REVOKE ALL ON FUNCTION public.operator_storage_usage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.operator_storage_usage() FROM anon, authenticated, tenant_bot;
GRANT EXECUTE ON FUNCTION public.operator_storage_usage() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
