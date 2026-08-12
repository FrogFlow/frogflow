-- ═══════════════════════════════════════════════════════════════════════════
-- ФАЗА 5 — увеличение лимитов на размер файлов.
--
-- ⚠ СНАЧАЛА поднять общий лимит проекта, иначе значения ниже не подействуют:
--   Supabase → Settings → Storage → «Upload file size limit» → 200 MB
--   (лимит бакета не может превышать лимит проекта — он молча обрежется).
--
-- Бакеты общие для всех клиентов, поэтому изменение действует сразу на всех.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE storage.buckets SET file_size_limit = 209715200 WHERE id = 'product-files';        -- 200 МБ
UPDATE storage.buckets SET file_size_limit =  52428800 WHERE id = 'product-images';       --  50 МБ
UPDATE storage.buckets SET file_size_limit =  52428800 WHERE id = 'payment-proofs';       --  50 МБ
UPDATE storage.buckets SET file_size_limit =  52428800 WHERE id = 'broadcast-images';     --  50 МБ
UPDATE storage.buckets SET file_size_limit = 104857600 WHERE id = 'legal-docs';           -- 100 МБ
UPDATE storage.buckets SET file_size_limit = 209715200 WHERE id = 'instruction-videos';   -- 200 МБ
UPDATE storage.buckets SET file_size_limit = 104857600 WHERE id = 'instagram-media';      -- 100 МБ

-- Белые списки MIME убираем там, где они мешают: продавец загружает архивы,
-- PDF и картинки вперемешку, а Storage молча отклоняет неизвестный тип —
-- ошибка при этом нигде не всплывает.
UPDATE storage.buckets SET allowed_mime_types = NULL
WHERE id IN ('product-files', 'payment-proofs', 'legal-docs', 'instruction-videos');

COMMIT;

-- ─── Проверка ────────────────────────────────────────────────────────────
-- SELECT id, file_size_limit/1024/1024 AS mb, allowed_mime_types
-- FROM storage.buckets ORDER BY id;
--
-- Если mb остался прежним — не поднят общий лимит проекта (см. шапку файла).

-- ═══════════════════════════════════════════════════════════════════════════
-- ЧТО РЕАЛЬНО ДОЙДЁТ ДО ПОКУПАТЕЛЯ
--
-- Лимит бакета — это сколько можно ЗАГРУЗИТЬ в админке. Отдача через Telegram
-- ограничена самим Telegram, и обойти это нельзя:
--
--   до  10 МБ  — картинка приходит фото прямо в чат
--   до  50 МБ  — файл приходит вложением
--   свыше      — бот присылает ссылку на скачивание (файл не теряется)
--
-- 50 МБ — потолок облачного Bot API. Больше принимает только Local Bot API
-- на своём сервере; тогда порог поднимается переменной DELIVERY_MAX_FILE_MB.
-- ═══════════════════════════════════════════════════════════════════════════
