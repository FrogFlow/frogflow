-- ═══════════════════════════════════════════════════════════════════════════
-- subscription_invoices (MIGRATION-58) — политика tenant_uploads_invoice_proof
-- фильтрует UPDATE по bot_id (строка), но ничего не ограничивает по колонкам:
-- ALTER DEFAULT PRIVILEGES из MIGRATION-02 выдал tenant_bot GRANT UPDATE на
-- ВСЮ таблицу. Владелец бота (SUPABASE_TENANT_KEY в его собственном Vercel)
-- мог поставить SET amount = 1 своему же счёту до подтверждения — confirmInvoice
-- читает invoice.amount из базы и передаёт его в addPayment, то есть в
-- subscription_payments и в отчётность оператора попала бы сумма, которую
-- задал клиент, а не оператор. То же самое с requisites_snapshot (снимок
-- реквизитов на момент выставления счёта, который должен быть неизменным) и
-- со status (можно было выставить "paid" самому, минуя оператора — сам
-- статус здесь не двигает дату подписки, но путает дашборд оператора и
-- блокирует confirmInvoice/rejectInvoice терминальной проверкой).
--
-- Коду клиентского деплоя (bot.server.ts, приём чека) для собственной работы
-- нужно писать только status/proof_path/proof_uploaded_at — сужаем грант до
-- этих трёх колонок, RLS-политику по bot_id не трогаем.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE UPDATE ON public.subscription_invoices FROM tenant_bot;
GRANT UPDATE (status, proof_path, proof_uploaded_at)
  ON public.subscription_invoices TO tenant_bot;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--
-- tenant_bot по-прежнему может привязать чек к своему счёту:
--   SET LOCAL ROLE tenant_bot;
--   SET LOCAL request.jwt.claims = '{"role":"tenant_bot","bot_id":"<свой uuid>"}';
--   UPDATE subscription_invoices SET status='proof_uploaded', proof_path='x'
--     WHERE id = '<свой счёт>';                          -- проходит
--
-- Но не может изменить сумму/реквизиты/статус в обход оператора:
--   UPDATE subscription_invoices SET amount = 1 WHERE id = '<свой счёт>';
--     -- ошибка: permission denied for column amount
--   RESET ROLE;
-- ═══════════════════════════════════════════════════════════════════════════
