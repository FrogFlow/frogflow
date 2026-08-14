-- ═══════════════════════════════════════════════════════════════════════════
-- increment_broadcast_counts — RPC, которую код вызывает с самого переезда,
-- а в общей базе её нет (открытый хвост из CONSOLIDATION-PLAN §5).
--
-- Молчаливой поломки нет: в broadcast.server.ts стоит запасной путь
-- read-then-write, и счётчики обновляются. Но это гонка — две партии рассылки,
-- завершившиеся одновременно, прочитают одно и то же значение, и одна из них
-- затрёт результат другой. На больших базах, где партий много, счётчик
-- «отправлено» тихо отстаёт от факта.
--
-- Атомарный UPDATE ... SET x = x + n такой гонки не имеет.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.increment_broadcast_counts(
  p_broadcast_id uuid,
  p_sent    int DEFAULT 0,
  p_failed  int DEFAULT 0,
  p_blocked int DEFAULT 0
) RETURNS void
LANGUAGE sql
-- SECURITY INVOKER: рассылка принадлежит арендатору, и RLS на broadcasts
-- должна действовать. Под ключом арендатора чужую рассылку этот UPDATE просто
-- не найдёт.
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.broadcasts
  SET sent_count    = sent_count    + COALESCE(p_sent, 0),
      failed_count  = failed_count  + COALESCE(p_failed, 0),
      blocked_count = blocked_count + COALESCE(p_blocked, 0)
  WHERE id = p_broadcast_id;
$$;

-- Функцию вызывает деплой клиента, значит tenant_bot нужен EXECUTE. Роли
-- anon и authenticated получают его от настроек проекта автоматически —
-- отзываем: рассылки не то, чем управляют из браузера покупателя.
REVOKE ALL ON FUNCTION public.increment_broadcast_counts(uuid, int, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_broadcast_counts(uuid, int, int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_broadcast_counts(uuid, int, int, int) TO service_role, tenant_bot;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT increment_broadcast_counts('<uuid рассылки>', 1, 0, 0);
--   SELECT sent_count FROM broadcasts WHERE id = '<uuid>';   -- на 1 больше
--
--   SELECT grantee FROM information_schema.routine_privileges
--    WHERE routine_name = 'increment_broadcast_counts';
--   -- ожидается: service_role, tenant_bot, postgres — без anon/authenticated
-- ═══════════════════════════════════════════════════════════════════════════
