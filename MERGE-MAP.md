# Карта слияния — что откуда берём

Рабочий лист для объединения пяти репозиториев в один. Принцип: **объединение
множеств**, а не выбор победителя. Каждая возможность, которая есть хоть у
одного клиента, попадает в общее ядро; там, где реализаций несколько, берётся
самая свежая и полная.

Посчитано по хешам файлов `.ts`/`.tsx` в `src/` и датам последнего изменения.

## Сколько работы на самом деле

| Категория | Файлов | Что делать |
|---|---|---|
| Одинаковы во всех пяти | 72 | взять как есть |
| Живут в одном репозитории | 14 | перенести как есть |
| 2 версии | 23 | сверить, взять свежую |
| 3 версии | 11 | сверить, взять свежую |
| **4–5 версий** | **9** | **слить руками** |
| **Всего** | **129** | |

Главный вывод: из 129 файлов настоящего слияния требуют девять. Всё
остальное — механика: скопировать эталон и проверить, что собирается.

## Девять файлов, требующих ручной работы

Числа — строк в каждой версии. Расхождение в размере показывает, где какая
реализация богаче.

| Файл | Анастасия | Салтанат | Print KZ | Дидактика | Развивашка |
|---|---|---|---|---|---|
| `lib/bot.server.ts` | 2061 | 1027 | 1018 | 1021 | 1011 |
| `lib/orders.functions.ts` | 135 | 272 | 232 | 263 | 226 |
| `routes/__root.tsx` | 121 | 126 | 126 | 121 | 129 |
| `integrations-supabase/types.ts` | 1448 | 507 | 507 | 1493 | 1512 |
| `lib/telegram.server.ts` | 124 | 98 | 98 | 57 | 95 |
| `lib/webhook-ensure.server.ts` | 109 | 160 | 160 | 160 | 160 |
| `routes/admin.orders.tsx` | 261 | 233 | 233 | 266 | 233 |
| `routes/admin.products.tsx` | 499 | 605 | 519 | 510 | 519 |
| `routes/admin.tsx` | 66 | 96 | 96 | 63 | 64 |

`bot.server.ts` — главная работа всего проекта. У Анастасии он вдвое больше,
потому что содержит её модули вперемешку с общей логикой магазина. Расплести
его на общее ядро и модули — самая долгая часть.

`types.ts` сливать не нужно: он генерируется из общей базы командой
`node scripts/sync-db-types.mjs`. Разница в размере — просто следствие того,
что у одних он свежий, у других нет.

## Уникальные возможности — едут как есть

| Файл | Чей | Что это |
|---|---|---|
| `lib/broadcast.functions.ts` | Анастасия | рассылки по базе |
| `lib/broadcast.server.ts` | Анастасия | рассылки по базе |
| `lib/category-tree.ts` | Анастасия | дерево категорий |
| `lib/format-datetime.server.ts` | Дидактика | форматирование дат |
| `lib/orders.server.ts` | Анастасия | выдача заказа (вторая реализация) |
| `lib/receipt-verify.server.ts` | Анастасия | распознавание чека (OCR) |
| `lib/robokassa.server.ts` | Анастасия | эквайринг RoboKassa |
| `routes/admin.broadcast.tsx` | Анастасия | рассылки — админка |
| `routes/api/cron/broadcast.ts` | Анастасия | рассылки — крон |
| `routes/api/cron/ensure-webhook.ts` | Анастасия | самолечение вебхука |
| `routes/api/public/robokassa/fail.ts` | Анастасия | эквайринг — колбэк |
| `routes/api/public/robokassa/result.ts` | Анастасия | эквайринг — колбэк |
| `routes/api/public/robokassa/success.ts` | Анастасия | эквайринг — колбэк |
| `routes/legal/$slug.ts` | Анастасия | юридические страницы |

Двенадцать из четырнадцати — модули Анастасии. Все они уже есть отдельными
позициями в прайсе, то есть должны стать модулями под флагами `bots.modules`,
а не частью обязательного ядра.

## Эталон по каждому общему файлу

«Эталон» — репозиторий с самой свежей версией. В скобках — кто ещё несёт
ровно ту же версию.

⚠ Даты 13 августа — это работа по переезду на общую базу (изоляция
арендаторов, `order_no`, типы), а не новые возможности. Для файлов, помеченных
этой датой, «свежее» не означает «богаче» — сверяйте по содержимому.

