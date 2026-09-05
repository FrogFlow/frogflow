/**
 * Zernio API Client for Instagram & Multi-channel Integration
 */
import type { Json } from "@/integrations-supabase/types";
import { errorMessage } from "@/lib/error-message";
import { isZernioPlatform, type ZernioPlatform } from "./zernio-platform";

// Канал — общий словарь для серверного слоя и разбора событий, живёт в
// отдельном нейтральном модуле (см. комментарий там). Реэкспорт — чтобы
// существующие импорты «из zernio.server» продолжали работать.
export { isZernioPlatform, ZERNIO_PLATFORMS, type ZernioPlatform } from "./zernio-platform";

/**
 * Пост/сторис из ответа Zernio — намеренно не полный тип.
 *
 * listZernioPosts сводит 4 разных эндпоинта (analytics, posts,
 * posts/sync-external, stories), у каждого своя, местами непересекающаяся
 * форма полей, и функция сама достраивает вычисляемые поля (`_thumbnail`,
 * `_date`, `_zernioPostId`…). Индексная сигнатура вместо перечисления всех
 * настоящих полей Zernio — они нигде не документированы исчерпывающе, а
 * гадать рискованнее, чем сужать на месте, как уже делает сам код через
 * `Array.isArray`. Значение — `Json`, а не `unknown`: тип уходит на клиент
 * через createServerFn (getZernioPostsFn), а проверка сериализуемости там
 * `unknown` в индексной сигнатуре не пропускает.
 */
type ZernioPost = { [key: string]: Json | undefined };

function getZernioKey(): string {
  const key = process.env.ZERNIO_API_KEY?.trim();
  if (!key) {
    throw new Error("ZERNIO_API_KEY environment variable is not configured");
  }
  return key;
}

const DEFAULT_ZERNIO_BASE_URL = "https://zernio.com/api/v1";

/**
 * Keeps client deployments from accidentally calling Zernio's website instead
 * of its JSON API. This is easy to misconfigure in Vercel as
 * `https://zernio.com`: the request still succeeds with HTTP 200, but the body
 * is an HTML page and `response.json()` then fails with `Unexpected token '<'`.
 */
