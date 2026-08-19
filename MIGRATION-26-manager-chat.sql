-- ═══════════════════════════════════════════════════════════════════════════
-- manager_chat_state / manager_chat_messages — модуль «Чат с менеджером»
-- (registry.ts: manager_chat, группа «Сервис», переходит из planned в
-- available вместе с этой миграцией).
--
-- Идея: у бота есть список текущих переписок с клиентами. Админ открывает
-- /admin/manager-chat, видит переписку (включая автоответы бота — они
-- логируются централизованно внутри tg() в telegram.server.ts, см. правки
-- там же), нажимает «Подключиться к диалогу» — bot.server.ts перестаёт
-- автоматически отвечать этому telegram_id, ответы админа уходят через тот
-- же tg("sendMessage", ...), что и обычные автоответы, то есть от имени
-- бота. «Завершить диалог» возвращает клиента под автоматику.
--
-- Две таблицы, а не одна:
--   manager_chat_state    — «последнее состояние» на пару (bot_id,
--                            telegram_id): подключён ли сейчас менеджер,
--                            когда было последнее сообщение и какое, сколько
--                            непрочитанных. На ней строится список диалогов
--                            в панели без агрегации полного лога на каждый
--                            рендер списка — и по ней же bot.server.ts
--                            дешёвым PK-lookup'ом решает, обрывать ли
--                            автоответ (тот же приём, что replyIfBlocked уже
--                            делает через blocked_users).
--   manager_chat_messages — полный лог реплик (клиент/бот/менеджер) для
--                            окна переписки справа.
--
-- Тот же tenant-isolation паттерн, что и во всех таблицах начиная с
-- MIGRATION-01/MIGRATION-22: bot_id NOT NULL REFERENCES bots(id), RLS,
-- политика tenant_isolation по current_bot_id(). service_role (панель
-- оператора, если когда-нибудь понадобится) проходит мимо RLS так же, как
-- уже проходит мимо admin_login_attempts и module_requests — без отдельного
-- GRANT.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.manager_chat_state (
  bot_id                  UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  telegram_id             BIGINT NOT NULL,
  active                  BOOLEAN NOT NULL DEFAULT false,
  connected_at            TIMESTAMPTZ,
  last_message_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_preview    TEXT,
  last_message_direction  TEXT CHECK (last_message_direction IN ('in', 'out')),
  unread_count            INT NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_manager_chat_state_bot_last_message
  ON public.manager_chat_state(bot_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.manager_chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id      UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sender      TEXT NOT NULL CHECK (sender IN ('customer', 'bot', 'manager')),
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manager_chat_messages_thread
  ON public.manager_chat_messages(bot_id, telegram_id, created_at);

ALTER TABLE public.manager_chat_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.manager_chat_state
  FOR ALL
  USING      (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

CREATE POLICY tenant_isolation ON public.manager_chat_messages
  FOR ALL
  USING      (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

-- Атомарный upsert+инкремент. Обычный клиентский upsert не умеет
-- «unread_count = unread_count + 1» без гонки чтение-изменение-запись —
-- этой функцией закрывается ровно тот же класс проблемы, что уже решён
-- increment_broadcast_counts (MIGRATION-11) для счётчиков рассылки.
-- Вызывается из bot.server.ts под tenant_bot на каждое входящее/исходящее
-- сообщение — поэтому EXECUTE даётся tenant_bot явно, а не оставляется
-- на усмотрение PUBLIC-грантов по умолчанию.
CREATE OR REPLACE FUNCTION public.manager_chat_touch(
  p_bot_id uuid,
  p_telegram_id bigint,
  p_direction text,
  p_sender text,
  p_preview text
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.manager_chat_state
    (bot_id, telegram_id, last_message_at, last_message_preview, last_message_direction, unread_count)
  VALUES
    (p_bot_id, p_telegram_id, now(), p_preview, p_direction,
     CASE WHEN p_sender = 'customer' THEN 1 ELSE 0 END)
  ON CONFLICT (bot_id, telegram_id) DO UPDATE SET
    last_message_at        = now(),
    last_message_preview   = p_preview,
    last_message_direction = p_direction,
    unread_count = public.manager_chat_state.unread_count
      + CASE WHEN p_sender = 'customer' THEN 1 ELSE 0 END;
END $$;

REVOKE ALL ON FUNCTION public.manager_chat_touch(uuid, bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manager_chat_touch(uuid, bigint, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_chat_touch(uuid, bigint, text, text, text) TO tenant_bot, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT relrowsecurity FROM pg_class
--    WHERE relname IN ('manager_chat_state', 'manager_chat_messages');
--   -- ожидается: t, t
--
--   SELECT tablename, policyname FROM pg_policies
--    WHERE tablename IN ('manager_chat_state', 'manager_chat_messages');
--   -- ожидается: по одной tenant_isolation на каждую таблицу
--
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--    WHERE routine_name = 'manager_chat_touch';
--   -- ожидается: tenant_bot, service_role, postgres — без anon/authenticated
-- ═══════════════════════════════════════════════════════════════════════════