| Файл | Есть в | Эталон | Дата |
|---|---|---|---|
| `lib/bot.server.ts` | tg,salt,print,did,razv | **razv** (razv) | 2026-08-13 |
| `lib/orders.functions.ts` | tg,salt,print,did,razv | **razv** (razv) | 2026-08-13 |
| `routes/__root.tsx` | tg,salt,print,did,razv | **salt** (salt) | 2026-08-11 |
| `integrations-supabase/types.ts` | tg,salt,print,did,razv | **razv** (razv) | 2026-08-13 |
| `lib/telegram.server.ts` | tg,salt,print,did,razv | **salt** (salt,print) | 2026-08-11 |
| `lib/webhook-ensure.server.ts` | tg,salt,print,did,razv | **salt** (salt) | 2026-08-11 |
| `routes/admin.orders.tsx` | tg,salt,print,did,razv | **razv** (razv) | 2026-08-13 |
| `routes/admin.products.tsx` | tg,salt,print,did,razv | **salt** (salt) | 2026-08-12 |
| `routes/admin.tsx` | tg,salt,print,did,razv | **salt** (salt,print) | 2026-08-11 |
| `lib/blocked-users.server.ts` | salt,print,did,razv | **print** (salt,print) | 2026-08-12 |
| `lib/currency.server.ts` | tg,salt,print,did,razv | **print** (salt,print) | 2026-08-12 |
| `lib/instagram.functions.ts` | tg,salt,print,razv | **salt** (salt) | 2026-08-11 |
| `lib/products.functions.ts` | tg,salt,print,did,razv | **salt** (salt) | 2026-08-11 |
| `lib/vip-bot.server.ts` | salt,print,did,razv | **salt** (salt) | 2026-08-11 |
| `lib/vip-member.server.ts` | salt,print,did,razv | **print** (salt,print) | 2026-08-12 |
| `lib/zernio-bot.server.ts` | tg,salt,print,razv | **tg** (tg) | 2026-08-12 |
| `lib/zernio.server.ts` | tg,salt,print,razv | **print** (salt,print) | 2026-08-11 |
| `routes/admin.blocked.tsx` | salt,print,did,razv | **salt** (salt,print) | 2026-08-11 |
| `routes/admin.instagram.tsx` | tg,salt,print,razv | **salt** (salt,print) | 2026-08-11 |
| `routes/admin.settings.tsx` | tg,salt,print,did,razv | **salt** (salt,print,razv) | 2026-08-11 |
| `integrations-supabase/auth-middleware.ts` | tg,salt,print,did,razv | **salt** (salt,print,did,razv) | 2026-08-11 |
| `integrations-supabase/client.ts` | tg,salt,print,did,razv | **salt** (salt,print,did,razv) | 2026-08-11 |
| `lib/admin.functions.ts` | tg,salt,print,did,razv | **salt** (tg,salt,print,razv) | 2026-08-11 |
| `lib/blocked-users.functions.ts` | salt,print,did,razv | **salt** (salt,print,razv) | 2026-08-11 |
| `lib/categories.functions.ts` | tg,salt,print,did,razv | **salt** (salt,print,did,razv) | 2026-08-11 |
| `lib/payment-methods.functions.ts` | tg,salt,print,did,razv | **salt** (salt,print,did,razv) | 2026-08-11 |
| `lib/reset.functions.ts` | tg,salt,print,did,razv | **razv** (tg,did,razv) | 2026-08-13 |
| `lib/settings.functions.ts` | tg,salt,print,did,razv | **salt** (salt,print,did,razv) | 2026-08-11 |
| `lib/telegram-webhook.server.ts` | salt,print,did,razv | **salt** (salt,print,razv) | 2026-08-11 |
| `lib/vip-cron.server.ts` | salt,print,did,razv | **salt** (salt,print,razv) | 2026-08-11 |
| `lib/vip-subscriptions.functions.ts` | salt,print,did,razv | **salt** (salt,print,razv) | 2026-08-11 |
| `routeTree.gen.ts` | tg,salt,print,did,razv | **salt** (salt,print,did,razv) | 2026-08-11 |
| `routes/admin.categories.tsx` | tg,salt,print,did,razv | **salt** (salt,print,did,razv) | 2026-08-11 |
| `routes/admin.index.tsx` | tg,salt,print,did,razv | **salt** (salt,print,did,razv) | 2026-08-11 |
| `routes/admin.payment-methods.tsx` | tg,salt,print,did,razv | **salt** (salt,print,did,razv) | 2026-08-11 |
| `routes/admin.vip.index.tsx` | salt,print,did,razv | **salt** (salt,print,razv) | 2026-08-11 |
| `routes/admin.vip.settings.tsx` | salt,print,did,razv | **salt** (salt,print,razv) | 2026-08-11 |
| `routes/admin.vip.subscribers.tsx` | salt,print,did,razv | **salt** (salt,print,razv) | 2026-08-11 |
| `routes/admin.vip.tariffs.tsx` | salt,print,did,razv | **salt** (salt,print,razv) | 2026-08-11 |
| `routes/admin.vip.tsx` | salt,print,did,razv | **salt** (salt,print) | 2026-08-11 |
| `routes/api/admin/file/$.ts` | tg,salt,print,did,razv | **salt** (tg,salt,print,razv) | 2026-08-11 |
| `routes/api/public/img/$.ts` | tg,salt,print,did,razv | **salt** (salt,print,did,razv) | 2026-08-11 |
| `routes/api/public/telegram/webhook.ts` | tg,salt,print,did,razv | **salt** (salt,print,did,razv) | 2026-08-11 |

## Порядок работ

1. **Ядро.** 72 одинаковых файла переносятся без разговоров — это скелет.
2. **Механическая часть.** 34 файла с двумя-тремя версиями: взять эталон,
   проверить сборку. Быстро.
3. **Девять файлов вручную.** Начинать с `admin.products.tsx` и
   `orders.functions.ts` — там понятные и локальные различия. `bot.server.ts`
   оставить напоследок.
4. **Модули под флаги.** Четырнадцать уникальных файлов и VIP-модуль
   подключаются через `bots.modules`. Колонка уже существует и заполнена по
   факту использования; схема БД одинакова у всех арендаторов, поэтому
   миграции не нужны — только флаг.
5. **Клиенты по одному.** Переводить на общее ядро в порядке возрастания
   риска: Развивашка и Дидактика (мало заказов), потом Print KZ и Салтанат,
   последней — Анастасия с её 426 заказами.

## Что проверять после каждого переключения

Каталог, поиск, оформление заказа (номер должен продолжить свой ряд, а не
чужой), приём чека, выдача файлов, VIP-подписчики и сроки, Instagram — у тех,
у кого он есть.

