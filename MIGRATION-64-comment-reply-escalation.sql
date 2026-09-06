-- ═══════════════════════════════════════════════════════════════════════════
-- Эскалация резервной отправки (MIGRATION-62): если и наш собственный
-- private-reply не прошёл, пробуем публичный ответ в комментариях тем же
-- проходом крона — другой вызов и другой scope у Zernio/Meta, поэтому может
-- пройти даже когда DM не проходит ни у родной автоматизации, ни у нашего
-- резерва (см. живой случай: публичный ответ ушёл, DM упал с 2534066).
--
-- comment_reply_status/comment_reply_error — тот же смысл, что у status/error
-- для private-reply в этой же строке, только про эскалацию:
--   null    — эскалация не нужна была (private-reply прошёл) или нечего
--             постить (в правиле не настроен commentReply)
--   skipped — Zernio уже сам отправил публичный ответ по этому комментарию
--             (видно в его логах) — дублировать не пытались
--   sent    — наша эскалация отправила публичный ответ
--   failed  — пытались, тоже не прошло — см. comment_reply_error
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.comment_dm_fallback_sends
  ADD COLUMN IF NOT EXISTS comment_reply_status TEXT
    CHECK (comment_reply_status IN ('skipped', 'sent', 'failed')),
  ADD COLUMN IF NOT EXISTS comment_reply_error TEXT;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
-- select column_name from information_schema.columns
--   where table_name = 'comment_dm_fallback_sends'
--   and column_name in ('comment_reply_status', 'comment_reply_error');
-- -- обе строки должны быть в ответе
-- ═══════════════════════════════════════════════════════════════════════════