export function normalizeZernioBaseUrl(value?: string | null): string {
  const configured = value?.trim() || DEFAULT_ZERNIO_BASE_URL;

  try {
    const url = new URL(configured);
    if (url.hostname === "zernio.com" && (url.pathname === "" || url.pathname === "/")) {
      url.pathname = "/api/v1";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return configured.replace(/\/$/, "");
  }
}

function getZernioBaseUrl(): string {
  return normalizeZernioBaseUrl(process.env.ZERNIO_BASE_URL);
}

export type ZernioProfile = {
  _id: string;
  name: string;
  description?: string;
};

export type ZernioAccount = {
  _id: string;
  platform: string;
  name?: string;
  username?: string;
  // Zernio отдаёт ссылку на профиль либо строкой-идентификатором, либо уже
  // развёрнутым объектом — зависит от эндпоинта. Форма в admin.instagram.tsx
  // разбирает оба случая, и тип должен описывать то же самое.
  profileId?: string | { _id: string };
  isExpired?: boolean;
  // Json, а не Record<string, unknown>: тип уезжает на клиент через
  // getInstagramAccountsFn, а `unknown` в TanStack Start не проходит проверку
  // сериализуемости — это ведь просто разобранный ответ Zernio, то есть JSON.
  metadata?: Record<string, Json>;
};

export type ZernioAccountHealth = {
  accountId: string;
  status: "healthy" | "warning" | "error";
  tokenStatus?: { valid?: boolean; expiresAt?: string; expiresIn?: string; needsRefresh?: boolean };
  permissions?: { canPost?: boolean; canFetchAnalytics?: boolean; missingRequired?: string[] };
  issues?: string[];
  recommendations?: string[];
};

export type ZernioConversation = {
  id: string;
  accountId: string;
  // ВНИМАНИЕ: это поле не проверено против настоящего ответа
  // /inbox/conversations — добавлено только потому, что admin.instagram.tsx
  // (getInstagramContactProfilesFn) уже читало conversation.participantId
  // под `any`, а под честным типом это оказалось полем, которого в типе не
  // было вовсе. Не исключено, что реальное имя поля другое (или его нет), и
  // подтягивание профиля собеседника («подписчик / не подписан») тогда не
  // работает и под этой правкой — стоит свериться с живым ответом Zernio.
  participantId?: string;
  participantName?: string;
  participantUsername?: string;
  participantPicture?: string | null;
  lastMessage?: string;
  updatedTime?: string;
  unreadCount?: number | null;
  status?: "active" | "archived";
};

export type ZernioInboxMessage = {
  id: string;
  message?: string;
  direction?: "incoming" | "outgoing";
  createdAt?: string;
  attachments?: Array<{
    id: string;
    type: string;
    url: string;
    filename?: string | null;
    previewUrl?: string | null;
  }>;
};

export type ZernioDmButton = {
  type: "url" | "postback" | "phone";
  title: string;
  url?: string;
  payload?: string;
  phone?: string;
};

/** A normal Direct reply must not carry an out-of-window message tag. */
export function buildInstagramInboxMessageBody(
  accountId: string,
  message: string,
): Record<string, string> {
  return { accountId, message };
}

export type ZernioCommentAutomation = {
  id?: string;
  _id?: string;
  name: string;
  platform?: "instagram" | "facebook";
  trigger?: "comment" | "story_reply";
  accountId: string;
  profileId?: string;
  // null — «все посты», а не «значение не задано»: именно его кладёт сюда
  // разбор постов ниже (`… || null`) и валидатор формы в instagram.functions.ts
  // (`.optional().nullable()`). Тип обязан это допускать.
  platformPostId?: string | null;
  postId?: string | null;
  postTitle?: string;
  keywords: string[];
  replyToAll?: boolean;
  matchMode?: "exact" | "contains";
  dmMessage: string;
  buttons?: ZernioDmButton[];
  commentReply?: string;
  dmMessageVariations?: string[];
  commentReplyVariations?: string[];
  linkTracking?: boolean;
  clickTag?: string;
  isActive?: boolean;
  stats?: {
    triggered?: number;
    dmsSent?: number;
    dmsFailed?: number;
    uniqueContacts?: number;
    linkClicks?: number;
    read?: number;
  };
  /**
   * Форма поля не подтверждена документацией/логами Zernio (в отличие от
   * остальных полей выше) — только читается для диагностики (см.
   * diagnostics.server.ts, правило «год»), в решениях не участвует. `Json`,
   * а не `unknown` — значение уходит клиенту через createServerFn
   * (instagram.functions.ts), а его сериализуемость должна быть доказуема
   * статически.
   */
  audience?: Json;
};

/**
 * Полезная нагрузка `message.received` — по документации Zernio и по факту.
 *
 * Прежний вариант этого типа описывал объект `data` с плоскими полями
 * (`senderId`, `senderUsername`, `commentText`…). Такого поля Zernio не
 * присылает вовсе: в 26 865 сохранённых событиях `data` не встречается ни
 * разу. Тип был выдумкой, и написанный по нему разбор молча читал undefined.
 */
/**
 * Метаданные нажатия. Имена ключей у платформ разные — это не наш выбор, а
 * форма Zernio, снятая с настоящих событий:
 *
 *   Instagram — `postbackPayload` (+ `postbackTitle`, он же приходит текстом);
 *   WhatsApp  — `interactiveId` при `interactiveType` = `list_reply` (строка
 *               списка) или `button_reply` (кнопка).
 */
export type ZernioInteractiveMetadata = {
  /** Instagram: значение нажатой кнопки. */
  postbackPayload?: string;
  /** Instagram: видимая подпись кнопки; дублируется в `message.text`. */
  postbackTitle?: string;
  /** WhatsApp: `list_reply` | `button_reply`. */
  interactiveType?: string;
  /** WhatsApp: значение нажатой строки или кнопки. */
  interactiveId?: string;
  /**
   * Корзина из нативного каталога Meta — только WhatsApp.
   *
   * В отличие от двух полей выше, эта форма живым событием не подтверждена:
   * в журнале такого пока не было. Взята из документации Zernio, поэтому при
   * первом настоящем событии стоит свериться.
   */
  order?: {
    catalog_id?: string;
    text?: string;
    product_items?: Array<{
      product_retailer_id?: string;
      quantity?: number;
      item_price?: number;
      currency?: string;
    }>;
  };
  referredProduct?: { catalog_id?: string; product_retailer_id?: string };
};

export type ZernioWebhookMessagePayload = {
  /** Стабильный идентификатор события — он же ключ дедупликации. */
  id?: string;
  event: "message.received" | string;
  message?: {
    id?: string;
    conversationId?: string;
    platform?: string;
    platformMessageId?: string;
    direction?: "incoming" | "outgoing";
    /** Может быть null: у сообщения бывает одно вложение без текста. */
    text?: string | null;
    attachments?: Array<{ type: string; url: string; payload?: Record<string, Json> }>;
    sender?: {
      id?: string;
      /** Идентификатор карточки контакта в CRM самого Zernio. */
      contactId?: string;
      name?: string;
      username?: string;
      picture?: string;
      /** WhatsApp only: E.164 phone number when Meta exposes it. */
      phoneNumber?: string | null;
      instagramProfile?: {
        isFollower?: boolean | null;
        isFollowing?: boolean | null;
        followerCount?: number | null;
        isVerified?: boolean | null;
      };
    };
    /**
     * Запасное место для метаданных нажатия. Настоящее — в корне события
     * (см. `metadata` ниже); здесь их Zernio не присылал ни разу за 11 476
     * сохранённых событий. Поле оставлено на случай обратной смены формы.
     */
    metadata?: ZernioInteractiveMetadata;
    sentAt?: string;
    isRead?: boolean;
  };
  conversation?: {
    id?: string;
    participantId?: string;
    participantName?: string;
    participantUsername?: string;
    participantPicture?: string | null;
  };
  account?: {
    id?: string;
    /** Некоторые ответы Zernio используют Mongo-style `_id`. */
    _id?: string;
    /** Тот же идентификатор, что и `id`; каноническое поле для фильтрации. */
    accountId?: string;
    platform?: string;
    username?: string;
  };
  /**
   * Нажатие интерактивного элемента — здесь, в корне события.
   *
   * Место проверено по журналу: из 11 476 событий `metadata` встречается в
   * корне и ни разу внутри `message`. Разбор долго читал `message.metadata` —
   * и поэтому не распознал ни одного нажатия ни в одном канале.
   */
  metadata?: ZernioInteractiveMetadata;
  timestamp?: string;
};

async function zernioRequest<T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string>;
    /**
     * Значение заголовка `Idempotency-Key`. Zernio хранит ключ сутки: тот же
     * ключ с тем же телом возвращает исходный ответ вместо повторного действия,
     * тот же ключ с другим телом — 422, ключ ещё в работе — 409.
     */
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const apiKey = getZernioKey();
  const baseUrl = getZernioBaseUrl();

  let url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  if (options.query) {
    const params = new URLSearchParams(options.query);
    url += `?${params.toString()}`;
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const responseText = await response.text();

  if (!response.ok) {
    const detail = /^\s*</.test(responseText)
      ? "Zernio returned an HTML page instead of an API response"
      : responseText.slice(0, 1_000);
    console.error(`[zernio] API request error ${response.status} on ${endpoint}:`, detail);
    throw new Error(`Zernio API Error ${response.status}: ${detail}`);
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    const contentType = response.headers.get("content-type") || "unknown content type";
    console.error(
      `[zernio] non-JSON response on ${endpoint}: status=${response.status}, content-type=${contentType}`,
    );
    throw new Error(
      `Zernio вернул не JSON (${contentType}). Проверьте ZERNIO_BASE_URL: ожидается ${DEFAULT_ZERNIO_BASE_URL}`,
    );
  }
}

/**
 * Получить список профилей Zernio или создать дефолтный профиль магазина.
 */
export async function ensureDefaultZernioProfile(): Promise<ZernioProfile> {
  const envProfileId = process.env.ZERNIO_PROFILE_ID?.trim();

  try {
    const listRes = await zernioRequest<{ profiles: ZernioProfile[] }>("/profiles");

    // If ZERNIO_PROFILE_ID is set, try to find that specific profile
    if (envProfileId) {
      const found = listRes.profiles?.find((p) => p._id === envProfileId);
      if (found) return found;
      console.warn(
        `[zernio] Profile ${envProfileId} not found in account, falling back to first available or create`,
      );
    }

    if (listRes.profiles && listRes.profiles.length > 0) {
      return listRes.profiles[0];
    }
  } catch (e) {
    console.warn("[zernio] failed to list profiles, attempting create...", e);
  }

  const createRes = await zernioRequest<{ profile: ZernioProfile }>("/profiles", {
    method: "POST",
    body: {
      name: "Store Main Profile",
      description: "Default profile for Instagram Bot Store",
    },
  });

  return createRes.profile;
}

/**
 * Сгенерировать официальную ссылку авторизации Zernio OAuth (Connect Link) для Instagram.
 */
export async function getZernioConnectUrl(
  platform = "instagram",
  profileId?: string,
  redirectUrl?: string,
): Promise<{ authUrl: string }> {
  let targetProfileId = profileId;
  if (!targetProfileId) {
    const defaultProfile = await ensureDefaultZernioProfile();
    targetProfileId = defaultProfile._id;
  }

  const query: Record<string, string> = { profileId: targetProfileId };
  if (redirectUrl) {
    query.redirect_url = redirectUrl;
  }

  const res = await zernioRequest<{ authUrl: string }>(`/connect/${platform}`, {
    query,
  });

  return res;
}

/**
 * Получить список привязанных соц. аккаунтов.
 */
export async function listZernioAccounts(profileId?: string): Promise<ZernioAccount[]> {
  try {
    const query: Record<string, string> = {};
    const targetProfileId = profileId || process.env.ZERNIO_PROFILE_ID?.trim();
    if (targetProfileId) query.profileId = targetProfileId;
    const res = await zernioRequest<{ accounts: ZernioAccount[] }>("/accounts", { query });
    return res.accounts || [];
  } catch (e) {
    console.error("[zernio] listZernioAccounts error", e);
    return [];
  }
}

/**
 * Отправить личное сообщение в Instagram Direct (Zernio Inbox API).
 */
export type ZernioSendOptions = {
  attachmentUrl?: string;
  attachmentType?: "image" | "video" | "audio" | "file";
  /**
   * WhatsApp показывает имя документа получателю. Без него имя выводится из
   * URL, а у наших ссылок на материалы в пути лежит идентификатор — покупатель
   * увидел бы «Untitled» вместо названия файла. Для image/video/audio
   * игнорируется самим Zernio.
   */
  attachmentName?: string;
  buttons?: ZernioDmButton[];
  /**
   * Родной interactive-объект Meta (списки, cta_url, flow). Форма повторяет
   * Cloud API дословно, поэтому здесь он не типизируется полем за полем —
   * конструирует его вызывающий код, а не этот слой. Только WhatsApp; при
   * заданном interactive Zernio игнорирует buttons.
   */
  interactive?: Json;
  /**
   * Канал получателя. Нужен ровно для одного решения — дописывать ли
   * инстаграмный хак с кнопкой «Оформить заказ» (см. ниже). По умолчанию
   * instagram: так ведут себя все вызовы, написанные до появления WhatsApp.
   */
  platform?: ZernioPlatform;
};

export async function sendZernioInboxMessage(
  conversationId: string,
  accountId: string,
  message: string,
  opts: ZernioSendOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  const { attachmentUrl, attachmentType, attachmentName, buttons, interactive } = opts;
  const platform = opts.platform ?? "instagram";
  try {
    const body: Record<string, unknown> = buildInstagramInboxMessageBody(accountId, message);

    if (attachmentUrl) {
      body.attachmentUrl = attachmentUrl;
      body.attachmentType = attachmentType || "image";
      if (attachmentName) body.attachmentName = attachmentName;
    }
    if (interactive) {
      body.interactive = interactive;
    } else if (buttons?.length) {
      body.buttons = buttons.slice(0, 3);
    } else if (platform === "instagram" && message.toLowerCase().includes("корзин")) {
      // The Direct store's cart response always exposes the next action;
      // this prevents customers from having to guess a text command.
      //
      // Только для Instagram: там у сообщения максимум три кнопки и нет
      // списков, поэтому следующий шаг приходится угадывать по тексту. В
      // WhatsApp кнопки и списки задаются явно на месте, и дописывание кнопки
      // по подстроке там дало бы вторую кнопку «Оформить заказ» поверх своей.
      body.buttons = [{ type: "postback", title: "Оформить заказ", payload: "CHECKOUT" }];
    }

    // Внутри обработки вебхука повтор доставки не должен обернуться вторым
    // сообщением у клиента — Zernio по этому ключу вернёт исходный ответ.
    const { idempotencyKeyFor } = await import("./zernio-event-context.server");

    await zernioRequest(`/inbox/conversations/${conversationId}/messages`, {
      method: "POST",
      body,
      idempotencyKey: idempotencyKeyFor(body),
    });
    return { ok: true };
  } catch (e) {
    console.error(`[zernio] sendZernioInboxMessage failed for conversation ${conversationId}`, e);
    const details = e instanceof Error ? errorMessage(e) : "";
    const channel = platform === "whatsapp" ? "WhatsApp" : "Instagram";
    /**
     * У WhatsApp есть своя частая и совершенно штатная причина отказа: вне
     * 24-часового окна Meta не пропускает свободный текст. Ошибку про это
     * нужно называть своим именем, иначе продавец читает «проверьте
     * подключение» там, где подключение исправно, а нужен шаблон.
     */
    if (platform === "whatsapp" && /re-?engagement|131047|131026|24[- ]hour/i.test(details)) {
      return {
        ok: false,
        error:
          "Прошло больше 24 часов с последнего сообщения покупателя — WhatsApp разрешает писать только одобренным шаблоном.",
      };
    }
    const error = /inbox add-on required/i.test(details)
      ? `Для этого аккаунта недоступна отправка сообщений (${channel}). Проверьте права подключения и тариф сервиса.`
      : `Не удалось отправить сообщение. Проверьте подключение ${channel} и повторите попытку.`;
    return { ok: false, error };
  }
}

/**
 * Кеш состава профиля на минуту.
 *
 * Проверка ниже стоит на горячем пути вебхука: она выполняется до того, как мы
 * ответим Zernio, а у Zernio на ответ ровно 5 секунд — дальше доставка
 * считается неуспешной и уходит в повтор. Без кеша каждое входящее событие
 * тянуло за собой исходящий запрос `GET /accounts` к тому же Zernio, то есть на
 * ~1670 событиях в сутки столько же лишних round-trip'ов внутри этого бюджета.
 *
 * Состав профиля меняется редко (подключили или отключили аккаунт), так что
 * минута расхождения безобидна: свежеподключённый аккаунт начнёт обслуживаться
 * не позже чем через минуту, а отключённый столько же будет считаться своим —
 * и это не дыра в изоляции, потому что чужой аккаунт в кеше не появится.
 * Ошибку и пустой ответ не кешируем: иначе разовый сбой Zernio погасил бы
 * обработку на всю минуту.
 */
const PROFILE_ACCOUNTS_TTL_MS = 60_000;
let profileAccountsCache: { at: number; profileId: string; accounts: ZernioAccount[] } | null =
  null;

async function accountsInProfile(profileId: string): Promise<ZernioAccount[]> {
  const cached = profileAccountsCache;
  if (
    cached &&
    cached.profileId === profileId &&
    Date.now() - cached.at < PROFILE_ACCOUNTS_TTL_MS
  ) {
    return cached.accounts;
  }
  const accounts = await listZernioAccounts(profileId);
  if (accounts.length > 0) {
    profileAccountsCache = { at: Date.now(), profileId, accounts };
  }
  return accounts;
}

/** Сбрасывает кеш состава профиля — после подключения или отключения аккаунта. */
export function resetProfileAccountsCache() {
  profileAccountsCache = null;
}

/**
 * Fail closed: a deployment may process only accounts in its configured profile.
 *
 * Возвращает канал аккаунта, если он принадлежит профилю этого деплоя, и
 * `null` во всех остальных случаях — аккаунт чужой, профиль не настроен,
 * платформа не из тех, под которые у нас есть рантайм.
 *
 * Раньше это была `isInstagramAccountInConfiguredProfile` с булевым ответом и
 * зашитым `platform === "instagram"`. Проверка стоит на горячем пути вебхука и
 * решает две задачи сразу — «наш ли это аккаунт» и «чей канал», — поэтому
 * ответом должна быть платформа, а не «да/нет»: иначе вызывающему пришлось бы
 * спрашивать про каждый канал отдельно, то есть по разу на платформу за
 * событие.
 */
export async function zernioAccountPlatform(accountId: string): Promise<ZernioPlatform | null> {
  const profileId = process.env.ZERNIO_PROFILE_ID?.trim();
  if (!profileId || !accountId) return null;
  const accounts = await accountsInProfile(profileId);
  const account = accounts.find((candidate) => candidate._id === accountId);
  if (!account) return null;
  return isZernioPlatform(account.platform) ? account.platform : null;
}

/*
 * Ответы на комментарии (replyToInstagramComment, sendInstagramPrivateReply
 * из ответа Comment-to-DM) здесь намеренно не заведены. Родные автоматизации
 * Zernio закрывают комментарии сами — участие нашего кода не требуется (см.
 * комментарий к событиям в registerZernioWebhook и разбор в
 * zernio-bot.server.ts). Раньше обе функции существовали, но ни разу не
 * вызывались — собственный обработчик комментариев убрали, а функции
 * остались. Если Comment-to-DM когда-нибудь понадобится вести отсюда,
 * `POST /inbox/comments/{postId}` и `POST /inbox/comments/{postId}/{commentId}/private-reply`
 * — те самые эндпоинты Zernio; для холодного охвата (Message Requests)
 * private-reply нужно звать с `buttons`, а не текстом — quickReplies там не
 * отображаются.
 */

/** Имя записи вебхука в Zernio. Канал в имени не указан — запись одна на все. */
const ZERNIO_WEBHOOK_NAME = "Store Webhook";
/** Как запись называлась до появления WhatsApp — ищется, чтобы не завести вторую. */
const LEGACY_ZERNIO_WEBHOOK_NAME = "Instagram Store Webhook";

/**
 * Только то, что действительно обрабатывается — первое правило из
 * руководства Zernio по вебхукам.
 *
 * `account.disconnected` подписан отдельно от общего правила «только то,
 * что обрабатывается»: истёкший или отозванный токен иначе означает, что бот
 * молча перестаёт отвечать, и продавец узнаёт об этом только от расстроенного
 * покупателя.
 *
 * `whatsapp.template.status_updated` — вердикт ревью Meta по шаблону.
 * Документация Zernio прямо просит не опрашивать список шаблонов ради
 * этого.
 */
export const ZERNIO_WEBHOOK_EVENTS = [
  "message.received",
  "account.disconnected",
  "whatsapp.template.status_updated",
] as const;

export type ZernioWebhookRecord = {
  _id?: string;
  id?: string;
  url?: string;
  name?: string;
  events?: string[];
  isActive?: boolean;
  active?: boolean;
};

export type ZernioWebhookFit = "missing" | "stale" | "ok";

/**
 * Чужой FrogFlow-деплой уже держит store-webhook.
 *
 * У Zernio один webhook на команду: почасовой ensure на каждом деплое с
 * общим ключом перетягивает URL на себя. Comment-to-DM живёт, а Direct
 * «не срабатывает» — события уезжают на test-con / saltanat / развивашку.
 * Крон не должен отбирать чужую запись; ручная кнопка «Проставить вебхук»
 * по-прежнему переписывает (force).
 */
export function isOtherStoreWebhook(currentUrl: string | undefined, expectedUrl: string): boolean {
  if (!currentUrl) return false;
  try {
    const current = new URL(currentUrl);
    const expected = new URL(expectedUrl);
    if (!/\/api\/public\/zernio\/webhook\/?$/.test(current.pathname)) return false;
    return current.origin !== expected.origin;
  } catch {
    return false;
  }
}

function zernioWebhookIsActive(webhook: ZernioWebhookRecord): boolean {
  if (webhook.isActive === false || webhook.active === false) return false;
  return true;
}

export function findZernioStoreWebhook(
  webhooks: ZernioWebhookRecord[],
  expectedUrl: string,
): ZernioWebhookRecord | undefined {
  return webhooks.find(
    (webhook) =>
      webhook.url === expectedUrl ||
      webhook.name === ZERNIO_WEBHOOK_NAME ||
      webhook.name === LEGACY_ZERNIO_WEBHOOK_NAME,
  );
}

/**
 * Нужно ли трогать запись вебхука. Чистая функция — её можно проверить
 * тестом без ключа Zernio.
 *
 * `stale` — запись есть, но указывает не сюда, выключена или не слушает
 * входящие Direct. Именно это выглядит как «бот в инсте не отвечает на
 * /start», пока Comment-to-DM автоматизации Zernio продолжают слать первое
 * сообщение из комментария.
 */
export function describeZernioWebhookFit(
  webhooks: ZernioWebhookRecord[],
  expectedUrl: string,
): { fit: ZernioWebhookFit; current?: ZernioWebhookRecord } {
  const current = findZernioStoreWebhook(webhooks, expectedUrl);
  if (!current) return { fit: "missing" };
  const events = current.events ?? [];
  const listensForDm = events.includes("message.received");
  if (!zernioWebhookIsActive(current) || current.url !== expectedUrl || !listensForDm) {
    return { fit: "stale", current };
  }
  return { fit: "ok", current };
}

export type ZernioAccountSummary = {
  username: string;
  platform: string;
  expired: boolean;
};

function summarizeZernioAccounts(accounts: ZernioAccount[]): ZernioAccountSummary[] {
  return accounts.map((account) => ({
    username: account.username || account.name || account._id,
    platform: account.platform || "unknown",
    expired: account.isExpired === true,
  }));
}

export type ZernioConnectionReport = {
  expectedUrl: string;
  currentUrl: string | null;
  fit: ZernioWebhookFit;
  accounts: ZernioAccountSummary[];
  error?: string;
};

async function readZernioWebhookSettings(): Promise<ZernioWebhookRecord[]> {
  const current = await zernioRequest<{ webhooks?: ZernioWebhookRecord[] }>("/webhooks/settings");
  return current.webhooks || [];
}

/**
 * Состояние подключения глазами Zernio — без записи. Диагностика и панель
 * оператора смотрят сюда, чтобы отличить «вебхук снят» от «аккаунт Instagram
 * истёк» и от «события просто не приходят».
 */
export async function inspectZernioConnection(): Promise<ZernioConnectionReport> {
  const { appOrigin } = await import("./app-origin.server");
  const origin = appOrigin();
  const expectedUrl = origin ? `${origin}/api/public/zernio/webhook` : "";
  try {
    const [webhooks, accounts] = await Promise.all([
      readZernioWebhookSettings(),
      listZernioAccounts(),
    ]);
    const { fit, current } = describeZernioWebhookFit(webhooks, expectedUrl);
    return {
      expectedUrl,
      currentUrl: current?.url || null,
      fit,
      accounts: summarizeZernioAccounts(accounts),
    };
  } catch (e) {
    return {
      expectedUrl,
      currentUrl: null,
      fit: "missing",
      accounts: [],
      error: errorMessage(e),
    };
  }
}

export type EnsureZernioWebhookResult = {
  ok: boolean;
  action: "skipped" | "unchanged" | "set" | "error";
  url?: string;
  previousUrl?: string | null;
  accounts?: ZernioAccountSummary[];
  error?: string;
};

/**
 * Самовосстановление вебхука Zernio — тот же приём, что `ensureTelegramWebhook`.
 *
 * Telegram чинится на каждом тике cron. Zernio до этого чинился только кнопкой
 * в админке Instagram, поэтому снятая или переехавшая запись молчала сутками:
 * Comment-to-DM продолжал слать первое сообщение из поста, а /start в Direct
 * уже не доходил до магазина.
 */
export async function ensureZernioWebhook(options?: {
  force?: boolean;
}): Promise<EnsureZernioWebhookResult> {
  const { hasModule } = await import("./modules/modules.server");
  if (!(await hasModule("instagram")) && !(await hasModule("whatsapp"))) {
    return { ok: true, action: "skipped" };
  }
  if (!process.env.ZERNIO_API_KEY?.trim()) {
    return { ok: false, action: "error", error: "ZERNIO_API_KEY не задан" };
  }

  const { appOrigin } = await import("./app-origin.server");
  const origin = appOrigin();
  if (!origin) {
    return { ok: false, action: "error", error: "PUBLIC_APP_URL не задан в этом деплое" };
  }
  const expectedUrl = `${origin}/api/public/zernio/webhook`;

  let webhooks: ZernioWebhookRecord[];
  try {
    webhooks = await readZernioWebhookSettings();
  } catch (e) {
    return { ok: false, action: "error", error: errorMessage(e) };
  }

  const { fit, current } = describeZernioWebhookFit(webhooks, expectedUrl);
  const accounts = summarizeZernioAccounts(await listZernioAccounts());

  if (fit === "ok") {
    return { ok: true, action: "unchanged", url: expectedUrl, previousUrl: current?.url, accounts };
  }
  if (!options?.force && current?.url && isOtherStoreWebhook(current.url, expectedUrl)) {
    console.warn("[zernio] webhook belongs to another deploy — not stealing", {
      currentUrl: current.url,
      expectedUrl,
    });
    return {
      ok: true,
      action: "skipped",
      url: current.url,
      previousUrl: current.url,
      accounts,
      error: `общий ключ Zernio: webhook слушает ${current.url}`,
    };
  }

  const registered = await registerZernioWebhook(expectedUrl);
  if (!registered.ok) {
    return {
      ok: false,
      action: "error",
      url: expectedUrl,
      previousUrl: current?.url ?? null,
      accounts,
      error: registered.error,
    };
  }
  console.log("[zernio] webhook restored", { previousUrl: current?.url ?? null, expectedUrl, fit });
  return {
    ok: true,
    action: "set",
    url: expectedUrl,
    previousUrl: current?.url ?? null,
    accounts,
  };
}

/**
 * Зарегистрировать Webhook в Zernio на наш публичный эндпоинт.
 */
export async function registerZernioWebhook(
  webhookUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const secret = process.env.ZERNIO_WEBHOOK_SECRET?.trim();
    if (!secret)
      return { ok: false, error: "Не задана переменная окружения ZERNIO_WEBHOOK_SECRET." };
    /**
     * Подписка была на десять событий при двух обработчиках, причём один из них
     * (`comment.received`) сводился к console.log: комментарии закрывают родные
     * Comment-to-DM автоматизации Zernio, наше участие там не требуется. При
     * этом на `comment.received` приходилось 19 088 событий из 26 865 — 69 % и
     * всего трафика, и таблицы логов. Каждое из них стоило вставки в базу,
     * обновления статуса и места на диске ради строчки в консоли.
     *
     * Статистика по комментариям в админке от этого не пострадала: она читается
     * из `rule.stats` в ответе Zernio (см. getInstagramDashboardFn), а не из
     * наших логов.
     */
    const events = [...ZERNIO_WEBHOOK_EVENTS];
    const current = await zernioRequest<{
      webhooks?: ZernioWebhookRecord[];
    }>("/webhooks/settings");
    /**
     * Вебхуки у Zernio общие на команду, а не на платформу: один эндпоинт
     * получает события и Instagram, и WhatsApp — второй регистрировать не
     * надо, достаточно расширить список событий у существующего.
     *
     * Прежнее имя ищется наравне с новым намеренно: у уже работающих деплоев
     * запись называется «Instagram Store Webhook», и без этой ветки они
     * завели бы вторую запись на тот же URL — то есть каждое событие
     * приходило бы дважды.
     */
    const existing = findZernioStoreWebhook(current.webhooks || [], webhookUrl);
    const response = await zernioRequest<{ success?: boolean; error?: string }>(
      "/webhooks/settings",
      {
        method: existing ? "PUT" : "POST",
        body: {
          ...(existing ? { _id: existing._id || existing.id } : {}),
          name: ZERNIO_WEBHOOK_NAME,
          url: webhookUrl,
          secret,
          events,
          isActive: true,
        },
      },
    );
    if (response.success === false)
      return { ok: false, error: response.error || "Zernio не принял настройки webhook." };
    return { ok: true };
  } catch (e) {
    console.error("[zernio] registerZernioWebhook failed", e);
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * Опубликовать Пост / Карточку в Instagram.
 */
export type CreateInstagramPostInput = {
  accountId: string;
  content: string;
  mediaUrls: string[];
  mediaType: "image" | "video";
  /** Instagram turns a single video into a Reel automatically. */
  contentType?: "story";
  scheduledFor?: string;
  firstComment?: string;
  shareToFeed?: boolean;
  collaborators?: string[];
  isAiGenerated?: boolean;
};

/** Create a Feed post, Reel, Story or carousel now or at a scheduled time. */
export async function createInstagramPost(input: CreateInstagramPostInput): Promise<{
  ok: boolean;
  postId?: string;
  status?: string;
  scheduledFor?: string;
  error?: string;
}> {
  try {
    const platformSpecificData: Record<string, unknown> = {};
    if (input.contentType === "story") platformSpecificData.contentType = "story";
    if (input.mediaType === "video") platformSpecificData.shareToFeed = input.shareToFeed ?? true;
    if (input.collaborators?.length) platformSpecificData.collaborators = input.collaborators;
    if (input.isAiGenerated) platformSpecificData.isAiGenerated = true;
    if (input.firstComment?.trim()) platformSpecificData.firstComment = input.firstComment.trim();

    const body: Record<string, unknown> = {
      content: input.content,
      mediaItems: input.mediaUrls.map((url) => ({ type: input.mediaType, url })),
      platforms: [
        {
          platform: "instagram",
          accountId: input.accountId,
          ...(Object.keys(platformSpecificData).length ? { platformSpecificData } : {}),
        },
      ],
    };
    if (input.scheduledFor) {
      body.scheduledFor = input.scheduledFor;
    } else {
      body.publishNow = true;
    }

    const res = await zernioRequest<{
      post: { _id: string; status?: string; scheduledFor?: string };
    }>("/posts", {
      method: "POST",
      body,
    });

    return {
      ok: true,
      postId: res.post?._id,
      status: res.post?.status,
      scheduledFor: res.post?.scheduledFor,
    };
  } catch (e) {
    console.error("[zernio] createInstagramPost failed", e);
    return { ok: false, error: errorMessage(e) };
  }
}

/** Check the token, permissions and publishing capability of one connected account. */
export async function getZernioAccountHealth(
  accountId: string,
): Promise<ZernioAccountHealth | null> {
  try {
    return await zernioRequest<ZernioAccountHealth>(
      `/accounts/${encodeURIComponent(accountId)}/health`,
    );
  } catch (e) {
    console.error("[zernio] getZernioAccountHealth error", e);
    return null;
  }
}

export async function listZernioConversations(
  accountId: string,
  platform: ZernioPlatform = "instagram",
): Promise<ZernioConversation[]> {
  try {
    const result = await zernioRequest<{ data?: ZernioConversation[] }>("/inbox/conversations", {
      query: { platform, accountId, sortOrder: "desc", limit: "50" },
    });
    return result.data || [];
  } catch (e) {
    console.error("[zernio] listZernioConversations error", e);
    return [];
  }
}

export async function listZernioConversationMessages(
  accountId: string,
  conversationId: string,
): Promise<ZernioInboxMessage[]> {
  try {
    const result = await zernioRequest<{ messages?: ZernioInboxMessage[] }>(
      `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        query: { accountId, limit: "100", sortOrder: "asc" },
      },
    );
    return result.messages || [];
  } catch (e) {
    console.error("[zernio] listZernioConversationMessages error", e);
    return [];
  }
}

/* ───────────────────────── WhatsApp ───────────────────────── */

/**
 * Вердикт ревью Meta по шаблону. Значения приходят от Meta дословно.
 * Отправить можно только APPROVED.
 */
export type WhatsAppTemplateStatus =
  "PENDING" | "APPROVED" | "REJECTED" | "IN_APPEAL" | "PAUSED" | "DISABLED" | "PENDING_DELETION";

export type WhatsAppTemplate = {
  name: string;
  language: string;
  status: WhatsAppTemplateStatus | string;
  category?: string;
  /** Форма компонентов задаётся Meta и уходит к ней же без изменений. */
  components?: Json;
  /** Причина отказа от Meta; при одобрении приходит "NONE". */
  reason?: string;
};

export async function listWhatsAppTemplates(accountId: string): Promise<WhatsAppTemplate[]> {
  try {
    const result = await zernioRequest<{ templates?: WhatsAppTemplate[] }>("/whatsapp/templates", {
      query: { accountId },
    });
    return result.templates || [];
  } catch (e) {
    console.error("[zernio] listWhatsAppTemplates error", e);
    return [];
  }
}

export async function createWhatsAppTemplate(input: {
  accountId: string;
  name: string;
  /** MARKETING допустим, но платится дороже; для магазина почти всегда UTILITY. */
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  language: string;
  components: Json;
}): Promise<{ ok: boolean; template?: WhatsAppTemplate; error?: string }> {
  try {
    const result = await zernioRequest<{ template?: WhatsAppTemplate }>("/whatsapp/templates", {
      method: "POST",
      body: input,
    });
    return { ok: true, template: result.template };
  } catch (e) {
    console.error("[zernio] createWhatsAppTemplate failed", e);
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * Написать в WhatsApp первым — единственный способ начать разговор или
 * вернуться в него после закрытия 24-часового окна.
 *
 * Meta не пропускает свободный текст к человеку, который нам ещё не писал (или
 * писал больше суток назад). Есть ровно два законных пути, и оба заведены
 * здесь:
 *
 *  - `templateName` — одобренный шаблон. Работает всегда, но требует пройти
 *    ревью Meta заранее (до 24 часов) и стоит клиенту денег за доставку.
 *  - `category: "utility"` (Direct Send) — служебное сообщение без заранее
 *    одобренного шаблона: Meta подбирает или заводит шаблон сама. Доступно не
 *    каждому WABA, поэтому это попытка, а не гарантия.
 *
 * Вызывающий код передаёт шаблон, когда он есть, и полагается на utility как
 * на запасной путь. Молча «не отправить» нельзя: для покупателя это выглядит
 * как оплаченный и потерянный заказ.
 */
export async function startWhatsAppConversation(params: {
  accountId: string;
  /** Телефон получателя в международном формате, только цифры. */
  phone: string;
  message?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
}): Promise<{ ok: boolean; conversationId?: string; error?: string }> {
  const body: Record<string, unknown> = {
    accountId: params.accountId,
    participantId: params.phone.replace(/\D/g, ""),
  };
  if (params.templateName) {
    body.templateName = params.templateName;
    if (params.templateLanguage) body.templateLanguage = params.templateLanguage;
    if (params.templateParams?.length) body.templateParams = params.templateParams;
    if (params.message) body.message = params.message;
  } else {
    // Direct Send: category и templateName взаимоисключающи, и message обязателен.
    body.category = "utility";
    body.message = params.message ?? "";
  }

  try {
    const { idempotencyKeyFor } = await import("./zernio-event-context.server");
    const result = await zernioRequest<{ data?: { conversationId?: string } }>(
      "/inbox/conversations",
      { method: "POST", body, idempotencyKey: idempotencyKeyFor(body) },
    );
    return { ok: true, conversationId: result.data?.conversationId };
  } catch (e) {
    console.error("[zernio] startWhatsAppConversation failed", e);
    const details = errorMessage(e);
    if (/TEMPLATE_REQUIRED/i.test(details)) {
      return {
        ok: false,
        error:
          "WhatsApp требует одобренный шаблон, чтобы написать первым. Создайте шаблон во вкладке «Шаблоны» и дождитесь одобрения Meta.",
      };
    }
    if (/Direct Send/i.test(details)) {
      return {
        ok: false,
        error:
          "Этот WhatsApp-аккаунт не допущен к отправке без шаблона. Нужен одобренный шаблон Meta.",
      };
    }
    return { ok: false, error: details };
  }
}

/**
 * Отключить (удалить) аккаунт Instagram из Zernio.
 */
/** Cancel a draft or scheduled post. Published posts are intentionally not deleted. */
export async function deleteZernioPost(postId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await zernioRequest(`/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
    return { ok: true };
  } catch (e) {
    console.error("[zernio] deleteZernioPost failed", e);
    return { ok: false, error: errorMessage(e) };
  }
}

/** Retry a failed post immediately. Zernio keeps the original content and media. */
export async function retryZernioPost(postId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await zernioRequest(`/posts/${encodeURIComponent(postId)}`, {
      method: "PUT",
      body: { publishNow: true, isDraft: false },
    });
    return { ok: true };
  } catch (e) {
    console.error("[zernio] retryZernioPost failed", e);
    return { ok: false, error: errorMessage(e) };
  }
}

export async function disconnectZernioAccount(accountId: string): Promise<{ ok: boolean }> {
  try {
    await zernioRequest(`/accounts/${accountId}`, {
      method: "DELETE",
    });
    return { ok: true };
  } catch (e) {
    console.error("[zernio] disconnectZernioAccount error", e);
    return { ok: false };
  }
}

/**
 * Получить список Comment-to-DM автоматизаций
 */
export async function listCommentAutomations(
  profileId?: string,
): Promise<{ automations: ZernioCommentAutomation[] }> {
  try {
    const query: Record<string, string> = {};
    const targetProfileId = profileId || process.env.ZERNIO_PROFILE_ID?.trim();
    if (targetProfileId) query.profileId = targetProfileId;
    const res = await zernioRequest<{ automations: ZernioCommentAutomation[] }>(
      "/comment-automations",
      { query },
    );
    return res;
  } catch (e) {
    console.error("[zernio] listCommentAutomations error", e);
    return { automations: [] };
  }
}

/** Предел длины текста DM: с кнопками это button_template, и он строже. */
const DM_LIMIT_WITH_BUTTONS = 640;
const DM_LIMIT_PLAIN = 1000;

/**
 * Готовит тело запроса к автоматизации так, как его описывает документация.
 *
 * Две вещи, которые нельзя оставить вызывающему коду.
 *
 * Во-первых, пустые поля надо **опускать, а не слать null**. Для автоматизации
 * «на все посты» доки прямо говорят: omit `platformPostId` и `postId`. Форма же
 * отдаёт явный null (валидатор описан как `.optional().nullable()`), и такой
 * null уходил в Zernio как значение.
 *
 * Во-вторых, длина текста DM ограничена, причём по-разному: с кнопками
 * сообщение превращается в button_template и обязано уложиться в 640 символов,
 * без них предел около 1000. Без проверки Zernio отвечает 400 уже после того,
 * как оператор нажал «Сохранить», и видит он сырую английскую ошибку.
 */
export function buildAutomationBody(
  data: Partial<ZernioCommentAutomation>,
): Record<string, unknown> {
  /**
   * Пропускаем null и undefined — именно ими форма обозначает «поле не
   * заполнено», и именно их доки велят опускать. Пустую строку, наоборот,
   * оставляем: при редактировании ею оператор стирает публичный ответ или
   * метку клика, и если её проглотить, Zernio сохранит прежнее значение —
   * поле будет невозможно очистить. Пустой массив ключевых слов тоже
   * значащий: по докам это «срабатывать на любой комментарий».
   */
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    // Идентификаторы поста пустой строкой не задают — это то же «на все посты».
    if ((key === "platformPostId" || key === "postId") && value === "") continue;
    body[key] = value;
  }

  // Ключевые слова сравниваются в нижнем регистре — иначе «Хочу» и «хочу»
  // станут разными правилами.
  if (Array.isArray(body.keywords)) {
    body.keywords = (body.keywords as string[]).map((k) => k.toLowerCase().trim()).filter(Boolean);
  }

  const dmMessage = typeof body.dmMessage === "string" ? body.dmMessage : "";
  if (!dmMessage.trim()) {
    throw new Error(
      "Текст сообщения в Direct обязателен — без него автоматизации нечего отправить.",
    );
  }

  const hasButtons = Array.isArray(body.buttons) && (body.buttons as unknown[]).length > 0;
  const limit = hasButtons ? DM_LIMIT_WITH_BUTTONS : DM_LIMIT_PLAIN;
  if (dmMessage.length > limit) {
    throw new Error(
      hasButtons
        ? `Сообщение в Direct — ${dmMessage.length} символов, а с кнопками помещается ${limit}. Сократите текст или уберите кнопки.`
        : `Сообщение в Direct — ${dmMessage.length} символов, предел ${limit}. Сократите текст.`,
    );
  }

  // Варианты текста ротируются вместе с основным, поэтому предел тот же.
  for (const field of ["dmMessageVariations", "commentReplyVariations"] as const) {
    const variations = body[field];
    if (!Array.isArray(variations)) continue;
    const tooLong = (variations as string[]).find((text) => text.length > limit);
    if (tooLong) {
      throw new Error(`Один из вариантов текста длиннее ${limit} символов. Сократите его.`);
    }
  }

  return body;
}

/**
 * Создать Comment-to-DM автоматизацию
 */
export async function createCommentAutomation(
  data: Partial<ZernioCommentAutomation>,
): Promise<{ ok: boolean; error?: string; automation?: ZernioCommentAutomation }> {
  try {
    const body = buildAutomationBody(data);

    const res = await zernioRequest<{
      success: boolean;
      automation: ZernioCommentAutomation;
      error?: string;
    }>("/comment-automations", {
      method: "POST",
      body,
    });
    return { ok: res.success, automation: res.automation, error: res.error };
  } catch (e: unknown) {
    console.error("[zernio] createCommentAutomation error", e);
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * Обновить Comment-to-DM автоматизацию
 */
export async function updateCommentAutomation(
  automationId: string,
  data: Partial<ZernioCommentAutomation>,
): Promise<{ ok: boolean; error?: string; automation?: ZernioCommentAutomation }> {
  try {
    const body = buildAutomationBody(data);

    const res = await zernioRequest<{
      success: boolean;
      automation: ZernioCommentAutomation;
      error?: string;
    }>(`/comment-automations/${automationId}`, {
      method: "PATCH",
      body,
    });
    return { ok: res.success, automation: res.automation, error: res.error };
  } catch (e: unknown) {
    console.error("[zernio] updateCommentAutomation error", e);
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * Удалить Comment-to-DM автоматизацию
 */
export async function deleteCommentAutomation(automationId: string): Promise<{ ok: boolean }> {
  try {
    await zernioRequest(`/comment-automations/${automationId}`, {
      method: "DELETE",
    });
    return { ok: true };
  } catch (e) {
    console.error("[zernio] deleteCommentAutomation error", e);
    return { ok: false };
  }
}

/**
 * Получить логи автоматизации. Каждая строка несёт commentId и status
 * ("sent"/"failed"/"skipped") — этим пользуется comment-dm-fallback.server.ts,
 * чтобы понять, отработал ли Zernio конкретный комментарий, прежде чем
 * пытаться резервной отправкой. limit по умолчанию Zernio не документирует —
 * для диагностики (последние 5) хватает дефолта, а fallback-у нужен явный
 * limit побольше, чтобы не пропустить старое срабатывание за пределами
 * первой страницы.
 */
export async function getCommentAutomationLogs(
  automationId: string,
  options: { limit?: number } = {},
): Promise<{ logs: Record<string, Json>[] }> {
  try {
    const res = await zernioRequest<{ logs: Record<string, Json>[] }>(
      `/comment-automations/${automationId}/logs`,
      options.limit ? { query: { limit: String(options.limit) } } : {},
    );
    return { logs: res.logs || [] };
  } catch (e) {
    console.error("[zernio] getCommentAutomationLogs error", e);
    return { logs: [] };
  }
}

export type ZernioInstagramComment = {
  id?: string;
  message?: string;
  createdTime?: string;
  from?: { id?: string; name?: string; username?: string; isOwner?: boolean };
  likeCount?: number;
  replyCount?: number;
  platform?: string;
  url?: string | null;
  canReply?: boolean;
  isHidden?: boolean;
};

/**
 * Потолок страниц за один вызов — не бизнес-ограничение (под постом может
 * реально быть больше пятисот комментариев, и обрезать их произвольно —
 * то же самое неведение, из-за которого затевалась вся эта правка), а
 * только защита от зацикливания, если Zernio когда-нибудь вернёт один и тот
 * же cursor бесконечно. Дефолтный размер страницы у Zernio нигде не
 * документирован (на практике видели 25) — с этим потолком запас на много
 * тысяч комментариев, больше, чем можно ожидать под одним постом.
 */
const COMMENTS_MAX_PAGES = 100;

/**
 * Комментарии под постом — для догоняющей рассылки, когда Comment-to-DM
 * перестал отвечать под конкретным постом (см. диагностику "Правила
 * Comment-to-DM: подробности"), а старые комментарии остались без ответа.
 *
 * GET /inbox/comments/{postId} — «Get post comments», accountId строго
 * query-параметром (не телом): POST на тот же путь — это отдельная ручка
 * «Reply to comment», которая публикует новый комментарий/ответ на живом
 * посте. Форма подтверждена по документации Zernio (см. Response Body
 * раздела "Get post comments"); `raw` возвращается рядом для отладки на
 * случай реального расхождения (только последняя прочитанная страница).
 *
 * Раньше вызов не читал pagination.hasMore/cursor из ответа вовсе — значит
 * всегда получал только первую страницу дефолтного размера Zernio
 * (недокументирован), и если под постом комментариев больше этой страницы
 * (ровно наш случай — сотня с лишним пропущенных), свежие или старые
 * комментарии могли просто не попасть в список, в зависимости от сортировки
 * Zernio. Теперь ходим по cursor до потолка страниц ниже.
 *
 * Явный `limit` в запросе НЕ передаём: первая попытка задать его (100)
 * привела к `Platform error: 100` от самого Instagram (не от валидации
 * Zernio — код "platform_api_error") на первом же боевом посте, при том что
 * без limit тот же запрос всегда проходил нормально. Раз дефолт Zernio и
 * так работает, не рискуем — доверяем ему на каждой странице вместо
 * собственного числа.
 */
export async function listInstagramComments(
  postId: string,
  accountId: string,
): Promise<{ comments: ZernioInstagramComment[]; raw: Json }> {
  const allComments: ZernioInstagramComment[] = [];
  let cursor: string | undefined;
  let lastRaw: Json = null;

  for (let page = 0; page < COMMENTS_MAX_PAGES; page++) {
    const query: Record<string, string> = { accountId };
    if (cursor) query.cursor = cursor;

    const res = await zernioRequest<Json>(`/inbox/comments/${encodeURIComponent(postId)}`, {
      method: "GET",
      query,
    });
    lastRaw = res;

    const obj = res && typeof res === "object" ? (res as Record<string, Json>) : {};
    const list = Array.isArray(obj.comments) ? obj.comments : [];
    allComments.push(...(list as ZernioInstagramComment[]));

    const pagination =
      obj.pagination && typeof obj.pagination === "object"
        ? (obj.pagination as Record<string, Json>)
        : null;
    const nextCursor = typeof pagination?.cursor === "string" ? pagination.cursor : undefined;
    if (pagination?.hasMore !== true || !nextCursor) break;
    cursor = nextCursor;
  }

  return { comments: allComments, raw: lastRaw };
}

/**
 * Приватный ответ на конкретный комментарий — догоняющая рассылка тем, кого
 * Comment-to-DM пропустил. Для человека, который раньше не писал в директ
 * (наш случай — холодный охват), Instagram кладёт такое сообщение в «Запросы
 * на сообщения», и там нужен button-template (`buttons`), а не голый текст —
 * quickReplies там не отображаются (подтверждено документацией Zernio:
 * `buttons` и `quickReplies` взаимоисключающие, только `buttons` виден в
 * «Запросах на сообщения»). Ограничение платформы: один приватный ответ на
 * комментарий и не позже 7 дней с момента комментария — отсюда свой
 * idempotency-ключ ниже, а не только платформенное ограничение.
 * idempotencyKey свой, не через idempotencyKeyFor: тот привязан
 * к контексту обрабатываемого вебхук-события (AsyncLocalStorage) и здесь,
 * при отправке вручную из панели, всегда пуст — вне события повтор
 * осмысленный и не должен подавляться (см. zernio-event-context.server.ts).
 * Массовая рассылка — другое дело: тут повтор одного и того же (postId,
 * commentId) почти наверняка случайный (двойной клик, ретрай сети), и
 * дублировать сообщение реальному человеку не нужно.
 */
export async function sendCommentPrivateReply(
  postId: string,
  commentId: string,
  accountId: string,
  message: string,
  buttons: ZernioDmButton[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    await zernioRequest(
      `/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/private-reply`,
      {
        method: "POST",
        body: { accountId, message, buttons: buttons.slice(0, 3) },
        idempotencyKey: `catchup-reply:${postId}:${commentId}`,
      },
    );
    return { ok: true };
  } catch (e) {
    console.error(`[zernio] sendCommentPrivateReply failed for comment ${commentId}`, e);
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * Получить список постов (для выбора Post ID в автоответах)
 */
export async function listZernioPosts(accountId: string): Promise<ZernioPost[]> {
  try {
    const [analyticsResult, externalResult, zernioResult, storiesResult] = await Promise.allSettled(
      [
        // This endpoint is the authoritative source for the native Instagram media
        // ID: platformAnalytics[].platformPostId. /posts may expose only a Zernio ID.
        zernioRequest<{ posts?: ZernioPost[] }>(`/analytics`, {
          query: { accountId, platform: "instagram", source: "all", limit: "50" },
        }),
        // GET /posts?source=external only reflects Zernio's background sync, which
        // refreshes each account at most every ~90 minutes — far too slow for a
        // "just published, refresh now" flow. sync-external forces an on-demand
        // live fetch from the platform instead (debounced ~15s per account server
        // side, so calling it on every refresh click is safe).
        zernioRequest<{ posts?: ZernioPost[] }>(`/posts/sync-external`, {
          method: "POST",
          body: { accountId },
        }),
        zernioRequest<{ posts: ZernioPost[] }>(`/posts`, {
          query: { accountId, source: "zernio", limit: "50" },
        }),
        // Active stories are intentionally not returned by GET /posts.
        zernioRequest<{ stories?: ZernioPost[] }>(
          `/accounts/${encodeURIComponent(accountId)}/instagram/stories`,
        ),
      ],
    );
    const analyticsRes =
      analyticsResult.status === "fulfilled" ? analyticsResult.value : { posts: [] };
    const externalRes =
      externalResult.status === "fulfilled" ? externalResult.value : { posts: [] };
    const zernioRes = zernioResult.status === "fulfilled" ? zernioResult.value : { posts: [] };
    const storiesRes = storiesResult.status === "fulfilled" ? storiesResult.value : { stories: [] };
    if (storiesResult.status === "rejected")
      console.warn("[zernio] unable to load active Instagram stories", storiesResult.reason);
    // Zernio-объекты вложены на один уровень (metadata, platformAnalytics[],
    // mediaItems[]…), а дальше это уже произвольный JSON. Эти два помощника —
    // единственное место, где мы говорим типам «доверься»: дальше код читает
    // вложенные поля тем же `?.`, что и раньше, без ANY на каждом шаге.
    const asPost = (v: Json | undefined): ZernioPost =>
      v && typeof v === "object" && !Array.isArray(v) ? (v as ZernioPost) : {};
    const asPosts = (v: Json | undefined): ZernioPost[] =>
      Array.isArray(v) ? (v as ZernioPost[]) : [];
    const asText = (v: Json | undefined): string | undefined =>
      typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
    // `_date` is frequently an ISO string (Zernio's publishedAt), not a unix
    // timestamp — Number(isoString) is NaN, so this must go through `new
    // Date()` directly, the same way it accepts both forms natively.
    const asDate = (v: Json | undefined): Date | null => {
      if (typeof v !== "number" && typeof v !== "string") return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const findPlatform = (items: ZernioPost[]) =>
      items.find((item) => asText(item.accountId) === accountId && item.platform === "instagram");

    const analyticsPosts = (analyticsRes.posts || []).map((post) => {
      const platformData = findPlatform(asPosts(post.platformAnalytics));
      return {
        ...post,
        _zernioPostId: post.latePostId || post.postId || post._id || post.id || null,
        platformPostId: platformData?.platformPostId || post.platformPostId || null,
      };
    });
    // Analytics is authoritative and already contains the platform media ID, so
    // it's the base list. But analytics indexing can itself lag a freshly
    // synced post, so any externally-synced post analytics doesn't have yet
    // (matched by the platform's own platformPostId, not a Zernio-internal id)
    // is appended rather than dropped — that's exactly the post that was just
    // published and is why the refresh was clicked.
    const analyticsPlatformIds = new Set(
      analyticsPosts.map((p) => p.platformPostId).filter(Boolean),
    );
    const newlySyncedExternalPosts = (externalRes.posts || []).filter(
      (p) => p.platformPostId && !analyticsPlatformIds.has(p.platformPostId),
    );
    const regularPosts: ZernioPost[] =
      analyticsPosts.length > 0
        ? [...analyticsPosts, ...newlySyncedExternalPosts]
        : [...(externalRes.posts || []), ...(zernioRes.posts || [])];
    const allPosts: ZernioPost[] = [
      ...regularPosts,
      ...(storiesRes.stories || []).map((story) => ({
        ...story,
        platformPostId: story.platformPostId || story.id || story._id,
        thumbnailUrl: story.thumbnailUrl || story.mediaUrl,
        publishedAt: story.timestamp,
        type: "story",
      })),
    ];

    const uniquePosts: ZernioPost[] = [];
    const seen = new Set();
    const seenPostFingerprints = new Set();

    for (const p of allPosts) {
      // A Zernio-created post has two IDs. The root ID identifies the Zernio
      // record, while platformAnalytics.platformPostId is the native Instagram
      // media ID required by Comment-to-DM targeting.
      const platformAnalytics = findPlatform(asPosts(p.platformAnalytics));
      const platformTarget = findPlatform(asPosts(p.platforms));
      const metadata = asPost(p.metadata);
      p._zernioPostId = p._zernioPostId || p.latePostId || p._id || p.id || p.postId || null;
      p.platformPostId =
        platformAnalytics?.platformPostId ||
        platformTarget?.platformPostId ||
        p.platformPostId ||
        metadata.platformPostId ||
        null;
      const id = p.platformPostId || p._zernioPostId;
      if (id && !seen.has(id)) {
        seen.add(id);

        // Normalize text/caption
        if (!p.caption && (p.text || p.content || metadata.caption)) {
          p.caption = p.text || p.content || metadata.caption;
        }

        // Normalize thumbnail for UI display
        // Zernio API returns: thumbnailUrl (top-level), mediaItems[].thumbnail, mediaItems[].url
        const mediaItem = asPosts(p.mediaItems)[0];
        p._thumbnail = p.thumbnailUrl || mediaItem?.thumbnail || mediaItem?.url || null;

        // Normalize date for UI display
        // `createdAt` is the time the record was created in Zernio, not when it
        // was published to Instagram, so it must never be shown as a post date.
        const rawDate =
          p.publishedAt ||
          metadata.publishedAt ||
          metadata.timestamp ||
          p.timestamp ||
          platformTarget?.publishedAt ||
          platformTarget?.published_at ||
          p.scheduledFor ||
          null;
        // Some Meta payloads use Unix seconds; Date expects milliseconds.
        const rawDateText = asText(rawDate);
        const timestamp = rawDateText && /^\d+$/.test(rawDateText) ? Number(rawDateText) : rawDate;
        p._date =
          typeof timestamp === "number" && timestamp < 10_000_000_000
            ? timestamp * 1000
            : timestamp;

        // Zernio can return the same Instagram media from separate analytics
        // records. Their internal IDs differ, so also deduplicate by content.
        const parsedDate = asDate(p._date);
        const dateKey =
          parsedDate && !Number.isNaN(parsedDate.getTime())
            ? parsedDate.toISOString().slice(0, 10)
            : "";
        const textKey = String(p.caption || p.content || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        const mediaKey = p.platformPostUrl || p.permalink || p._thumbnail || "";
        const fingerprint = `${dateKey}|${textKey}|${mediaKey}`;
        if (fingerprint !== "||" && seenPostFingerprints.has(fingerprint)) continue;
        seenPostFingerprints.add(fingerprint);

        // Mark if it's a story
        p._isStory = p.type === "story" || metadata.type === "story" || !!metadata.story_id;

        uniquePosts.push(p);
      }
    }

    // `_date` may be an ISO string (for example, `publishedAt`). Converting it
    // with Number() yields NaN, leaving freshly synced Reels at the end in the
    // API's original order instead of putting the newest publication first.
    return uniquePosts.sort(
      (a, b) => (asDate(b._date)?.getTime() || 0) - (asDate(a._date)?.getTime() || 0),
    );
  } catch (e) {
    console.error("[zernio] listZernioPosts error", e);
    return [];
  }
}

/**
 * Досинхронизировать один конкретный пост по ссылке — задокументированный у
 * Zernio «primary use case» для POST /posts/sync-external с `url`: клиент
 * только что опубликовал пост, автоматический фоновый sync подхватывает
 * внешние публикации только раз в ~90 минут на аккаунт, а без `url` тот же
 * эндпоинт лишь обновляет уже известную Zernio ленту — не гарантирует, что
 * попадёт именно этот пост (наблюдали: Reels может не попасть, хотя фото
 * с той же публикации уже подтянулись). С конкретной ссылкой Zernio ищет
 * ровно её, а не «последние N», и результат детерминирован.
 */
export async function syncExternalPostByUrl(
  accountId: string,
  url: string,
): Promise<{ found: boolean; post: ZernioPost | null }> {
  const res = await zernioRequest<{ found?: boolean; post?: ZernioPost | null }>(
    "/posts/sync-external",
    { method: "POST", body: { accountId, url } },
  );
  return { found: res.found === true, post: res.post ?? null };
}
