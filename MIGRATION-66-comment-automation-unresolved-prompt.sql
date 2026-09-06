-- ═══════════════════════════════════════════════════════════════════════════
-- Настройка на правило Comment-to-DM: если резервная отправка испробовала
-- все автоматические пути (private-reply, альт-канал, HUMAN_AGENT) и ни один
-- не доставил DM — вместо тишины публикуем публичный ответ с просьбой
-- написать в директ первым. Публичный ответ работает всегда независимо от
-- private-reply (другой вызов/scope у Zernio/Meta) — единственный канал,
-- который гарантированно доходит до человека, когда всё остальное упало.
--
-- Настройка не в Zernio (у их автоматизации нет такого поля и не может быть —
-- это наша логика, не их), поэтому платформенная таблица здесь не годится:
-- это данные КЛИЕНТА (продавца), редактируются из его /admin/instagram, той
-- же RLS-моделью, что и остальные тенантские таблицы (tenant_bot по
-- current_bot_id()) — не MIGRATION-58/62/63 паттерн (те платформенные, видны
-- только панели оператора).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.comment_automation_settings (
  bot_id                     UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  automation_id              TEXT NOT NULL,
  unresolved_prompt_enabled  BOOLEAN NOT NULL DEFAULT false,
  unresolved_prompt_message  TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, automation_id)
);

ALTER TABLE public.comment_automation_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_manages_own_automation_settings ON public.comment_automation_settings;
CREATE POLICY tenant_manages_own_automation_settings ON public.comment_automation_settings
  FOR ALL TO tenant_bot
  USING (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

GRANT ALL ON public.comment_automation_settings TO service_role;

-- Слежение за этим третьим (после private-reply и comment_reply) публичным
-- сообщением — тот же приём, что alt_channel_status/comment_reply_status
-- в MIGRATION-64/65: null, пока не понадобилось; 'skipped', если настройка
-- выключена или сообщение пустое; 'sent'/'failed' — попытка была.
ALTER TABLE public.comment_dm_fallback_sends
  ADD COLUMN IF NOT EXISTS unresolved_prompt_status TEXT
    CHECK (unresolved_prompt_status IN ('skipped', 'sent', 'failed')),
  ADD COLUMN IF NOT EXISTS unresolved_prompt_error TEXT;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
-- 1. tenant_bot видит и правит только свои настройки:
--      SET LOCAL ROLE tenant_bot;
--      SET LOCAL request.jwt.claims = '{"role":"tenant_bot","bot_id":"<uuid>"}';
--      SELECT count(*) FROM comment_automation_settings;                 -- только свои
--      INSERT INTO comment_automation_settings (bot_id, automation_id)
--        VALUES ('<чужой uuid>', 'x');                                   -- 0 строк / ошибка
--      RESET ROLE;
--
-- 2. select column_name from information_schema.columns
--      where table_name = 'comment_dm_fallback_sends'
--      and column_name in ('unresolved_prompt_status', 'unresolved_prompt_error');
--    -- обе строки должны быть в ответе
-- ═══════════════════════════════════════════════════════════════════════════
