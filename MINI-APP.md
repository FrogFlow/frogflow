# Telegram Mini App

Mini App — альтернативный интерфейс того же магазина и checkout, которым
пользуется Telegram-бот. Корзина хранится в общей таблице `cart_items`, заказ
создаётся общей функцией `placeOrderInner`.

## Маршруты

| Маршрут                         | Назначение                                          |
| ------------------------------- | --------------------------------------------------- |
| `/mini-app`                     | SSR-каталог, серверный поиск, категории и пагинация |
| `/mini-app/product/:id`         | Карточка товара                                     |
| `/mini-app/orders`              | История заказов и статусы                           |
| `/mini-app-runtime`             | Клиентский JS для Telegram WebView                  |
| `/api/public/mini-app/cart`     | Корзина, количество, промокоды, баллы и сертификаты |
| `/api/public/mini-app/checkout` | Пошаговый checkout и продолжение оплаты             |
| `/api/public/mini-app/proof`    | Загрузка чека (multipart)                           |
| `/api/public/mini-app/orders`   | Список заказов и повторная выдача файлов            |
| `/api/public/mini-app/search`   | Умный поиск (LLM), если обычный ничего не нашёл     |

API принимает подписанный Telegram `initData` только в
`X-Telegram-Init-Data`. Срок действия — один час.

Поиск Mini App смотрит имя, описание, варианты и **ключевые слова** товара —
как бот. Если совпадений нет и включён умный поиск, тот же LLM-фолбэк
работает через `/api/public/mini-app/search`. Расход за день виден в
«Настройках».

Категории по умолчанию как в боте: сначала корневые папки, внутри —
подкатегории. В админке «Категории» можно оставить дерево, показать все
папки лентой или собрать свой набор и порядок только для Mini App.

## Checkout

1. Телефон и страна покупателя.
2. Для физических товаров: получение, дата, зона, адрес и комментарий.
3. При `delivery_lang_timing=before` — язык цифрового материала до заказа.
   При `after` язык спрашивается в боте во время выдачи файлов.
4. Создание заказа с общей защитой `claim_order_placement`.
5. Robokassa, реквизиты или оплата при получении.

Для KZ заказ сначала создаётся, затем пользователь выбирает Robokassa или
реквизиты. `pending_order_id` позволяет продолжить оплату после повторного
открытия Mini App. Пользователь также может отменить ожидающий заказ: остатки,
баллы, промокод и сертификат возвращаются.

После перехода в Robokassa Mini App периодически опрашивает статус заказа и
показывает подтверждение, когда оплата прошла.

Новая непустая корзина никогда автоматически не оплачивает старый
`awaiting_payment` заказ — сначала нужно продолжить либо отменить старый.

Смена страны в Mini App сбрасывает незавершённые поля fulfillment, чтобы
старая зона/адрес не уехали в новый заказ.

## Чек оплаты

`/api/public/mini-app/proof` принимает JPEG/PNG/WebP/HEIC/PDF до 20 МБ,
проверяет magic bytes и пишет файл в Storage `payment-proofs`. Дальше тот же
путь, что у бота: OCR при `receipt_ocr` или ручная проверка админом. Админ
получает чек из Storage, если Telegram `file_id` нет.

## Наблюдаемость

События `mini_app.cart_action`, `mini_app.checkout_step`,
`mini_app.order_created` и `mini_app.proof_upload` пишутся с
`source: "mini_app"` (без отдельного `orders.platform`).

## Файлы

- `src/lib/mini-app.server.ts` — module gate, initData, Menu Button.
- `src/lib/mini-app-catalog.server.ts` — индекс, фильтры, SSR карточки.
- `src/lib/mini-app-cart.server.ts` — общая корзина и итог.
- `src/lib/mini-app-checkout.server.ts` — машина шагов checkout.
- `src/lib/payment-proof.server.ts` — валидация и обработка чека.
- `src/lib/mini-app-runtime.ts` — Telegram WebApp UX.
- `src/lib/mini-app-i18n.ts` — ru/kk/en/uz.
- `src/lib/bot.server.ts` — создание и оплата заказа.

## Проверка

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Перед production-релизом дополнительно проверить в реальном Telegram:

- Android, iOS и Desktop;
- товар без вариантов и с вариантами;
- цифровой и физический checkout;
- KZ Robokassa и оплату по реквизитам;
- загрузку чека из Mini App;
- «Мои заказы», повторную выдачу файлов и ссылку в бот;
- закрытие Mini App до оплаты и последующее продолжение;
- отмену ожидающего заказа;
- просроченный initData;
- промокод, баллы, сертификат и «все языки».

Настройка деплоя и Menu Button описана в
[`DEPLOYMENT.md`](./DEPLOYMENT.md#telegram-mini-app).
