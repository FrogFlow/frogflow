import type { Json } from "@/integrations-supabase/types";
import type { ZernioWebhookMessagePayload } from "./zernio.server";

/**
 * Разбор события `message.received` — отдельно от обработки и без побочных
 * действий, чтобы его можно было проверить тестом.
 *
 * Вынесено сюда после того, как здесь нашлась дорогая опечатка: профиль
 * отправителя читался из `payload.data.instagramProfile`, тогда как Zernio
 * присылает его в `message.sender.instagramProfile`. Поля `data` нет ни в
 * одном из 26 865 сохранённых событий, так что чтение всегда возвращало
 * undefined — и у всех 1175 пользователей Instagram метаданные остались
 * пустыми, хотя колонку под них завели отдельной миграцией.
 *
 * Такую ошибку не ловят ни типы, ни линтер, ни глаз при чтении диффа: код
 * выглядит правильным, просто читает не оттуда. Ловит её только тест на
 * настоящей форме события — он лежит в tests/zernio-message.test.ts.
 */
export type ParsedZernioMessage = {
  conversationId?: string;
  accountId?: string;
  /** Ключ пользователя в bot_users: `ig_<идентификатор отправителя>`. */
  userKey: string;
  senderUsername: string;
  senderName: string;
  text: string;
  /** Профиль отправителя плюс идентификатор его карточки в CRM Zernio. */
  metadata: Record<string, Json>;
  /** Нажатие кнопки в DM: текста у такого сообщения нет, только payload кнопки. */
  postbackPayload: string | null;
};

/** Имя по умолчанию, когда Instagram не отдал ни имени, ни юзернейма. */
const FALLBACK_NAME = "друг";

export function parseZernioMessage(payload: ZernioWebhookMessagePayload): ParsedZernioMessage {
  const message = payload.message ?? {};
  const conversation = payload.conversation ?? {};
  const account = payload.account ?? {};
  const sender = message.sender ?? {};

  const senderId = sender.id || sender.username || conversation.participantId || "unknown";
  const senderUsername = sender.username || conversation.participantUsername || "";
  const senderName = sender.name || conversation.participantName || senderUsername || FALLBACK_NAME;

  const metadata: Record<string, Json> = { ...(sender.instagramProfile ?? {}) };
  if (sender.contactId) metadata.zernioContactId = String(sender.contactId);

  const interactive = message.metadata ?? {};
  const postbackPayload =
    interactive.interactiveType === "postback" ? interactive.interactiveId || "" : null;

  return {
    conversationId: message.conversationId || conversation.id,
    // `accountId` — каноническое поле фильтрации, `id` держим как запасное.
    accountId: account.accountId || account.id,
    userKey: `ig_${senderId}`,
    senderUsername,
    senderName,
    // text приходит null у сообщений с одним вложением — это не отсутствие поля.
    text: (message.text ?? "").trim(),
    metadata,
    postbackPayload,
  };
}
