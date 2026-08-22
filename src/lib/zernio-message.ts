import type { Json } from "@/integrations-supabase/types";
import type { ZernioWebhookMessagePayload } from "./zernio.server";
import { isZernioPlatform, USER_KEY_PREFIX, type ZernioPlatform } from "./zernio-platform";

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
  /** Канал, из которого пришло сообщение. */
  platform: ZernioPlatform;
  /**
   * Ключ пользователя в bot_users: `ig_<id>` для Instagram, `wa_<телефон>` для
   * WhatsApp. Префикс обязателен — он и разводит один и тот же номер или
   * никнейм по разным каналам, и задаёт разный синтетический telegram_id.
   */
  userKey: string;
  senderUsername: string;
  senderName: string;
  text: string;
  /** Профиль отправителя плюс идентификатор его карточки в CRM Zernio. */
  metadata: Record<string, Json>;
  /** Нажатие кнопки или строки списка: текста у такого сообщения нет, только payload. */
  postbackPayload: string | null;
  /**
   * Покупатель прислал корзину из нативного каталога WhatsApp. Свой каталог у
   * нас собственный, так что это не путь оформления — но распознать событие
   * нужно, чтобы ответить, а не промолчать.
   */
  nativeOrder: NativeOrder | null;
};

export type NativeOrder = {
  catalogId: string;
  note: string;
  items: Array<{ retailerId: string; quantity: number; price: number; currency: string }>;
};

/** Имя по умолчанию, когда платформа не отдала ни имени, ни юзернейма. */
const FALLBACK_NAME = "друг";

/**
 * Значения `interactiveType`, означающие «покупатель нажал на то, что мы
 * прислали». Это словарь WhatsApp: строка списка и кнопка. `postback` держим
 * рядом на случай, если Zernio когда-нибудь пришлёт инстаграмное нажатие в
 * этой же форме, — сегодня Instagram использует отдельный ключ
 * `postbackPayload` (см. ниже).
 */
const INTERACTIVE_TAP_TYPES = new Set(["postback", "button_reply", "list_reply"]);

/**
 * Достать метаданные нажатия оттуда, где они лежат.
 *
 * Настоящее место — корень события. Разбор долго читал `message.metadata`, и
 * из-за этого не распознал ни одного нажатия: в 11 476 сохранённых событиях
 * такого поля нет вовсе, ни на одной платформе. В WhatsApp это выглядело как
 * «бот завис после выбора категории», в Instagram — как молчащие кнопки: 38
 * настоящих нажатий за две недели, и ни одного ответа.
 *
 * `message.metadata` остаётся запасным чтением: стоит одну строку и страхует
 * от обратной смены формы.
 */
function interactiveMetadata(payload: ZernioWebhookMessagePayload) {
  return payload.metadata ?? payload.message?.metadata ?? {};
}

export function parseZernioMessage(payload: ZernioWebhookMessagePayload): ParsedZernioMessage {
  const message = payload.message ?? {};
  const conversation = payload.conversation ?? {};
  const account = payload.account ?? {};
  const sender = message.sender ?? {};

  const platform: ZernioPlatform = isZernioPlatform(account.platform)
    ? account.platform
    : isZernioPlatform(message.platform)
      ? message.platform
      : "instagram";

  const senderId = sender.id || sender.username || conversation.participantId || "unknown";
  const senderUsername = sender.username || conversation.participantUsername || "";
  const senderName = sender.name || conversation.participantName || senderUsername || FALLBACK_NAME;

  const metadata: Record<string, Json> = { ...(sender.instagramProfile ?? {}) };
  if (sender.contactId) metadata.zernioContactId = String(sender.contactId);

  const interactive = interactiveMetadata(payload);
  /**
   * Instagram отдаёт нажатие отдельным ключом, WhatsApp — парой
   * `interactiveType` + `interactiveId`. Ключ Instagram проверяем первым:
   * он однозначен и не требует смотреть на тип.
   */
  const postbackPayload =
    interactive.postbackPayload ??
    (INTERACTIVE_TAP_TYPES.has(interactive.interactiveType ?? "")
      ? (interactive.interactiveId ?? "")
      : null);

  const order = interactive.order;
  const nativeOrder: NativeOrder | null = order
    ? {
        catalogId: String(order.catalog_id ?? ""),
        note: (order.text ?? "").trim(),
        items: (order.product_items ?? []).map((item) => ({
          retailerId: String(item.product_retailer_id ?? ""),
          quantity: Number(item.quantity ?? 0),
          price: Number(item.item_price ?? 0),
          currency: String(item.currency ?? ""),
        })),
      }
    : null;

  return {
    conversationId: message.conversationId || conversation.id,
    // `accountId` — каноническое поле фильтрации, `id` держим как запасное.
    accountId: account.accountId || account.id || account._id,
    platform,
    userKey: `${USER_KEY_PREFIX[platform]}${senderId}`,
    senderUsername,
    senderName,
    // text приходит null у сообщений с одним вложением — это не отсутствие поля.
    text: (message.text ?? "").trim(),
    metadata,
    postbackPayload,
    nativeOrder,
  };
}
