-- ═══════════════════════════════════════════════════════════════════════════
-- Резервная (fallback) отправка DM по комментарию — журнал попыток.
--
-- Контекст: Comment-to-DM у Zernio — правило, которое живёт целиком на их
-- стороне (см. историю инцидента: правило успешно отвечало сотни раз, потом
-- молча замолкало на конкретном посте, при этом остальные правила того же
-- аккаунта и сторонний инструмент клиента продолжали получать те же
-- комментарии — то есть дело не в Instagram, а в доставке срабатывания
-- конкретно у Zernio для этого поста). Наш собственный вебхук эти события не
-- получает вовсе (см. ZERNIO_WEBHOOK_EVENTS) — обнаружить обрыв можно только
-- активно сверяя реальные комментарии поста с логами автоматизации.
--
-- comment-dm-fallback.server.ts раз в 15 минут сверяет комментарии под
-- постами с per-post правилами и логами их срабатываний; если Zernio
-- комментарий не отработал, шлёт DM сам через тот же sendCommentPrivateReply,
-- что и ручная догоняющая рассылка в панели. Эта таблица — не список
-- комментариев (они не наши, читаются заново из Zernio каждый раз), а только
-- журнал: на какой (правило, комментарий) резервная отправка уже
-- предпринята — чтобы не пытаться дважды и не задваивать DM живому человеку
-- при каждом проходе крона. Строка вставляется до отправки (status='pending')
-- ИМЕННО чтобы уникальный индекс ниже был единственной защитой от повторной
-- отправки при гонке/перекрытии двух проходов крона, а не просто отметкой
-- постфактум.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.comment_dm_fallback_sends (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id            UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  automation_id     TEXT NOT NULL,
  platform_post_id  TEXT NOT NULL,
  comment_id        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'sent', 'failed')),
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (automation_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_dm_fallback_sends_automation
  ON public.comment_dm_fallback_sends(automation_id);

-- touch_updated_at() уже объявлена в MIGRATION-31.
CREATE TRIGGER trg_comment_dm_fallback_sends_touch BEFORE UPDATE
  ON public.comment_dm_fallback_sends
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Тот же приём, что и у остальных тенантских таблиц (MIGRATION-02):
-- tenant_bot видит и пишет только свои строки, bot_id на INSERT
-- принудительно берётся из JWT-претензии, а не из тела запроса.
ALTER TABLE public.comment_dm_fallback_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.comment_dm_fallback_sends;
CREATE POLICY tenant_isolation ON public.comment_dm_fallback_sends
  FOR ALL TO tenant_bot
  USING      (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

DROP TRIGGER IF EXISTS trg_force_bot_id ON public.comment_dm_fallback_sends;
CREATE TRIGGER trg_force_bot_id BEFORE INSERT ON public.comment_dm_fallback_sends
  FOR EACH ROW EXECUTE FUNCTION public.force_bot_id();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
-- tenant_bot видит и пишет только свои строки:
--   SET LOCAL ROLE tenant_bot;
--   SET LOCAL request.jwt.claims = '{"role":"tenant_bot","bot_id":"<свой uuid>"}';
--   INSERT INTO comment_dm_fallback_sends (automation_id, platform_post_id, comment_id)
--     VALUES ('a1', 'p1', 'c1');                                   -- проходит, bot_id проставлен триггером
--   SELECT count(*) FROM comment_dm_fallback_sends;                -- только свои
--   RESET ROLE;
--
-- Повторная вставка того же (automation_id, comment_id) — уже под своим ботом:
--   INSERT INTO comment_dm_fallback_sends (automation_id, platform_post_id, comment_id)
--     VALUES ('a1', 'p1', 'c1');                                   -- ошибка unique_violation (23505) — это и есть защита от повтора
-- ═══════════════════════════════════════════════════════════════════════════
