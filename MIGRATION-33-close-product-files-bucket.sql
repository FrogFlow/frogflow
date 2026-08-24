-- ═══════════════════════════════════════════════════════════════════════════
-- Закрыть бакет product-files — и зафиксировать это в репозитории.
--
-- product-files хранит оплаченные материалы. По словам предыдущего аудита
-- (ANALYSIS.md) бакет когда-то был закрыт вручную через дашборд Supabase —
-- нигде в репозитории это решение не записано ни миграцией, ни кодом. Эта
-- миграция — не повтор, а первая запись факта: она безопасна независимо от
-- текущего состояния (если бакет уже приватный — no-op).
--
-- Опаснее другое: bootstrap-скрипты (setup-storage.sql, COMPLETE-SETUP.sql,
-- setup-rls-policies.sql) всё ещё создавали бакет `public: true` и вешали
-- безусловную политику "Public Read product-files". Повторный прогон
-- setup-rls-policies.sql на живом проекте — по любой причине, хоть
-- по ошибке — молча открыл бы бакет заново. Все три скрипта поправлены тем
-- же коммитом, что и эта миграция.
--
-- Доступ к файлам не меняется: и админка, и бот всегда ходили через
-- createSignedUrl под service_role (orders.server.ts) — signed URL работает
-- независимо от публичности бакета, RLS на service_role не действует вовсе.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE storage.buckets SET public = false WHERE id = 'product-files';
DROP POLICY IF EXISTS "Public Read product-files" ON storage.objects;

COMMIT;

-- ─── Проверка после применения ────────────────────────────────────────────
-- Анонимным ключом (SUPABASE_PUBLISHABLE_KEY, без сервисной роли):
--   POST /storage/v1/object/list/product-files          → пусто/403
--   GET  /storage/v1/object/public/product-files/<путь>  → 400
-- Подписанные ссылки продолжают работать как раньше — createSignedUrl
-- вызывается под service_role, публичность бакета на него не влияет.
-- Выдача заказов (deliverOrder / deliverOrderByEmail / deliverOrderToWhatsApp
-- в orders.server.ts) не меняется вовсе.
