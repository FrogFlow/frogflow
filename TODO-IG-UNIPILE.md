# TODO: Instagram DM / Unipile (отложено)

**Статус:** отложено 2026-07-27 — сначала форк Telegram-магазина в [techer_ta](https://github.com/yaha341/techer_ta).

Работы по отправке DM и файлов через Unipile **ещё нужны** в этом репозитории (`tg_bot`).

## Что сделать

1. MIME-роутер: `attachments` (image/video/PDF) vs `attachment` (audio/voice для IG)
2. Проверка размера файла ≤ 15 MB
3. Один `POST /api/v1/chats` с text + file; retry только через existing chat
4. Строго `provider_messaging_id` (не profile `id`)
5. Честный `attachmentSent` + диагностика в логе
6. Rate-limit исходящих DM (≤10/час по рекомендации Unipile)
7. Валидация файлов в админке правил

## Документация

- [Send Messages](https://developer.unipile.com/docs/send-messages)
- [Instagram Send Messages](https://developer.unipile.com/v2.0/docs/instagram-send-messages)
- [Users overview](https://developer.unipile.com/docs/users-overview)

План в Cursor: `unipile_ig_dm_docs` (deferred).
