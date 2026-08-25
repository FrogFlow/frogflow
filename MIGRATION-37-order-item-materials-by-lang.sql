-- MIGRATION-37: multi-language product materials (en/ru/kk/uz) instead of
-- the hardcoded ru/kz pair.
--
-- 1. product_material_files.language used the literal string "kz" for
--    Kazakh; the bot's Locale type has always been "kk" (see src/lib/i18n.ts).
--    materialsForProduct()/materialsForOrderItem() now key their kk branch
--    off "kk", so live rows must be renamed in lockstep with that code
--    change or Kazakh-language deliveries break silently.
-- 2. order_items.delivered_language got the same "kz" values from the old
--    lang_kz: callback — rename those too so parseDeliveredLanguages() (which
--    now expects "kk") keeps recognising already-delivered Kazakh files.
-- 3. order_items gets one JSONB column, material_files_by_lang, holding the
--    snapshot for every language at once ({ "ru": [...], "kk": [...], ... }).
--    It replaces material_files_snapshot/material_files_kz_snapshot as the
--    primary source for delivery going forward; those two columns are left
--    in place (still populated for ru/kk) for older tooling and are also
--    backfilled into the new column here for every existing order.
-- 4. product_material_files.language carries a live CHECK constraint left
--    over from the original ru/kz-only implementation. It must be widened
--    before the "kz" → "kk" rename below, or step 1 is rejected outright.
--    Drop+recreate (not just drop) so the column stays constrained to the
--    4 languages the bot actually supports today.

BEGIN;

ALTER TABLE public.product_material_files
  DROP CONSTRAINT IF EXISTS product_material_files_language_check;

UPDATE public.product_material_files SET language = 'kk' WHERE language = 'kz';

ALTER TABLE public.product_material_files
  ADD CONSTRAINT product_material_files_language_check
  CHECK (language IN ('ru', 'kk', 'en', 'uz'));

UPDATE public.order_items SET delivered_language = 'kk' WHERE delivered_language = 'kz';

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS material_files_by_lang JSONB;

UPDATE public.order_items
SET material_files_by_lang =
  (CASE
     WHEN jsonb_array_length(COALESCE(material_files_snapshot, '[]'::jsonb)) > 0
     THEN jsonb_build_object('ru', material_files_snapshot)
     ELSE '{}'::jsonb
   END)
  ||
  (CASE
     WHEN jsonb_array_length(COALESCE(material_files_kz_snapshot, '[]'::jsonb)) > 0
     THEN jsonb_build_object('kk', material_files_kz_snapshot)
     ELSE '{}'::jsonb
   END)
WHERE material_files_by_lang IS NULL;

UPDATE public.order_items SET material_files_by_lang = '{}'::jsonb WHERE material_files_by_lang IS NULL;

ALTER TABLE public.order_items ALTER COLUMN material_files_by_lang SET DEFAULT '{}'::jsonb;
ALTER TABLE public.order_items ALTER COLUMN material_files_by_lang SET NOT NULL;

COMMENT ON COLUMN public.order_items.material_files_by_lang IS
  'Снимок материалов заказа по всем языкам сразу ({"ru":[...],"kk":[...],...}) — источник истины для выдачи начиная с MIGRATION-37. material_files_snapshot/material_files_kz_snapshot остаются для старых заказов и совместимости.';

COMMIT;
