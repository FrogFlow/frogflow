-- ═══════════════════════════════════════════════════════════════════════════
-- Два ограничения на bots.status вместо одного — и из-за этого «Приостановить»
-- в панели не работало ни разу.
--
-- MIGRATION-08 добавила bots_status_check (active|paused|suspended), но
-- прежнее valid_status (active|paused|deleted) осталось. CHECK'и действуют
-- вместе, через И, поэтому в пересечении остались только active и paused:
--   UPDATE bots SET status='suspended' → violates check constraint "valid_status"
-- Панель показывала кнопку, показывала успех после перерисовки, а статус в
-- базе не менялся.
--
-- Заодно вводим архив. Он намеренно НЕ значение status: статус описывает, как
-- бот ведёт себя сейчас (отвечает, молчит, приостановлен), а архив — что
-- клиент больше не наш. Смешав их, мы потеряли бы возможность сказать, в
-- каком состоянии бот ушёл, и получили бы третий по счёту спор о том, какие
-- значения статуса допустимы.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Устаревшее ограничение: 'deleted' в коде не используется нигде, а
-- 'suspended' оно запрещает.
ALTER TABLE public.bots DROP CONSTRAINT IF EXISTS valid_status;

-- Оставляем одно, с тем набором, которым реально пользуется панель.
ALTER TABLE public.bots DROP CONSTRAINT IF EXISTS bots_status_check;
ALTER TABLE public.bots
  ADD CONSTRAINT bots_status_check CHECK (status IN ('active', 'paused', 'suspended'));

-- Архив: дата, а не флаг — «когда убрали» полезнее, чем «убрали ли».
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN public.bots.archived_at IS
  'Когда клиент убран из работы. Строка и его данные остаются: заказы, выгрузки и история платежей должны переживать уход клиента.';

-- Список клиентов почти всегда спрашивает только действующих.
CREATE INDEX IF NOT EXISTS idx_bots_archived_at ON public.bots(archived_at);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.bots'::regclass AND contype = 'c';
--   -- ожидается ОДИН констрейнт на status: active|paused|suspended
--
--   BEGIN;
--     UPDATE public.bots SET status = 'suspended' WHERE id = '<uuid>';
--   ROLLBACK;   -- теперь проходит
-- ═══════════════════════════════════════════════════════════════════════════
