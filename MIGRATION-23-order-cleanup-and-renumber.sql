-- ═══════════════════════════════════════════════════════════════════════════
-- Ночная уборка заказов: удаление зависших «Ждёт подтверждения» старше 7 дней
-- + пересчёт order_no без пропусков (1..N на каждого клиента).
--
-- Зачем это здесь, а не в коде приложения (как cron рассылки/вебхука):
-- операция общая для всех арендаторов сразу, а деплой клиента работает под
-- ключом tenant_bot и видит только свою строку — писать кросс-тенантный cron
-- в приложении значило бы либо заводить отдельный сервисный деплой, либо
-- гонять service_role туда, где ему не место. pg_cron внутри Supabase решает
-- это без единой лишней строки в пяти клиентских проектах.
--
-- ── Что чистим ──
-- orders.status = 'awaiting_confirmation' («Ждёт подтверждения» в панели) —
-- покупатель прислал чек, но админ так и не подтвердил и не отклонил заказ
-- за 7 дней. order_items удаляются каскадом (order_items_order_id_fkey уже
-- ON DELETE CASCADE — проверено по живой схеме, отдельно чистить не нужно).
-- Не трогаем payment-proofs в Storage: чек более не нужен, но само файловое
-- хранилище отсюда не почистить SQL-функцией без pg_net; вес мал, не критично.
--
-- ── Пересчёт номеров ──
-- До этой миграции order_no был перманентным — MIGRATION-03 сознательно
-- выбрала счётчик вместо max()+1 именно чтобы номер никогда не переезжал.
-- Явное требование оператора: «у всех в админ-панели номер должен быть с 1
-- и до последнего у текущего автора» — то есть без дыр, которые множит любое
-- удаление (эта уборка, и ручное «Удалить» в /admin/orders). Значит номер
-- перестаёт быть перманентным идентификатором и становится позицией в
-- хронологическом списке заказов этого клиента.
--
-- Последствие, которое стоит понимать: если у покупателя A заказ #50, а
-- раньше нашего покупателя Б заказ #12 всё это время висел «Ждёт
-- подтверждения» и теперь удалён, заказ покупателя A на следующий день
-- станет #49. Это осознанный компромисс по прямому запросу — не побочный
-- эффект.
--
-- order_no физически не используется нигде, кроме отображения покупателю и
-- админу: платёж (Robokassa InvId), FK в order_items и callback_data кнопок
-- админа завязаны на orders.id, который renumber_orders не трогает. Поэтому
-- пересчёт безопасен для оплат и выдачи — переезжает только витринный номер.
--
-- Безопасно от гонки с новым заказом: сначала выталкиваем все order_no
-- бота на +1 000 000 000 (общая транзакция функции), потом присваиваем
-- 1..N по row_number(). order_counters.last_no всегда ≥ max(order_no)
-- когда-либо выданного (счётчик только растёт), значит count(*) заказов
-- бота всегда ≤ last_no — новый заказ, вставленный параллельно по старому
-- значению счётчика, физически не может получить номер из диапазона
-- [1..count(*)], в который мы переписываем существующие заказы.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.renumber_orders(p_bot_id uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  -- Фаза 1: временно уводим все номера бота вне диапазона 1..N, чтобы
  -- присвоение в фазе 2 не столкнулось с уникальным индексом (bot_id, order_no).
  UPDATE public.orders
  SET order_no = order_no + 1000000000
  WHERE bot_id = p_bot_id;

  -- Фаза 2: 1..N в хронологическом порядке — так же, как их видел бы
  -- покупатель, оформляя заказы один за другим.
  WITH ranked AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM public.orders
    WHERE bot_id = p_bot_id
  )
  UPDATE public.orders o
  SET order_no = ranked.rn
  FROM ranked
  WHERE o.id = ranked.id;

  SELECT count(*) INTO v_count FROM public.orders WHERE bot_id = p_bot_id;

  -- Следующий реальный заказ обязан продолжить именно с этого места, а не
  -- со старого (гораздо большего) значения счётчика.
  INSERT INTO public.order_counters (bot_id, last_no)
  VALUES (p_bot_id, v_count)
  ON CONFLICT (bot_id) DO UPDATE SET last_no = EXCLUDED.last_no;
END $$;

CREATE OR REPLACE FUNCTION public.nightly_orders_maintenance() RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  b record;
BEGIN
  DELETE FROM public.orders
  WHERE status = 'awaiting_confirmation'
    AND created_at < now() - interval '7 days';

  FOR b IN SELECT id FROM public.bots LOOP
    PERFORM public.renumber_orders(b.id);
  END LOOP;
END $$;

-- Обе функции — только для планировщика и ручного вызова из SQL Editor.
-- Без явного REVOKE Postgres выдаёт EXECUTE PUBLIC по умолчанию, а PostgREST
-- превращает это в открытый POST /rest/v1/rpc/... — то есть в возможность для
-- держателя anon-ключа (он лежит в браузерном бандле каждого клиента)
-- пересчитать номера или запустить чистку когда вздумается. RLS на orders и
-- order_counters всё равно ограничила бы это своим ботом при вызове под
-- tenant_bot, но это не повод оставлять функции открытыми — та же ошибка уже
-- ловилась на operator_bot_stats (MIGRATION-10) и increment_broadcast_counts.
REVOKE ALL ON FUNCTION public.renumber_orders(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renumber_orders(uuid) FROM anon, authenticated, tenant_bot;
REVOKE ALL ON FUNCTION public.nightly_orders_maintenance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nightly_orders_maintenance() FROM anon, authenticated, tenant_bot;

-- Ежедневно в 00:00 UTC — 05:00 по Asia/Almaty, до начала рабочего дня у
-- всех пяти клиентов и их покупателей.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nightly-orders-maintenance';
SELECT cron.schedule(
  'nightly-orders-maintenance',
  '0 0 * * *',
  $$SELECT public.nightly_orders_maintenance();$$
);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'nightly-orders-maintenance';
--
--   -- Разово, вручную, без ожидания ночи:
--   SELECT public.nightly_orders_maintenance();
--   SELECT bot_id, min(order_no), max(order_no), count(*) FROM public.orders GROUP BY bot_id;
--   -- ожидается: min=1, max=count(*) на каждого бота — без дыр
--
--   SELECT * FROM public.order_counters;
--   -- last_no должен совпасть с count(*) заказов того же бота
--
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--    WHERE routine_name IN ('renumber_orders', 'nightly_orders_maintenance');
--   -- ожидается: только postgres — без anon/authenticated/tenant_bot
-- ═══════════════════════════════════════════════════════════════════════════
