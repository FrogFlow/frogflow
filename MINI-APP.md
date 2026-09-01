# Telegram Mini App

Mini App — альтернативный интерфейс того же магазина и checkout, которым
пользуется Telegram-бот. Корзина хранится в общей таблице `cart_items`, заказ
создаётся общей функцией `placeOrderInner`.

## Маршруты

| Маршрут                         | Назначение                                          |
| ------------------------------- | --------------------------------------------------- |
| `/mini-app`                     | SSR-каталог, серверный поиск, категории и пагинация |
| `/mini-app/product/:id`         | Карточка товара                                     |
| `/mini-app-runtime`             | Клиентский JS для Telegram WebView                  |
| `/api/public/mini-app/cart`     | Корзина, количество, промокоды, баллы и сертификаты |
| `/api/public/mini-app/checkout` | Пошаговый checkout и продолжение оплаты             |

API принимает подписанный Telegram `initData` только в
`X-Telegram-Init-Data`. Срок действия — один час.

## Checkout

1. Телефон и страна покупателя.
2. Для физических товаров: получение, дата, зона, адрес и комментарий.
3. При необходимости — язык цифрового материала.
4. Создание заказа с общей защитой `claim_order_placement`.
5. Robokassa, реквизиты или оплата при получении.

Для KZ заказ сначала создаётся, затем пользователь выбирает Robokassa или
реквизиты. `pending_order_id` позволяет продолжить оплату после повторного
открытия Mini App. Пользователь также может отменить ожидающий заказ: остатки,
баллы, промокод и сертификат возвращаются.

Новая непустая корзина никогда автоматически не оплачивает старый
`awaiting_payment` заказ — сначала нужно продолжить либо отменить старый.

## Файлы

- `src/lib/mini-app.server.ts` — module gate, initData, Menu Button.
- `src/lib/mini-app-catalog.server.ts` — индекс, фильтры, SSR карточки.
- `src/lib/mini-app-cart.server.ts` — общая корзина и итог.
- `src/lib/mini-app-checkout.server.ts` — машина шагов checkout.
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
- закрытие Mini App до оплаты и последующее продолжение;
- отмену ожидающего заказа;
- просроченный initData;
- промокод, баллы, сертификат и «все языки».

Настройка деплоя и Menu Button описана в
[`DEPLOYMENT.md`](./DEPLOYMENT.md#telegram-mini-app).
