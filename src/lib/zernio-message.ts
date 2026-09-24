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

/**
 * Вложение — публикация (рилс, пост, сторис), а не файл покупателя.
 *
 * Фото, видео и гифки покупатель присылает теми же типами image/video, что и
 * часть публикаций. Раньше любой такой файл считался публикацией, поиск
 * привязки по нему ничего не находил и подставлял последнюю отмеченную
 * публикацию. Живой случай 24.09: двое прислали фото полотенец (Pip Studio,
 * жаккард) и получили список ковриков Kleen-Tex, отмеченных утром. По логам
 * BOVI за две недели публикация ни разу не пришла как image: рилсы идут
 * video со ссылкой instagram.com/reel и reel_video_id, фото покупателей —
 * image с lookaside.fbsbx.com.
 */
export function isPublicationAttachment(
  type: string,
  url: string | null | undefined,
  payload: Record<string, any> = {},
): boolean {
  const t = type.toLowerCase();
  if (t !== "image" && t !== "video") return true;
  if (typeof url === "string" && /instagram\.com\/(?:reels?|p|stories)\//i.test(url)) return true;
  return Boolean(
    payload.reel_video_id ||
      payload.reelVideoId ||
      payload.reel_id ||
      payload.story_id ||
      payload.story?.id ||
      payload.reel?.id,
  );
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

  const rawMeta = interactive as any;
  const rawMsg = message as any;
  const rawPayload = payload as any;

  const candidateMetaId =
    rawMeta.storyReply?.storyId ||
    rawMeta.storyReply?.story_id ||
    rawMeta.storyReply?.id ||
    rawMeta.story_reply?.story_id ||
    rawMeta.story_reply?.storyId ||
    rawMeta.story_reply?.id ||
    rawMeta.reelReply?.reelId ||
    rawMeta.reelReply?.reel_id ||
    rawMeta.reelReply?.id ||
    rawMeta.reel_reply?.reel_id ||
    rawMeta.storyId ||
    rawMeta.story_id ||
    rawMeta.reelId ||
    rawMeta.reel_id ||
    rawMeta.postId ||
    rawMeta.post_id ||
    rawMeta.story?.id ||
    rawMeta.story?.storyId ||
    rawMeta.reel?.id ||
    rawMeta.reel?.reelId ||
    rawMsg.storyReply?.storyId ||
    rawMsg.storyReply?.story_id ||
    rawPayload.storyReply?.storyId;

  if (candidateMetaId) {
    storyId = String(candidateMetaId);
  }

  const candidateMetaUrl =
    rawMeta.storyReply?.storyUrl ||
    rawMeta.storyReply?.story_url ||
    rawMeta.storyReply?.url ||
    rawMeta.story_reply?.story_url ||
    rawMeta.story_reply?.storyUrl ||
    rawMeta.story_reply?.url ||
    rawMeta.reelReply?.reelUrl ||
    rawMeta.reelReply?.reel_url ||
    rawMeta.reelReply?.url ||
    rawMeta.storyUrl ||
    rawMeta.story_url ||
    rawMeta.reelUrl ||
    rawMeta.reel_url ||
    rawMeta.story?.url ||
    rawMeta.story?.storyUrl ||
    rawMeta.reel?.url ||
    rawMsg.storyReply?.storyUrl ||
    rawMsg.storyReply?.story_url ||
    rawPayload.storyReply?.storyUrl;

  if (!storyMediaUrl && candidateMetaUrl) {
    storyMediaUrl = String(candidateMetaUrl);
  }

  /**
   * Ответ на рилс приходит не метаданными, а вложением.
   *
   * Живое событие 22.09: message.attachments[0] = { type: "video", url:
   * "https://www.instagram.com/reel/Dcaih_PMAZ2/", payload: { reel_video_id:
   * "18113576638999210", … } }. Ни одного из полей выше в нём нет, поэтому
   * ответ на рилс до сих пор считался обычным сообщением из Direct — и
   * покупателю приходил вопрос про страну вместо цены.
   */
  if (!storyId || !storyMediaUrl) {
    for (const att of (rawMsg.attachments ?? []) as Array<Record<string, any>>) {
      const attPayload = (att?.payload ?? {}) as Record<string, any>;
      const reelId =
        attPayload.reel_video_id ||
        attPayload.reelVideoId ||
        attPayload.story_id ||
        attPayload.media_id;
      const url = att?.url || attPayload.url;
      if (!storyId && reelId) storyId = String(reelId);
      if (!storyMediaUrl && typeof url === "string" && /instagram\.com\/(?:reel|p|stories)\//i.test(url)) {
        storyMediaUrl = url;
      }
      if (storyId && storyMediaUrl) break;
    }
  }

  if (!storyId && rawMsg?.referral) {
    const ref =
      rawMsg.referral.reel_id ||
      rawMsg.referral.story_id ||
      rawMsg.referral.target_id ||
      rawMsg.referral.video_id ||
      rawMsg.referral.ref;
    if (ref) storyId = String(ref);
  }

  if (!storyId && rawMsg?.story) {
    const sId = rawMsg.story.id || rawMsg.story_id;
    if (sId) storyId = String(sId);
  }
  if (!storyMediaUrl && rawMsg?.story?.url) {
    storyMediaUrl = String(rawMsg.story.url);
  }

  if (!storyId && rawMsg?.reel) {
    const rId = rawMsg.reel.id || rawMsg.reel_id;
    if (rId) storyId = String(rId);
  }
  if (!storyMediaUrl && rawMsg?.reel?.url) {
    storyMediaUrl = String(rawMsg.reel.url);
  }

  if (!storyId && rawMsg?.reply_to) {
    const repId =
      rawMsg.reply_to.story?.id ||
      rawMsg.reply_to.reel?.id ||
      rawMsg.reply_to.story_id ||
      rawMsg.reply_to.reel_id ||
      rawMsg.reply_to.id;
    if (repId) storyId = String(repId);
  }
  if (!storyMediaUrl && rawMsg?.reply_to) {
    const repUrl =
      rawMsg.reply_to.story?.url ||
      rawMsg.reply_to.reel?.url ||
      rawMsg.reply_to.url;
    if (repUrl) storyMediaUrl = String(repUrl);
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
      const attPayload = ((att as any).payload ?? {}) as Record<string, any>;
      const candidateUrl =
        (typeof att.url === "string" && att.url ? att.url : null) ||
        (typeof attPayload.url === "string" && attPayload.url ? attPayload.url : null) ||
        (typeof attPayload.story?.url === "string" && attPayload.story.url ? attPayload.story.url : null) ||
        (typeof attPayload.reel?.url === "string" && attPayload.reel.url ? attPayload.reel.url : null) ||
        (typeof attPayload.share?.url === "string" && attPayload.share.url ? attPayload.share.url : null);
      if (
        RELEVANT_ATTACHMENT_TYPES.has(attType) &&
        isPublicationAttachment(attType, candidateUrl, attPayload)
      ) {
        if (!storyMediaUrl && candidateUrl) {
          storyMediaUrl = candidateUrl;
        }

        const candidateId =
          attPayload.story?.id ||
          attPayload.reel?.id ||
          attPayload.share?.id ||
          attPayload.story_id ||
          attPayload.reel_id ||
          attPayload.id ||
          attPayload.media_id ||
          attPayload.target_id ||
          (att as any).id;
        if (!storyId && candidateId) {
          storyId = String(candidateId);
        }
      }
    }
  }

  if (storyId) {
    storyId = storyId.trim();
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
