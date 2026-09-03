-- ═══════════════════════════════════════════════════════════════════════════
-- Счета на оплату подписки, выставляемые оператором владельцу бота через его
-- же бота — тем же приёмом, что и чек по заказу (payment-proof.server.ts,
-- bot.server.ts): владелец получает сообщение с суммой и реквизитами
-- ОПЕРАТОРА (не своими), присылает чек фото/документом в свой же бот,
-- оператор смотрит чек в панели и подтверждает — тогда платёж уходит в уже
-- существующий subscription_payments (addPayment, subscriptions.server.ts),
-- и subscription_expires_at пересчитывает существующий триггер MIGRATION-09.
-- Эта миграция не трогает subscription_payments вообще — только добавляет
-- слой "выставлено → чек прислан → подтверждено/отклонено" перед ним.
--
-- Применять после MIGRATION-09 (subscription_payments уже должна существовать).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Реквизиты оператора для выплат ────────────────────────────────────
-- Простой key-value, отдельный от app_settings: тот привязан к bot_id
-- (тенантский), а это платформенное — одна запись на всю панель оператора,
-- не на клиента. "payout_requisites" — единственный ожидаемый ключ сегодня,
-- но key/value вместо одной колонки на будущее (комиссия, реквизиты по
-- валютам и т.п.) не требует новой миграции под каждое такое поле.
CREATE TABLE IF NOT EXISTS public.operator_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Как и subscription_payments (MIGRATION-09): включённый RLS без единой
-- политики закрывает таблицу для tenant_bot начисто, а панель оператора
-- (без SUPABASE_TENANT_KEY, JWT-роль service_role) обходит RLS и видит всё.
-- Свои реквизиты выплат — не то, что должен прочитать ни один клиентский
-- деплой, даже если бы захотел: там та же переменная SUPABASE_SERVICE_ROLE_KEY,
-- что и у панели, но роль резолвится по tenant-JWT, а не по apikey.
GRANT ALL ON public.operator_settings TO service_role;
ALTER TABLE public.operator_settings ENABLE ROW LEVEL SECURITY;

-- ─── 2. Счета ──────────────────────────────────────────────────────────────
-- В отличие от subscription_payments (только подтверждённая история),
-- здесь — рабочий статус одного выставленного счёта от "отправлен" до
-- "оплачен"/"отклонён"/"отменён". requisites_snapshot — копия реквизитов
-- на момент выставления, а не живая ссылка на operator_settings: реквизиты
-- оператора могут смениться, а уже отправленный счёт должен помнить, что
-- именно видел владелец.
CREATE TABLE IF NOT EXISTS public.subscription_invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id              UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency            TEXT NOT NULL DEFAULT 'KZT',
  note                TEXT,
  requisites_snapshot TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent', 'proof_uploaded', 'paid', 'rejected', 'cancelled')),
  proof_path          TEXT,
  proof_uploaded_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          TEXT,
  confirmed_at        TIMESTAMPTZ,
  reject_reason       TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscription_invoices_bot_status
  ON public.subscription_invoices(bot_id, status);

-- tenant_bot — вопреки subscription_payments (закрыто начисто) — должен
-- уметь прочитать свой счёт (чтобы бот узнал, что фото от владельца — это
-- чек по счёту) и записать в него путь к чеку. Это не открывает клиенту
-- ничего финансово значимого: сам subscription_payments остаётся закрытым
-- как был, а "paid" здесь — рабочий статус для дашборда оператора, реальную
-- дату подписки по-прежнему двигает только confirmInvoice → addPayment
-- (requireOperator, отдельный вызов) → триггер MIGRATION-09.
ALTER TABLE public.subscription_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_sees_own_invoices ON public.subscription_invoices;
CREATE POLICY tenant_sees_own_invoices ON public.subscription_invoices
  FOR SELECT TO tenant_bot
  USING (bot_id = public.current_bot_id());

-- Только UPDATE — INSERT/DELETE намеренно не даём ни одной политикой:
-- счета заводит и отменяет только оператор (без SUPABASE_TENANT_KEY,
-- роль service_role, RLS не действует вовсе).
DROP POLICY IF EXISTS tenant_uploads_invoice_proof ON public.subscription_invoices;
CREATE POLICY tenant_uploads_invoice_proof ON public.subscription_invoices
  FOR UPDATE TO tenant_bot
  USING (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
-- 1. tenant_bot не видит operator_settings вовсе:
--      SET LOCAL ROLE tenant_bot;
--      SET LOCAL request.jwt.claims = '{"role":"tenant_bot","bot_id":"<uuid>"}';
--      SELECT count(*) FROM operator_settings;   -- 0
--
-- 2. tenant_bot видит и может обновить только свой счёт:
--      SELECT count(*) FROM subscription_invoices;                 -- только свои
--      UPDATE subscription_invoices SET status = 'proof_uploaded'
--        WHERE bot_id = '<свой uuid>';                             -- проходит
--      UPDATE subscription_invoices SET status = 'proof_uploaded'
--        WHERE bot_id = '<чужой uuid>';                            -- 0 строк
--      INSERT INTO subscription_invoices (bot_id, amount, requisites_snapshot)
--        VALUES ('<свой uuid>', 1000, 'x');                        -- 0 строк / ошибка
--      RESET ROLE;
--
-- 3. Панель оператора (без SUPABASE_TENANT_KEY) видит и пишет обе таблицы
--    без ограничений — обычным запросом supabaseAdmin, как и раньше.
-- ═══════════════════════════════════════════════════════════════════════════
