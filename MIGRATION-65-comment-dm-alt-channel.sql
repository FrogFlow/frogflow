-- ═══════════════════════════════════════════════════════════════════════════
-- Второй канал эскалации (после MIGRATION-64): если и наш private-reply не
-- прошёл, но у комментатора уже ЕСТЬ диалог с этим Instagram-аккаунтом
-- (bot_users.zernio_conversation_id по ig_<id> комментатора) — пробуем
-- отправить то же сообщение обычным inbox-сообщением в этот диалог, а не
-- через комментарий-специфичный private-reply. Это другой вызов Zernio
-- (POST /inbox/messages в существующий диалог, не привязан к comment ID
-- вообще), поэтому не наследует ограничение, из-за которого падает именно
-- private-reply к конкретному комментарию.
--
-- alt_channel_status/alt_channel_error — тот же смысл, что и у остальных
-- пар status/error в этой таблице:
--   skipped — у комментатора нет известного диалога (bot_users не нашёлся
--             или там нет zernio_conversation_id) — пробовать было не во что
--   sent    — сообщение ушло обычным inbox-путём
--   failed  — диалог был, но и это не прошло — см. alt_channel_error
--
-- Важно: публичный ответ (comment_reply_status, MIGRATION-64) теперь
-- отправляется только когда alt_channel_status = 'sent' — если ни один канал
-- реально не доставил DM, автоматически постить в комментарии текст,
-- который может утверждать "мы написали вам в директ", нельзя: это ложь на
-- живом посте клиента. Без доставленного DM эскалация сразу уходит
-- продавцу в Telegram.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.comment_dm_fallback_sends
  ADD COLUMN IF NOT EXISTS alt_channel_status TEXT
    CHECK (alt_channel_status IN ('skipped', 'sent', 'failed')),
  ADD COLUMN IF NOT EXISTS alt_channel_error TEXT;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
-- select column_name from information_schema.columns
--   where table_name = 'comment_dm_fallback_sends'
--   and column_name in ('alt_channel_status', 'alt_channel_error');
-- -- обе строки должны быть в ответе
-- ═══════════════════════════════════════════════════════════════════════════
