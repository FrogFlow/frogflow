-- ═══════════════════════════════════════════════════════════════════════════
-- orders.payment_proof_hash — SHA-256 картинки чека, для проверки на повтор
-- (Блок A.4, кейс 2, раунд 2).
--
-- До этой миграции ничего не мешало прислать один и тот же чек (настоящий
-- или поддельный) на несколько разных заказов: сумма и маркеры платежа
-- сверяются с текстом чека (receipt-verify.server.ts), а сам чек нигде не
-- запоминается. Теперь при успешной сверке хеш байтов картинки пишется в
-- заказ, и следующая проверка (findReceiptReuse) отказывает в автовыдаче,
-- если тот же хеш уже стоит у другого заказа этого арендатора.
--
-- Только добавляет колонку и частичный индекс — ничего не удаляет, ничего
-- не блокирует надолго. RLS уже действует на уровне строки, отдельных
-- политик под новую колонку не нужно.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_proof_hash TEXT;

COMMENT ON COLUMN public.orders.payment_proof_hash IS
  'SHA-256 картинки чека, записывается при успешной OCR-сверке. Пусто у заказов без автопроверки или оформленных до этой миграции.';

-- Частичный: колонка пустая у подавляющего большинства строк (только
-- заказы, прошедшие OCR-автовыдачу, её заполняют) — полный индекс на всю
-- таблицу был бы избыточен.
CREATE INDEX IF NOT EXISTS idx_orders_bot_proof_hash
  ON public.orders (bot_id, payment_proof_hash)
  WHERE payment_proof_hash IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'orders'
--     AND column_name = 'payment_proof_hash';
--
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname = 'public' AND indexname = 'idx_orders_bot_proof_hash';
-- ═══════════════════════════════════════════════════════════════════════════
