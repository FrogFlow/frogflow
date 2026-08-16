-- ═══════════════════════════════════════════════════════════════════════════
-- Бэкфилл bots.modules до канонических 35 ключей реестра.
--
-- Почему это надо сделать заранее, а не «когда понадобится». loadModules()
-- в src/lib/modules/modules.server.ts читает флаг так:
--
--     result[key] = modules?.[key] === true;
--
-- То есть ключа нет в строке — модуль выключен. Сейчас у пяти живых клиентов
-- в modules лежит 14 ключей из 35, и это никого не трогает ровно потому, что
-- гардов на недостающие модули пока нет: флаг никто не читает. Но в тот день,
-- когда кто-то добросовестно допишет requireModule("excel_export"), базовая
-- функция молча пропадёт у всех пятерых сразу — ровно тот сценарий, о котором
-- предупреждает CONTROL-PLANE-PLAN.md («каждое расхождение станет пропавшей
-- функцией у живого клиента»).
--
-- Поэтому: сначала база описывает действительность, потом появляются замки.
--
-- Значения расставлены так:
--
-- * 18 недостающих ключей со статусом planned — false. Кода за ними нет,
--   включать нечего.
-- * order_status и excel_export — true. В реестре это группа «База» с
--   price: null, то есть входит в каждый продукт без доплаты, и сегодня они
--   у всех работают (гарда нет). true здесь сохраняет текущее поведение;
--   false — единственный вариант, который его изменил бы.
-- * multi_language — по факту использования, а не на глаз. Модуль платный
--   (16 000 ₸), поэтому включать всем нельзя, но и выключить оплаченное
--   нельзя тоже. Считали по казахским версиям материалов:
--       Educational Bot  — 123 товара из 376 + kz-версии          → true
--       DID 02           — 10 товаров из 41 и 2 материала на kz   → true
--       Print KZ Art, Развивашка, SALTANAT — ни одного kz-товара  → false
--
-- Существующие значения не перезаписываются: defaults || modules — правый
-- операнд jsonb-конкатенации выигрывает, поэтому уже проставленные флаги
-- остаются как есть, а дописываются только отсутствующие ключи.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Шаг 1. Дописать все недостающие ключи как false, не трогая существующие.
WITH canon(key) AS (
  SELECT unnest(ARRAY[
    'shop', 'broadcasts', 'multi_files', 'order_status', 'excel_export',
    'legal_docs', 'robokassa', 'receipt_ocr', 'telegram_stars', 'coupons',
    'upsell', 'quiz', 'multi_currency', 'multi_language', 'vip', 'blocked',
    'courses', 'instagram', 'dm_shop', 'winback', 'funnel', 'loyalty',
    'referral', 'manager_chat', 'helpdesk', 'review_request', 'notify_in_bot',
    'dashboard', 'crm_pipeline', 'admin_roles', 'crm_integration', 'multi_bot',
    'stock', 'limited_offers', 'waitlist'
  ])
),
defaults AS (
  SELECT jsonb_object_agg(key, false) AS j FROM canon
)
UPDATE public.bots b
SET modules = (SELECT j FROM defaults) || COALESCE(b.modules, '{}'::jsonb);

-- Шаг 2. Базовый пакет: входит в каждый продукт без доплаты и работает у всех
-- уже сейчас. Проставляем явно, чтобы будущий гард ничего не отнял.
UPDATE public.bots
SET modules = modules || '{"order_status": true, "excel_export": true}'::jsonb;

-- Шаг 3. Мультиязычность — только тем, у кого есть казахский контент.
UPDATE public.bots b
SET modules = b.modules || '{"multi_language": true}'::jsonb
WHERE EXISTS (
  SELECT 1 FROM public.products p
  WHERE p.bot_id = b.id
    AND COALESCE(p.file_path_kz, p.file_url_kz) IS NOT NULL
)
OR EXISTS (
  SELECT 1 FROM public.product_material_files f
  WHERE f.bot_id = b.id AND f.language = 'kz'
);

COMMIT;
