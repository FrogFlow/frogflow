-- ═══════════════════════════════════════════════════════════════════════════
-- ФАЗА 4 — переводит уникальность на «в пределах одного бота».
--
-- ПРИМЕНЯТЬ ПОСЛЕ ФАЗЫ 2, ДО ПЕРЕНОСА ВТОРОГО КЛИЕНТА.
--
-- Пока клиент один, глобальные уникальные индексы не мешают. Как только в базе
-- появляется второй бот, они начинают запрещать законные ситуации: например,
-- idx_bot_users_telegram_id_unique не даёт одному человеку в Telegram быть
-- покупателем у двух разных клиентов.
--
-- Здесь каждый такой индекс пересоздаётся с bot_id в начале: уникальность
-- сохраняется, но действует внутри бота, а не на всю базу. Первичные ключи не
-- трогаются — они уже составные (Фаза 2).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  r          RECORD;
  cols       TEXT;
  new_name   TEXT;
BEGIN
  FOR r IN
    SELECT
      i.indexrelid::regclass::text AS idx_name,
      t.oid                         AS tbl_oid,
      t.relname                     AS tbl_name,
      i.indexrelid                  AS idx_oid,
      pg_get_indexdef(i.indexrelid) AS idx_def
    FROM pg_index i
    JOIN pg_class     t  ON t.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
    WHERE ns.nspname = 'public'
      AND i.indisunique
      AND NOT i.indisprimary
      -- только таблицы, разделённые по арендаторам
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = t.oid AND a.attname = 'bot_id' AND a.attnum > 0 AND NOT a.attisdropped
      )
      -- и только те индексы, где bot_id ещё НЕ участвует
      AND NOT EXISTS (
        SELECT 1 FROM unnest(i.indkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE a.attname = 'bot_id'
      )
  LOOP
    -- список колонок индекса в исходном порядке
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord)
      INTO cols
    FROM unnest((SELECT indkey FROM pg_index WHERE indexrelid = r.idx_oid))
         WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = r.tbl_oid AND a.attnum = k.attnum;

    IF cols IS NULL THEN
      RAISE NOTICE 'Пропущен % — индекс по выражению, пересоздать вручную', r.idx_name;
      CONTINUE;
    END IF;

    new_name := r.tbl_name || '_bot_' || replace(replace(cols, ', ', '_'), '"', '') || '_key';

    RAISE NOTICE 'Переношу % (%) → уникальность в пределах бота', r.idx_name, cols;

    EXECUTE format('DROP INDEX IF EXISTS %s', r.idx_name);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (bot_id, %s)',
                   left(new_name, 63), r.tbl_name, cols);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── Проверка ────────────────────────────────────────────────────────────
-- Должно вернуть 0 строк: уникальных индексов без bot_id на разделяемых
-- таблицах не остаётся.
--
-- SELECT i.indexrelid::regclass AS остался
-- FROM pg_index i
-- JOIN pg_class t ON t.oid = i.indrelid
-- JOIN pg_namespace ns ON ns.oid = t.relnamespace
-- WHERE ns.nspname='public' AND i.indisunique AND NOT i.indisprimary
--   AND EXISTS (SELECT 1 FROM pg_attribute a
--               WHERE a.attrelid=t.oid AND a.attname='bot_id' AND a.attnum>0 AND NOT a.attisdropped)
--   AND NOT EXISTS (SELECT 1 FROM unnest(i.indkey) k(attnum)
--                   JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
--                   WHERE a.attname='bot_id');
