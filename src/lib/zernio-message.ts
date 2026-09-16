import type { Json } from "@/integrations-supabase/types";
import type { ZernioWebhookMessagePayload } from "./zernio.server";
import { isZernioPlatform, USER_KEY_PREFIX, type ZernioPlatform } from "./zernio-platform";
import { extractInstagramMediaInfo } from "./instagram-media";

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
  /** WhatsApp phone number when available; empty for Instagram and username-only WhatsApp users. */
  senderPhone: string;
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
  /** Instagram story ID when the message is a reply to a story. */
  storyId: string | null;
  /** URL of the story media attachment (for fallback matching). */
  storyMediaUrl: string | null;
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
  const senderPhone =
    sender.phoneNumber || (/^\+?\d{10,15}$/.test(sender.id ?? "") ? (sender.id ?? "") : "");

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

  let storyId: string | null = null;
  let storyMediaUrl: string | null = null;

  if (typeof interactive.story_id === "string") {
    storyId = interactive.story_id;
  }
  if (!storyId && typeof (interactive as any).reel_id === "string") {
    storyId = (interactive as any).reel_id;
  }
  if (!storyId && typeof (interactive as any).post_id === "string") {
    storyId = (interactive as any).post_id;
  }

  const rawMsg = message as any;
  if (!storyId && rawMsg?.referral) {
    storyId = String(
      rawMsg.referral.reel_id ||
        rawMsg.referral.target_id ||
        rawMsg.referral.video_id ||
        rawMsg.referral.ref ||
        "",
    );
  }
  if (!storyId && rawMsg?.reply_to) {
    storyId = String(rawMsg.reply_to.story?.id || rawMsg.reply_to.reel?.id || "");
    if (!storyMediaUrl) {
      storyMediaUrl = rawMsg.reply_to.story?.url || rawMsg.reply_to.reel?.url || null;
    }
  }

  const RELEVANT_ATTACHMENT_TYPES = new Set([
    "story_reply",
    "story_share",
    "story",
    "share",
    "reel",
    "ig_reel",
    "reels",
    "media_share",
    "video",
    "image",
  ]);

  if (message.attachments && Array.isArray(message.attachments)) {
    for (const att of message.attachments) {
      const attType = String(att.type || "").toLowerCase();
      if (RELEVANT_ATTACHMENT_TYPES.has(attType)) {
        const attPayload = (att.payload ?? {}) as Record<string, any>;
        const candidateUrl =
          (typeof att.url === "string" && att.url ? att.url : null) ||
          (typeof attPayload.url === "string" && attPayload.url ? attPayload.url : null);
        if (!storyMediaUrl && candidateUrl) {
          storyMediaUrl = candidateUrl;
        }

        const candidateId =
          attPayload.reel_id ||
          attPayload.story_id ||
          attPayload.id ||
          attPayload.media_id ||
          (att as any).id;
        if (!storyId && candidateId) {
          storyId = String(candidateId);
        }
      }
    }
  }

  if (storyMediaUrl) {
    const info = extractInstagramMediaInfo(storyMediaUrl);
    if (info.shortcode) {
      storyId = info.shortcode;
    }
  }
  if (storyId && (storyId.includes("instagram.com") || storyId.includes("http"))) {
    const info = extractInstagramMediaInfo(storyId);
    if (info.shortcode) {
      if (!storyMediaUrl) storyMediaUrl = info.cleanUrl || storyId;
      storyId = info.shortcode;
    }
  }

  return {
    conversationId: message.conversationId || conversation.id,
    // `accountId` — каноническое поле фильтрации, `id` держим как запасное.
    accountId: account.accountId || account.id || account._id,
    platform,
    userKey: `${USER_KEY_PREFIX[platform]}${senderId}`,
    senderUsername,
    senderName,
    senderPhone,
    // text приходит null у сообщений с одним вложением — это не отсутствие поля.
    text: (message.text ?? "").trim(),
    metadata,
    postbackPayload,
    nativeOrder,
    storyId,
    storyMediaUrl,
  };
}
