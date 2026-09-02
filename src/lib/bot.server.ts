import { tg, downloadTelegramFile } from "./telegram.server";
import { errorMessage } from "@/lib/error-message";
import { requireAppOrigin } from "./app-origin.server";
import { imageUrl } from "./public-image";
import { replyIfBlocked } from "./blocked-users.server";
import { handleManagerChatInbound, handleManagerChatCallback } from "./manager-chat.server";
import { botStatus, pausedMessage, hasModule } from "./modules/modules.server";
import { isTelegramAdmin, parseNotifyAdminIds } from "./telegram-webhook.server";
import type { Json } from "@/integrations-supabase/types";
import type { OrderItem } from "./orders.server";
import type { ReceiptVerifyResult } from "./receipt-verify.server";
import { isLocale, localeNames, localeFlags, SUPPORTED_LOCALES, type Locale } from "./i18n";
import { currentVerticalDef } from "./verticals/vertical.server";
import { collectTgMessageIds, type AdminNotifyTgRef } from "./admin-order-notify";
import {
  dismissAdminOrderNotifications,
  rememberAdminNotifyMessages,
} from "./admin-order-notify.server";

/** Товар с картинками — снимок ровно тех полей, что показывает карточка (sendProductCard). */
type ProductCard = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string | null;
  country_prices: Json | null;
  product_images: Array<{ image_path: string; sort_order: number }> | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  stock_quantity?: number | null;
  /** Простой список вариантов (Ниши, Блок D) — «1 кг»/«2 кг» с ценой. */
  product_variants?: Array<{ id: string; name: string; price: number; sort_order: number }> | null;
  /** Срок изготовления, дней — показывается в карточке ДО покупки (Блок 4, находка 4.21). */
  lead_time_days?: number | null;
};

/**
 * Ровно то подмножество полей Update из Telegram Bot API, которое реально
 * читает handleUpdate. Не полный тип апдейта — Telegram присылает и другие
 * виды (inline_query, poll и т.д.), которых этот бот не обрабатывает вовсе.
 */
export type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
};

export type TelegramMessage = {
  chat: { id: number; type?: string };
  from?: TelegramUser;
  text?: string;
  /** Подпись к фото/документу — Telegram кладёт её сюда, а не в `text`. */
  caption?: string;
  contact?: { phone_number: string };
  document?: { file_id: string; file_name?: string; mime_type?: string };
  photo?: Array<{ file_id: string }>;
};

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from?: TelegramUser;
  message?: {
    chat?: { id: number };
    message_id?: number;
    // Нужно только для manager-chat.server.ts: найти подпись нажатой
    // инлайн-кнопки по callback_data, чтобы в /admin/manager-chat было
    // видно не код вроде "cat:12", а текст самой кнопки.
    reply_markup?: { inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>> };
  };
};

/** Подпись нажатой инлайн-кнопки — для лога /admin/manager-chat, чтобы там был текст «📚 Каталог», а не сырой callback_data вроде "cat:12". */
function callbackButtonLabel(cq: TelegramCallbackQuery): string {
  const rows = cq.message?.reply_markup?.inline_keyboard ?? [];
  for (const row of rows) {
    for (const btn of row) {
      if (btn.callback_data === cq.data) return btn.text;
    }
  }
  return cq.data || "";
}

export type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type BotUser = {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  contact_phone: string | null;
  loyalty_points?: number;
  state: {
    /**
     * Не полноценная машина состояний — просто типизированный набор
     * известных значений вместо голого string, чтобы опечатка в новом mode
     * ловилась tsc, а не тихо проваливалась в default-ветку где-то в
     * handleUpdate. Список — по факту использования в этом файле.
     */
    mode?:
      | "idle"
      | "search"
      | "awaiting_contact"
      | "awaiting_payment"
      | "awaiting_proof"
      | "choose_pay"
      | "awaiting_promo_code"
      | "awaiting_review_comment"
      | "awaiting_gift_certificate_code"
      | "awaiting_fulfillment_type"
      | "awaiting_fulfillment_date"
      | "awaiting_delivery_zone"
      | "awaiting_address"
      | "awaiting_fulfillment_note";
    /** Списать баллы при оформлении — переключатель, не текстовый ввод. */
    use_points?: boolean;
    /** Товар, для которого только что поставлена оценка и ждём комментарий. */
    review_product_id?: string;
    gift_certificate_code?: string;
    pending_order_id?: number;
    /**
     * Номер заказа, замороженный один раз (orders.display_no, MIGRATION-28) —
     * тот же самый номер, что уже показан покупателю в «Заказ №X создан»,
     * нужен здесь, чтобы позже, когда придёт чек, «отправлен на проверку»
     * показал то же число, а не живой order_no (его двигает ночная
     * перенумерация — покупатель мог прислать чек через день).
     */
    pending_display_no?: number;
    country_code?: string;
    country_name?: string;
    last_search?: string;
    /** Explicit UI language selected by the customer (not Telegram's device language). */
    locale?: Locale;
    /** When true, attaching a payment receipt auto-delivers files (RU/KZ with Robokassa on). */
    proof_auto?: boolean;
    /** Транзиентный флаг claimOrderPlacement — оформление заказа уже идёт. */
    placing_order?: boolean;
    /**
     * Язык доставки, выбранный ДО оформления (настройка delivery_lang_timing
     * = "before") — снят сразу же, как только placeOrderInner его прочитал,
     * тем же путём, что и placing_order.
     */
    checkout_lang_choice?: DeliveryLangChoice;
    /** Промокод, применённый в корзине — считывается и снимается в placeOrderInner. */
    promo_code?: string;
    /**
     * Данные получения физического заказа (Ниши, Блок 8) — собираются в
     * чекауте до placeOrder и снимаются в placeOrderInner тем же приёмом,
     * что checkout_lang_choice/promo_code. У цифровой корзины не заводятся.
     */
    checkout_fulfillment_type?: "pickup" | "delivery";
    /** Дата получения, ISO (YYYY-MM-DD) — без времени, время не спрашиваем. */
    checkout_fulfillment_at?: string;
    /**
     * Минимально допустимая дата, замороженная в момент показа вопроса о
     * дате (Блок 4, находка 4.22) — раньше askFulfillmentDate и валидация
     * ответа пересчитывали maxLeadTimeDaysInCart по отдельности; правка
     * срока изготовления продавцом между этими двумя моментами отклоняла
     * дату, которую бот только что назвал допустимой в самом вопросе.
     */
    checkout_min_fulfillment_date?: string;
    /**
     * Выбранная зона доставки (Ниши, Блок B) — id и снимок имени/цены на
     * момент выбора, тем же приёмом, что и остальные checkout_fulfillment_*.
     * Заводится только если у продавца есть хоть одна активная зона —
     * иначе шаг пропускается целиком (обратная совместимость).
     */
    checkout_delivery_zone_id?: string;
    checkout_delivery_zone_name?: string;
    checkout_delivery_fee?: number;
    checkout_fulfillment_address?: string;
    checkout_fulfillment_note?: string;
    /** После переноса корзины с веб-витрины — запустить оформление после выбора языка. */
    web_handoff_pending_checkout?: boolean;
  } | null;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

/**
 * Пауза/приостановка (bots.status <> active) отвечает вежливым текстом и не
 * трогает вебхук — Telegram не знает, что бот на паузе. Ни токен, ни отзыв
 * вебхука не нужны: см. CONTROL-PLANE-PLAN.md §5.
 */
async function replyIfPaused(chat_id: number): Promise<boolean> {
  const status = await botStatus();
  if (status === "active") return false;
  await tg("sendMessage", { chat_id, text: await pausedMessage() });
  return true;
}

// Ссылки на свой каталог и картинки товаров в сообщениях бота.
const originFromState = requireAppOrigin;

function isCountryRF(countryCode?: string | null): boolean {
  if (!countryCode) return false;
  const code = countryCode.trim().toUpperCase();
  return code === "RU" || code === "RUS" || code === "РФ" || code === "РОССИЯ";
}

/** Countries that only pay by receipt with auto-delivery when Robokassa is on (no Robokassa link). */
function isProofAutoOnlyCountry(countryCode?: string | null): boolean {
  if (isCountryRF(countryCode)) return true;
  const code = (countryCode || "").trim().toUpperCase();
  return code === "BY" || code === "OTHER";
}

/** Robokassa: согласие + ссылки на оферту и политику (HTML для сообщений в чате). */
function legalConsentHtml(base: string, locale: Locale = "ru"): string {
  const copy: Record<Locale, [string, string, string]> = {
    ru: [
      "Нажимая /start, вы соглашаетесь с:",
      "Условиями использования",
      "Политикой конфиденциальности",
    ],
    kk: [
      "/start пәрменін басу арқылы сіз мыналармен келісесіз:",
      "Пайдалану шарттарымен",
      "Құпиялылық саясатымен",
    ],
    en: ["By pressing /start, you agree to:", "Terms of Use", "Privacy Policy"],
    uz: [
      "/start tugmasini bosish orqali quyidagilarga rozilik bildirasiz:",
      "Foydalanish shartlari",
      "Maxfiylik siyosati",
    ],
  };
  const [intro, terms, privacy] = copy[locale];
  return (
    `${intro}\n` +
    `• <a href="${base}/legal/offer">${terms}</a>\n` +
    `${base}/legal/offer\n` +
    `• <a href="${base}/legal/privacy">${privacy}</a>\n` +
    `${base}/legal/privacy`
  );
}

/** Текст профиля бота («Что умеет этот бот?») — plain text, лимит Telegram 512. */
export function botPublicDescription(base = originFromState()): string {
  const text =
    `${currentVerticalDef().botDescriptionIntro}\n\n` +
    `Нажимая /start, вы соглашаетесь с:\n` +
    `• Условиями использования\n` +
    `${base}/legal/offer\n` +
    `• Политикой конфиденциальности\n` +
    `${base}/legal/privacy`;
  return text.slice(0, 512);
}

export async function syncBotPublicDescription() {
  const description = botPublicDescription();
  try {
    await tg("setMyDescription", { description });
    await tg("setMyShortDescription", {
      short_description: currentVerticalDef().shortDescription.slice(0, 120),
    });
  } catch (e) {
    console.error("[bot] setMyDescription failed", e);
  }
}

function welcomeStartHtml(
  firstName: string | null,
  withCountryHint: boolean,
  locale: Locale = "ru",
): string {
  const base = originFromState();
  const copy: Record<
    Locale,
    {
      hello: string;
      friend: string;
      documents: string;
      hint: string;
    }
  > = {
    ru: {
      hello: "Привет",
      friend: "друг",
      documents: "Документы и реквизиты — в «ℹ️ Информация»",
      hint: "Сначала выберите страну — или откройте «ℹ️ Информация».",
    },
    kk: {
      hello: "Сәлем",
      friend: "дос",
      documents: "Құжаттар мен деректемелер — «ℹ️ Ақпарат» бөлімінде",
      hint: "Алдымен еліңізді таңдаңыз немесе «ℹ️ Ақпарат» бөлімін ашыңыз.",
    },
    en: {
      hello: "Hello",
      friend: "friend",
      documents: "Documents and payment details are in “ℹ️ Information”",
      hint: "First choose your country, or open “ℹ️ Information”.",
    },
    uz: {
      hello: "Salom",
      friend: "do‘st",
      documents: "Hujjatlar va to‘lov ma’lumotlari “ℹ️ Ma’lumot” bo‘limida",
      hint: "Avval mamlakatingizni tanlang yoki “ℹ️ Ma’lumot” bo‘limini oching.",
    },
  };
  const c = copy[locale];
  const v = currentVerticalDef().locales[locale];
  const name = firstName || c.friend;
  const hint = withCountryHint ? `\n\n${c.hint}` : "";
  return (
    `${c.hello}, ${escapeHtml(name)}! ${v.welcomeGreeting}\n\n` +
    `→ ${v.welcomeCatalog}\n→ ${v.welcomePayment}\n→ ${c.documents}\n\n` +
    legalConsentHtml(base, locale) +
    hint
  );
}

function formatMoney(amount: number | string, currency: string): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  const value = Number.isFinite(n)
    ? Number.isInteger(n)
      ? String(n)
      : n.toFixed(2)
    : String(amount);
  const cur = (currency || "").toUpperCase();
  if (cur === "KZT") return `${value} ₸`;
  return `${value} ${currency}`;
}

function categoryButtonLabel(name: string): string {
  const trimmed = name.trim();
  if (/^(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u.test(trimmed)) return trimmed;
  return `📁 ${trimmed}`;
}

async function upsertUser(from: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}): Promise<BotUser> {
  const s = await db();

  // 1. Try to get existing user
  const { data: existing } = await s
    .from("bot_users")
    .select("*")
    .eq("telegram_id", from.id)
    .maybeSingle();

  if (existing) {
    // 2. Update profile if changed (don't touch state)
    const { data: updated, error } = await s
      .from("bot_users")
      .update({
        username: from.username ?? existing.username,
        first_name: from.first_name ?? existing.first_name,
        last_name: from.last_name ?? existing.last_name,
        language_code: from.language_code ?? existing.language_code,
      })
      .eq("telegram_id", from.id)
      .select("*")
      .single();

    if (error) console.error("[bot] updateUser error", error);
    return (updated || existing) as BotUser;
  }

  // 3. New user: insert
  const userKey = `tg_${from.id}`;
  const { data: inserted, error } = await s
    .from("bot_users")
    .insert({
      telegram_id: from.id,
      user_key: userKey,
      platform: "telegram",
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      language_code: from.language_code ?? null,
      state: {},
    })
    .select("*")
    .single();

  if (error) {
    console.error("[bot] insertUser error", error);
  }

  return (inserted || {
    telegram_id: from.id,
    username: from.username ?? null,
    first_name: from.first_name ?? null,
    last_name: from.last_name ?? null,
    language_code: from.language_code ?? null,
    contact_phone: null,
    state: null,
  }) as BotUser;
}

async function setState(telegram_id: number, state: BotUser["state"]) {
  const s = await db();

  // Если в state нет country_code, попробуем сохранить старый из базы, чтобы не затереть
  if (state && !state.country_code) {
    const { data: existing } = await s
      .from("bot_users")
      .select("state")
      .eq("telegram_id", telegram_id)
      .maybeSingle();

    // `state` в базе — jsonb, то есть по типам это Json: скаляр и массив там
    // не менее допустимы, чем объект. Читаем страну только из настоящего
    // объекта, иначе обращение к полю на строке молча дало бы undefined.
    const prev = existing?.state;
    const prevState =
      prev && typeof prev === "object" && !Array.isArray(prev)
        ? (prev as NonNullable<BotUser["state"]>)
        : null;

    if (prevState?.country_code) {
      state.country_code = prevState.country_code;
      state.country_name = prevState.country_name;
    }
  }

  // Обновляем по user_key если он существует, иначе по telegram_id (обратная совместимость)
  const userKey = `tg_${telegram_id}`;
  const { data: byKey } = await s
    .from("bot_users")
    .select("user_key")
    .eq("user_key", userKey)
    .maybeSingle();
  if (byKey) {
    await s
      .from("bot_users")
      .update({ state: state ?? {} })
      .eq("user_key", userKey);
  } else {
    await s
      .from("bot_users")
      .update({ state: state ?? {} })
      .eq("telegram_id", telegram_id);
  }
}

async function setContact(telegram_id: number, phone: string) {
  const s = await db();
  const userKey = `tg_${telegram_id}`;
  const { data: byKey } = await s
    .from("bot_users")
    .select("user_key")
    .eq("user_key", userKey)
    .maybeSingle();
  if (byKey) {
    await s.from("bot_users").update({ contact_phone: phone }).eq("user_key", userKey);
  } else {
    await s.from("bot_users").update({ contact_phone: phone }).eq("telegram_id", telegram_id);
  }
}

const botCopy: Record<
  Locale,
  Record<
    | "chooseLanguage"
    | "chooseSection"
    | "catalog"
    | "search"
    | "cart"
    | "myOrders"
    | "instruction"
    | "information"
    | "languageSaved"
    | "miniAppShop",
    string
  >
> = {
  ru: {
    chooseLanguage: "Выберите язык",
    chooseSection: "Выберите раздел:",
    catalog: "📚 Каталог",
    search: "🔍 Поиск",
    cart: "🛒 Корзина",
    myOrders: "📋 Мои заказы",
    instruction: "📖 Инструкция",
    information: "ℹ️ Информация",
    languageSaved: "✅ Язык сохранён.",
    miniAppShop: "🛍 Магазин",
  },
  kk: {
    chooseLanguage: "Тілді таңдаңыз",
    chooseSection: "Бөлімді таңдаңыз:",
    catalog: "📚 Каталог",
    search: "🔍 Іздеу",
    cart: "🛒 Себет",
    myOrders: "📋 Тапсырыстарым",
    instruction: "📖 Нұсқаулық",
    information: "ℹ️ Ақпарат",
    languageSaved: "✅ Тіл сақталды.",
    miniAppShop: "🛍 Дүкен",
  },
  en: {
    chooseLanguage: "Choose your language",
    chooseSection: "Choose a section:",
    catalog: "📚 Catalog",
    search: "🔍 Search",
    cart: "🛒 Cart",
    myOrders: "📋 My orders",
    instruction: "📖 Guide",
    information: "ℹ️ Information",
    languageSaved: "✅ Language saved.",
    miniAppShop: "🛍 Shop",
  },
  uz: {
    chooseLanguage: "Tilni tanlang",
    chooseSection: "Bo‘limni tanlang:",
    catalog: "📚 Katalog",
    search: "🔍 Qidirish",
    cart: "🛒 Savat",
    myOrders: "📋 Buyurtmalarim",
    instruction: "📖 Yo‘riqnoma",
    information: "ℹ️ Ma’lumot",
    languageSaved: "✅ Til saqlandi.",
    miniAppShop: "🛍 Do‘kon",
  },
};

type Msg = {
  back: string;
  subcategories: string;
  catalogHeader: string;
  emptyHere: string;
  showMore: string;
  backToCategories: string;
  navigation: string;
  addToCartBtn: string;
  /** «от 1000 ₸» — цена карточки товара с вариантами (Ниши, Блок D), самый дешёвый вариант. */
  priceFrom: (amount: string) => string;
  descPending: string;
  productNotFound: string;
  contactSaved: string;
  cartEmpty: string;
  webHandoffImported: string;
  cartHeader: string;
  removeItem: (name: string) => string;
  total: (amount: string) => string;
  checkoutBtn: string;
  clearBtn: string;
  promoCodeBtn: string;
  removePromoBtn: string;
  promoCodePrompt: string;
  promoCodeApplied: (amount: string) => string;
  promoCodeInvalid: string;
  promoCodeRemoved: string;
  discountLine: (amount: string) => string;
  pointsBalanceLine: (points: number) => string;
  usePointsBtn: string;
  removePointsBtn: string;
  pointsDiscountLine: (amount: string) => string;
  giftCertificateBtn: string;
  removeGiftCertificateBtn: string;
  giftCertificateCodePrompt: string;
  giftCertificateInvalid: string;
  giftCertificateRemoved: string;
  giftCertificateDiscountLine: (amount: string) => string;
  outOfStockAtCheckout: string;
  phonePromptHtml: string;
  shareContactBtn: string;
  fulfillmentTypePrompt: string;
  fulfillmentTypePickupBtn: string;
  fulfillmentTypeDeliveryBtn: string;
  fulfillmentDatePrompt: (minDate: string) => string;
  fulfillmentDateInvalid: string;
  fulfillmentDateTooEarly: (minDate: string) => string;
  deliveryZonePrompt: string;
  addressPrompt: string;
  fulfillmentNotePrompt: string;
  fulfillmentNoteSkipBtn: string;
  paymentNotConfigured: string;
  chooseCountry: string;
  countryNoLongerAvailable: string;
  orderCreateFailed: string;
  defaultInstructions: string;
  kzTitleNew: (displayNo: number | string) => string;
  kzTitleReminder: (displayNo: number | string) => string;
  amountToPay: (amount: string) => string;
  choosePayMethod: string;
  robokassaDesc: string;
  manualDesc: string;
  payViaRobokassaBtn: string;
  payManualBtn: string;
  rkTitleNew: (displayNo: number | string) => string;
  rkTitleReminder: (displayNo: number | string) => string;
  robokassaHint: string;
  manualTitleNew: (displayNo: number | string) => string;
  manualTitleReminder: (displayNo: number | string) => string;
  afterProofAuto: (isPhysical: boolean) => string;
  afterProofManual: (isPhysical: boolean) => string;
  alreadyProcessed: (orderId: number | string) => string;
  robokassaUnavailable: string;
  searchNothingFound: string;
  searchDeeperHint: string;
  foundCount: (n: number) => string;
  shownOf: (shown: number, total: number) => string;
  searchSessionExpired: string;
  addedToCart: string;
  productUnavailable: string;
  /** Блок 4, находка 4.20 — причины addToCart, различаемые вместо одного generic текста. */
  productMixedCartMsg: string;
  productDigitalLimitMsg: string;
  productOutOfStockMsg: string;
  outOfStockLabel: string;
  /** Срок изготовления в карточке товара, ДО покупки (Блок 4, находка 4.21). */
  leadTimeLabel: (days: number) => string;
  cartCleared: string;
  countrySaved: (countryName: string) => string;
  noOrdersYet: string;
  orderNotFound: string;
  myOrdersHeader: (list: string) => string;
  resendBtn: (orderNo: number | string) => string;
  resendSent: string;
  resendFailed: string;
  rateBtn: (orderNo: number | string) => string;
  chooseProductToRate: string;
  chooseRatingPrompt: (productName: string) => string;
  reviewSaved: string;
  reviewCommentPrompt: string;
  reviewSkipBtn: string;
  reviewCommentSaved: string;
  reviewNotAllowed: string;
  noReviewableProducts: string;
  statusAwaitingPayment: string;
  statusAwaitingConfirmation: string;
  statusDelivering: string;
  statusDelivered: string;
  statusRejected: string;
  /** Блок 5, находка 5.2 — статусы физического заказа в "Мои заказы", раньше показывался сырой код (accepted/in_production/ready). */
  statusAccepted: string;
  statusInProduction: string;
  statusReady: string;
  shareContactHint: string;
  phoneParseFail: string;
  sendReceiptPrompt: string;
  fileDownloadFail: string;
  notReceiptLike: (orderId: number | string) => string;
  receiptManualReview: (orderId: number | string, isPhysical: boolean) => string;
  receiptVerifiedDelivering: (orderId: number | string, isPhysical: boolean) => string;
  deliveryFailedAfterOcr: (orderId: number | string, isPhysical: boolean) => string;
  receiptForwardedAwaitingConfirm: (orderId: number | string, isPhysical: boolean) => string;
  receiptForwardedNoStorage: (orderId: number | string) => string;
  receiptSaveFailed: (orderId: number | string) => string;
  searchTypePrompt: string;
  infoHeader: string;
  infoRequiredDocs: string;
  offerBtn: string;
  offerBtnShort: string;
  privacyBtn: string;
  requisitesBtn: string;
  aboutBtn: string;
  inviteFriendBtn: string;
  contactsNotSet: string;
  contactUsePrefix: (link: string) => string;
  instructionVideoFail: string;
  idLabel: (id: number | string) => string;
  rejectedNotice: (orderId: number | string) => string;
  accessDenied: string;
  fileAlreadySent: string;
  loadingMaterials: (lang: string) => string;
  materialNotConfigured: (lang: string) => string;
  paymentReminder: (orderNo: number | string, amount: string) => string;
  chooseDeliveryLanguage: string;
  allLanguagesBtn: string;
};

const copy: Record<Locale, Msg> = {
  ru: {
    back: "« Назад",
    subcategories: "📁 Подкатегории:",
    catalogHeader: "📚 Каталог:",
    emptyHere: "📂 Здесь пока пусто.",
    showMore: "⬇️ Показать ещё",
    backToCategories: "« Назад в категории",
    navigation: "Навигация:",
    addToCartBtn: "➕ В корзину",
    priceFrom: (amount) => `от ${amount}`,
    descPending: "Подробное описание уточняется у продавца.",
    productNotFound: "Товар не найден.",
    contactSaved: "✅ Номер сохранён.",
    cartEmpty: "🛒 Корзина пуста.",
    webHandoffImported:
      "✅ Товары с веб-витрины добавлены в корзину. Продолжим оформление и оплату.",
    cartHeader: "🛒 <b>Ваша корзина:</b>\n\n",
    removeItem: (name) => `❌ Убрать «${name}»`,
    total: (amount) => `\n<b>Итого: ${amount}</b>`,
    checkoutBtn: "💳 Оформить заказ",
    clearBtn: "🗑 Очистить",
    promoCodeBtn: "🎟 Ввести промокод",
    removePromoBtn: "❌ Убрать промокод",
    promoCodePrompt: "Введите промокод:",
    promoCodeApplied: (amount) => `✅ Промокод применён. Скидка: ${amount}`,
    promoCodeInvalid: "⚠️ Промокод недействителен или больше не работает.",
    promoCodeRemoved: "Промокод убран.",
    discountLine: (amount) => `Скидка по промокоду: −${amount}\n`,
    pointsBalanceLine: (points) => `🏆 Ваши баллы: ${points}\n`,
    usePointsBtn: "🏆 Списать баллы",
    removePointsBtn: "❌ Не списывать баллы",
    pointsDiscountLine: (amount) => `Списано баллами: −${amount}\n`,
    giftCertificateBtn: "🎫 Ввести сертификат",
    removeGiftCertificateBtn: "❌ Убрать сертификат",
    giftCertificateCodePrompt: "Введите код подарочного сертификата:",
    giftCertificateInvalid: "⚠️ Сертификат недействителен или уже использован.",
    giftCertificateRemoved: "Сертификат убран.",
    giftCertificateDiscountLine: (amount) => `Скидка по сертификату: −${amount}\n`,
    outOfStockAtCheckout:
      "⚠️ Один из товаров в корзине только что закончился на складе. Оформите заказ без него.",
    phonePromptHtml:
      "Для оформления заказа укажите номер телефона — <b>просто напишите его в этот чат</b>, например:\n<code>+7 900 123-45-67</code>\n\nИли нажмите кнопку ниже, чтобы поделиться контактом автоматически.",
    shareContactBtn: "📱 Поделиться контактом",
    fulfillmentTypePrompt: "Как вы хотите получить заказ?",
    fulfillmentTypePickupBtn: "🚶 Самовывоз",
    fulfillmentTypeDeliveryBtn: "🚚 Доставка",
    fulfillmentDatePrompt: (minDate) =>
      `Когда вы сможете получить заказ? Не раньше ${minDate}. Напишите дату в формате ДД.ММ.ГГГГ.`,
    fulfillmentDateInvalid: "Не разобрал дату. Формат: ДД.ММ.ГГГГ, например 05.03.2026.",
    fulfillmentDateTooEarly: (minDate) =>
      `Этот заказ готовится дольше — не раньше ${minDate}. Укажите более позднюю дату.`,
    deliveryZonePrompt: "Выберите район доставки.",
    addressPrompt: "Укажите адрес доставки.",
    fulfillmentNotePrompt:
      "Комментарий к заказу (например, надпись на торте)? Если не нужен — нажмите «Без комментария».",
    fulfillmentNoteSkipBtn: "Без комментария",
    paymentNotConfigured: "Способы оплаты ещё не настроены. Свяжитесь с продавцом.",
    chooseCountry: "Пожалуйста, выберите вашу страну (для отображения цен и реквизитов):",
    countryNoLongerAvailable:
      "Ваша страна больше не обслуживается — выберите её заново, пожалуйста.",
    orderCreateFailed: "Не удалось создать заказ. Попробуйте позже.",
    defaultInstructions: "Свяжитесь с продавцом для уточнения реквизитов.",
    kzTitleNew: (n) => `🧾 <b>Заказ #${n}</b> создан.`,
    kzTitleReminder: (n) => `🔔 <b>Заказ #${n}</b> — выберите способ оплаты`,
    amountToPay: (a) => `Сумма к оплате: <b>${a}</b>`,
    choosePayMethod: "Выберите способ оплаты:",
    robokassaDesc: "• <b>Robokassa</b> — оплата картой, файлы придут сразу после оплаты",
    manualDesc: "• <b>По реквизитам</b> — перевод вручную, пришлите чек — файлы придут сразу",
    payViaRobokassaBtn: "💳 Оплатить через Robokassa",
    payManualBtn: "🧾 Оплатить по реквизитам",
    rkTitleNew: (n) => `🧾 <b>Заказ #${n}</b>`,
    rkTitleReminder: (n) => `🔔 <b>Заказ #${n}</b> — оплата`,
    robokassaHint:
      "Нажмите кнопку ниже для оплаты через Robokassa — после оплаты файлы придут автоматически.",
    manualTitleNew: (n) => `🧾 <b>Заказ #${n}</b> создан.`,
    manualTitleReminder: (n) => `🔔 <b>Заказ #${n}</b> — оплата по реквизитам`,
    afterProofAuto: (isPhysical) =>
      isPhysical
        ? "После оплаты <b>пришлите чек</b> (фото или PDF) в этот чат — бот сразу примет заказ в работу."
        : "После оплаты <b>пришлите чек</b> (фото или PDF) в этот чат — бот сразу отправит файлы.",
    afterProofManual: (isPhysical) =>
      isPhysical
        ? "После оплаты <b>пришлите скриншот</b> (фото) в этот чат — продавец проверит и примет заказ в работу."
        : "После оплаты <b>пришлите скриншот</b> (фото) в этот чат — продавец проверит и пришлёт файлы.",
    alreadyProcessed: (id) => `Заказ #${id} уже обрабатывается или закрыт.`,
    robokassaUnavailable: "Robokassa временно недоступна. Выберите оплату по реквизитам.",
    searchNothingFound: "Ничего не нашлось. Попробуйте другое слово.",
    searchDeeperHint: "Секунду, ищу подробнее…",
    foundCount: (n) => `🔍 Найдено материалов: ${n}`,
    shownOf: (s, t) => `Показано ${s} из ${t}`,
    searchSessionExpired: "Сессия поиска устарела. Повторите поиск.",
    addedToCart: "✅ Добавлено в корзину.",
    productUnavailable: "⚠️ Этот материал сейчас недоступен. Выберите другой в каталоге.",
    productMixedCartMsg:
      "⚠️ В корзине уже другой тип товара. Оформите текущую корзину или очистите её.",
    productDigitalLimitMsg: "⚠️ Этот материал уже в корзине — второй экземпляр не нужен.",
    productOutOfStockMsg: "⚠️ Товара не осталось в нужном количестве.",
    outOfStockLabel: "❌ Нет в наличии",
    leadTimeLabel: (days) =>
      `🕒 Готовим ${days} ${days % 10 === 1 && days % 100 !== 11 ? "день" : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 10 || days % 100 >= 20) ? "дня" : "дней"}`,
    cartCleared: "🗑 Корзина очищена.",
    countrySaved: (c) => `✅ Ваша страна сохранена: ${c}\nТеперь вы видите корректные цены!`,
    noOrdersYet: "У вас пока нет заказов.",
    orderNotFound: "Заказ не найден.",
    myOrdersHeader: (l) => `📋 Ваши заказы:\n\n${l}`,
    resendBtn: (orderNo) => `📥 Скачать снова (#${orderNo})`,
    resendSent: "📤 Отправляю файлы заказа ещё раз…",
    resendFailed: "⚠️ Не удалось найти файлы этого заказа. Напишите продавцу.",
    rateBtn: (orderNo) => `⭐ Оценить (#${orderNo})`,
    chooseProductToRate: "Какой товар из этого заказа оцениваете?",
    chooseRatingPrompt: (name) => `Оцените «${name}»:`,
    reviewSaved: "✅ Спасибо за оценку! Хотите добавить комментарий — просто напишите его.",
    reviewCommentPrompt: "Напишите комментарий или нажмите «Пропустить».",
    reviewSkipBtn: "Пропустить",
    reviewCommentSaved: "✅ Комментарий сохранён. Спасибо за отзыв!",
    reviewNotAllowed: "⚠️ Оценить можно только то, что вы реально купили и получили.",
    noReviewableProducts: "В этом заказе нет товаров, которые можно оценить.",
    statusAwaitingPayment: "⏳ ожидает оплаты",
    statusAwaitingConfirmation: "🔎 проверяется",
    statusDelivering: "📤 выдаётся",
    statusDelivered: "✅ выдан",
    statusRejected: "❌ отклонён",
    statusAccepted: "✅ принят в работу",
    statusInProduction: "👩‍🍳 в работе",
    statusReady: "📦 готов",
    shareContactHint:
      "Нажмите кнопку «📱 Поделиться контактом» внизу экрана или просто напишите номер телефона в чат.",
    phoneParseFail:
      "Не удалось распознать номер. Напишите телефон цифрами, например: <code>+79001234567</code> или <code>89001234567</code>",
    sendReceiptPrompt: "📨 Пришлите, пожалуйста, чек об оплате — фото или файл (например, PDF).",
    fileDownloadFail: "⚠️ Не удалось загрузить файл. Пришлите чек ещё раз — фото или PDF.",
    notReceiptLike: (id) =>
      `⚠️ Это не похоже на чек оплаты.\n\nПришлите, пожалуйста, скриншот перевода / чека с суммой заказа #${id}.`,
    receiptManualReview: (id, isPhysical) =>
      `📨 Чек получен по заказу #${id}, но автоматическая проверка не прошла.\n` +
      (isPhysical
        ? "Заказ отправлен продавцу на ручную проверку — его примут в работу после подтверждения."
        : "Заказ отправлен продавцу на ручную проверку — файлы придут после подтверждения."),
    receiptVerifiedDelivering: (id, isPhysical) =>
      isPhysical
        ? `📨 Спасибо! Чек проверен. Заказ #${id} — принимаю в работу…`
        : `📨 Спасибо! Чек проверен. Заказ #${id} — отправляю файлы…`,
    deliveryFailedAfterOcr: (id, isPhysical) =>
      isPhysical
        ? `⚠️ Чек принят, но автоматическое принятие заказа #${id} не завершилось. Продавец проверит и примет заказ вручную.`
        : `⚠️ Чек принят, но автоматическая выдача заказа #${id} не завершилась. Продавец проверит и отправит файлы.`,
    receiptForwardedAwaitingConfirm: (id, isPhysical) =>
      isPhysical
        ? `📨 Спасибо! Чек получен. Заказ #${id} отправлен на проверку. Как только продавец подтвердит оплату — заказ примут в работу.`
        : `📨 Спасибо! Чек получен. Заказ #${id} отправлен на проверку. Как только продавец подтвердит оплату — бот пришлёт файлы.`,
    receiptForwardedNoStorage: (id) =>
      `📨 Чек получен и переслан продавцу. Заказ #${id} на проверке. Если нужно — можно отправить чек ещё раз.`,
    receiptSaveFailed: (id) =>
      `⚠️ Не удалось сохранить чек заказа #${id}. Продавец проверит заказ вручную. Если хотите — попробуйте отправить чек ещё раз.`,
    searchTypePrompt: "Напишите название или ключевое слово:",
    infoHeader: "ℹ️ <b>Информация о магазине</b>\n\n",
    infoRequiredDocs: "Обязательные документы и реквизиты (требование платёжных систем):\n\n",
    offerBtn: "📄 Условия использования (оферта)",
    offerBtnShort: "📄 Условия использования",
    privacyBtn: "🔒 Политика конфиденциальности",
    requisitesBtn: "🏦 Реквизиты",
    aboutBtn: "👤 О продавце",
    inviteFriendBtn: "🎁 Пригласить друга",
    contactsNotSet: "Контакты автора пока не указаны.",
    contactUsePrefix: (l) => `Для связи с автором используйте следующие контакты:\n${l}`,
    instructionVideoFail: "⚠️ Не удалось загрузить видео инструкции. Напишите продавцу.",
    idLabel: (id) => `Ваш Telegram ID: ${id}`,
    rejectedNotice: (id) => `❌ Ваш заказ №${id} отклонён. Если это ошибка — напишите продавцу.`,
    accessDenied: "⛔ Доступ запрещён.",
    fileAlreadySent: "⚠️ Этот файл уже был отправлен.",
    loadingMaterials: (lang) => `⏳ Загружаю материалы (${lang})...`,
    materialNotConfigured: (lang) => `⚠️ Файл (${lang}) не настроен. Продавец вышлет вручную.`,
    paymentReminder: (orderNo, amount) =>
      `🔔 <b>Напоминание по заказу #${orderNo}</b>\n\n` +
      `Заказ ещё ожидает оплаты (${amount}).\n` +
      `Ниже — актуальный способ оплаты. Если уже платили — пришлите чек в этот чат.`,
    chooseDeliveryLanguage: "🌐 На каком языке вы хотите получить материалы?",
    allLanguagesBtn: "🌐 Все языки (цена ×N)",
  },
  kk: {
    back: "« Артқа",
    subcategories: "📁 Ішкі санаттар:",
    catalogHeader: "📚 Каталог:",
    emptyHere: "📂 Бұл жерде әзірге бос.",
    showMore: "⬇️ Тағы көрсету",
    backToCategories: "« Санаттарға оралу",
    navigation: "Навигация:",
    addToCartBtn: "➕ Себетке",
    priceFrom: (amount) => `${amount}-ден`,
    descPending: "Толық сипаттаманы сатушыдан нақтылаңыз.",
    productNotFound: "Тауар табылмады.",
    contactSaved: "✅ Нөмір сақталды.",
    cartEmpty: "🛒 Себет бос.",
    webHandoffImported:
      "✅ Веб-витринадан тауарлар себетке қосылды. Тапсырыс беру мен төлемді жалғастырамыз.",
    cartHeader: "🛒 <b>Сіздің себетіңіз:</b>\n\n",
    removeItem: (name) => `❌ Алып тастау «${name}»`,
    total: (amount) => `\n<b>Барлығы: ${amount}</b>`,
    checkoutBtn: "💳 Тапсырыс беру",
    clearBtn: "🗑 Тазарту",
    promoCodeBtn: "🎟 Промокод енгізу",
    removePromoBtn: "❌ Промокодты алып тастау",
    promoCodePrompt: "Промокодты енгізіңіз:",
    promoCodeApplied: (amount) => `✅ Промокод қолданылды. Жеңілдік: ${amount}`,
    promoCodeInvalid: "⚠️ Промокод жарамсыз немесе енді жұмыс істемейді.",
    promoCodeRemoved: "Промокод алынып тасталды.",
    discountLine: (amount) => `Промокод бойынша жеңілдік: −${amount}\n`,
    pointsBalanceLine: (points) => `🏆 Сіздің баллдарыңыз: ${points}\n`,
    usePointsBtn: "🏆 Баллдарды жұмсау",
    removePointsBtn: "❌ Баллдарды жұмсамау",
    pointsDiscountLine: (amount) => `Баллдармен есептен шығарылды: −${amount}\n`,
    giftCertificateBtn: "🎫 Сертификат енгізу",
    removeGiftCertificateBtn: "❌ Сертификатты алып тастау",
    giftCertificateCodePrompt: "Сыйлық сертификатының кодын енгізіңіз:",
    giftCertificateInvalid: "⚠️ Сертификат жарамсыз немесе бұрын пайдаланылған.",
    giftCertificateRemoved: "Сертификат алынып тасталды.",
    giftCertificateDiscountLine: (amount) => `Сертификат бойынша жеңілдік: −${amount}\n`,
    outOfStockAtCheckout:
      "⚠️ Себеттегі тауарлардың бірі жаңа ғана таусылды. Тапсырысты онсыз рәсімдеңіз.",
    phonePromptHtml:
      "Тапсырысты рәсімдеу үшін телефон нөміріңізді көрсетіңіз — <b>оны осы чатқа жазыңыз</b>, мысалы:\n<code>+7 900 123-45-67</code>\n\nНемесе контактіні автоматты түрде бөлісу үшін төмендегі батырманы басыңыз.",
    shareContactBtn: "📱 Контактімен бөлісу",
    fulfillmentTypePrompt: "Тапсырысты қалай алғыңыз келеді?",
    fulfillmentTypePickupBtn: "🚶 Өзі алып кету",
    fulfillmentTypeDeliveryBtn: "🚚 Жеткізу",
    fulfillmentDatePrompt: (minDate) =>
      `Тапсырысты қашан ала аласыз? ${minDate}-ден ерте емес. Күнді КК.АА.ЖЖЖЖ форматында жазыңыз.`,
    fulfillmentDateInvalid: "Күнді түсінбедім. Формат: КК.АА.ЖЖЖЖ, мысалы 05.03.2026.",
    fulfillmentDateTooEarly: (minDate) =>
      `Бұл тапсырыс дайындалуы ұзағырақ — ${minDate}-ден ерте емес. Кейінірек күн көрсетіңіз.`,
    deliveryZonePrompt: "Жеткізу ауданын таңдаңыз.",
    addressPrompt: "Жеткізу мекенжайын көрсетіңіз.",
    fulfillmentNotePrompt:
      "Тапсырысқа түсініктеме (мысалы, тортқа жазу)? Керек болмаса — «Түсініктемесіз» батырмасын басыңыз.",
    fulfillmentNoteSkipBtn: "Түсініктемесіз",
    paymentNotConfigured: "Төлем әдістері әлі теңшелмеген. Сатушымен байланысыңыз.",
    chooseCountry: "Еліңізді таңдаңыз (бағалар мен деректемелерді көрсету үшін):",
    countryNoLongerAvailable: "Сіздің еліңіз енді қызмет көрсетілмейді — қайта таңдаңыз.",
    orderCreateFailed: "Тапсырысты жасау мүмкін болмады. Кейінірек қайталап көріңіз.",
    defaultInstructions: "Деректемелерді нақтылау үшін сатушымен байланысыңыз.",
    kzTitleNew: (n) => `🧾 <b>Тапсырыс #${n}</b> жасалды.`,
    kzTitleReminder: (n) => `🔔 <b>Тапсырыс #${n}</b> — төлем әдісін таңдаңыз`,
    amountToPay: (a) => `Төлеуге тиіс сома: <b>${a}</b>`,
    choosePayMethod: "Төлем әдісін таңдаңыз:",
    robokassaDesc: "• <b>Robokassa</b> — картамен төлеу, файлдар төлемнен кейін бірден келеді",
    manualDesc:
      "• <b>Деректемелер бойынша</b> — қолмен аудару, чекті жіберіңіз — файлдар бірден келеді",
    payViaRobokassaBtn: "💳 Robokassa арқылы төлеу",
    payManualBtn: "🧾 Деректемелер бойынша төлеу",
    rkTitleNew: (n) => `🧾 <b>Тапсырыс #${n}</b>`,
    rkTitleReminder: (n) => `🔔 <b>Тапсырыс #${n}</b> — төлем`,
    robokassaHint:
      "Robokassa арқылы төлеу үшін төмендегі батырманы басыңыз — төлемнен кейін файлдар автоматты түрде келеді.",
    manualTitleNew: (n) => `🧾 <b>Тапсырыс #${n}</b> жасалды.`,
    manualTitleReminder: (n) => `🔔 <b>Тапсырыс #${n}</b> — деректемелер бойынша төлем`,
    afterProofAuto: (isPhysical) =>
      isPhysical
        ? "Төлемнен кейін <b>чекті осы чатқа жіберіңіз</b> (фото немесе PDF) — бот тапсырысты бірден жұмысқа қабылдайды."
        : "Төлемнен кейін <b>чекті осы чатқа жіберіңіз</b> (фото немесе PDF) — бот файлдарды бірден жібереді.",
    afterProofManual: (isPhysical) =>
      isPhysical
        ? "Төлемнен кейін <b>скриншотты осы чатқа жіберіңіз</b> (фото) — сатушы тексеріп, тапсырысты жұмысқа қабылдайды."
        : "Төлемнен кейін <b>скриншотты осы чатқа жіберіңіз</b> (фото) — сатушы тексеріп, файлдарды жібереді.",
    alreadyProcessed: (id) => `Тапсырыс #${id} өңделуде немесе жабылған.`,
    robokassaUnavailable: "Robokassa уақытша қолжетімсіз. Деректемелер бойынша төлемді таңдаңыз.",
    searchNothingFound: "Ештеңе табылмады. Басқа сөзбен көріңіз.",
    searchDeeperHint: "Бір сәт, толығырақ іздеп жатырмын…",
    foundCount: (n) => `🔍 Табылған материалдар: ${n}`,
    shownOf: (s, t) => `Көрсетілді ${s} / ${t}`,
    searchSessionExpired: "Іздеу сессиясы ескірді. Іздеуді қайталаңыз.",
    addedToCart: "✅ Себетке қосылды.",
    productUnavailable: "⚠️ Бұл материал қазір қолжетімді емес. Каталогтан басқасын таңдаңыз.",
    productMixedCartMsg:
      "⚠️ Себетте басқа түрдегі тауар бар. Ағымдағы себетті рәсімдеңіз немесе тазалаңыз.",
    productDigitalLimitMsg: "⚠️ Бұл материал себетте бар — екінші данасы қажет емес.",
    productOutOfStockMsg: "⚠️ Тауар қажетті мөлшерде қалмады.",
    outOfStockLabel: "❌ Қоймада жоқ",
    leadTimeLabel: (days) => `🕒 Дайындау мерзімі: ${days} күн`,
    cartCleared: "🗑 Себет тазартылды.",
    countrySaved: (c) => `✅ Еліңіз сақталды: ${c}\nЕнді сіз дұрыс бағаларды көресіз!`,
    noOrdersYet: "Сізде әзірге тапсырыс жоқ.",
    orderNotFound: "Тапсырыс табылмады.",
    myOrdersHeader: (l) => `📋 Сіздің тапсырыстарыңыз:\n\n${l}`,
    resendBtn: (orderNo) => `📥 Қайта жүктеу (#${orderNo})`,
    resendSent: "📤 Тапсырыс файлдарын қайта жіберемін…",
    resendFailed: "⚠️ Бұл тапсырыстың файлдары табылмады. Сатушыға жазыңыз.",
    rateBtn: (orderNo) => `⭐ Бағалау (#${orderNo})`,
    chooseProductToRate: "Осы тапсырыстан қай тауарды бағалайсыз?",
    chooseRatingPrompt: (name) => `«${name}» тауарын бағалаңыз:`,
    reviewSaved: "✅ Бағалағаныңыз үшін рақмет! Пікір қосқыңыз келсе — жай ғана жазыңыз.",
    reviewCommentPrompt: "Пікір жазыңыз немесе «Өткізіп жіберу» түймесін басыңыз.",
    reviewSkipBtn: "Өткізіп жіберу",
    reviewCommentSaved: "✅ Пікір сақталды. Пікіріңіз үшін рақмет!",
    reviewNotAllowed: "⚠️ Тек нақты сатып алып, алған тауарды ғана бағалауға болады.",
    noReviewableProducts: "Бұл тапсырыста бағалауға болатын тауар жоқ.",
    statusAwaitingPayment: "⏳ төлем күтілуде",
    statusAwaitingConfirmation: "🔎 тексерілуде",
    statusDelivering: "📤 жіберілуде",
    statusDelivered: "✅ жіберілді",
    statusRejected: "❌ қабылданбады",
    statusAccepted: "✅ жұмысқа қабылданды",
    statusInProduction: "👩‍🍳 дайындалуда",
    statusReady: "📦 дайын",
    shareContactHint:
      "Экранның төменгі жағындағы «📱 Контактімен бөлісу» батырмасын басыңыз немесе телефон нөмірін чатқа жазыңыз.",
    phoneParseFail:
      "Нөмірді тану мүмкін болмады. Телефонды сандармен жазыңыз, мысалы: <code>+79001234567</code> немесе <code>89001234567</code>",
    sendReceiptPrompt: "📨 Төлем чегін жіберіңіз — фото немесе файл (мысалы, PDF).",
    fileDownloadFail: "⚠️ Файлды жүктеу мүмкін болмады. Чекті қайта жіберіңіз — фото немесе PDF.",
    notReceiptLike: (id) =>
      `⚠️ Бұл төлем чегіне ұқсамайды.\n\n#${id} тапсырысының сомасы көрсетілген аударым/чек скриншотын жіберіңіз.`,
    receiptManualReview: (id, isPhysical) =>
      `📨 #${id} тапсырысы бойынша чек алынды, бірақ автоматты тексеру өтпеді.\n` +
      (isPhysical
        ? "Тапсырыс сатушыға қолмен тексеруге жіберілді — растаудан кейін жұмысқа қабылданады."
        : "Тапсырыс сатушыға қолмен тексеруге жіберілді — файлдар растаудан кейін келеді."),
    receiptVerifiedDelivering: (id, isPhysical) =>
      isPhysical
        ? `📨 Рақмет! Чек тексерілді. Тапсырыс #${id} — жұмысқа қабылдаудамын…`
        : `📨 Рақмет! Чек тексерілді. Тапсырыс #${id} — файлдарды жіберудемін…`,
    deliveryFailedAfterOcr: (id, isPhysical) =>
      isPhysical
        ? `⚠️ Чек қабылданды, бірақ #${id} тапсырысын автоматты қабылдау аяқталмады. Сатушы тексеріп, тапсырысты қолмен қабылдайды.`
        : `⚠️ Чек қабылданды, бірақ #${id} тапсырысын автоматты жіберу аяқталмады. Сатушы тексеріп, файлдарды жібереді.`,
    receiptForwardedAwaitingConfirm: (id, isPhysical) =>
      isPhysical
        ? `📨 Рақмет! Чек алынды. Тапсырыс #${id} тексеруге жіберілді. Сатушы төлемді растаған бойда — тапсырыс жұмысқа қабылданады.`
        : `📨 Рақмет! Чек алынды. Тапсырыс #${id} тексеруге жіберілді. Сатушы төлемді растаған бойда — бот файлдарды жібереді.`,
    receiptForwardedNoStorage: (id) =>
      `📨 Чек алынды және сатушыға жіберілді. Тапсырыс #${id} тексерілуде. Қажет болса — чекті қайта жіберуге болады.`,
    receiptSaveFailed: (id) =>
      `⚠️ #${id} тапсырысының чегін сақтау мүмкін болмады. Сатушы тапсырысты қолмен тексереді. Қаласаңыз — чекті қайта жіберіп көріңіз.`,
    searchTypePrompt: "Атауын немесе кілт сөзді жазыңыз:",
    infoHeader: "ℹ️ <b>Дүкен туралы ақпарат</b>\n\n",
    infoRequiredDocs: "Міндетті құжаттар мен деректемелер (төлем жүйелерінің талабы):\n\n",
    offerBtn: "📄 Пайдалану шарттары (оферта)",
    offerBtnShort: "📄 Пайдалану шарттары",
    privacyBtn: "🔒 Құпиялылық саясаты",
    requisitesBtn: "🏦 Деректемелер",
    aboutBtn: "👤 Сатушы туралы",
    inviteFriendBtn: "🎁 Досты шақыру",
    contactsNotSet: "Автордың байланыс деректері әлі көрсетілмеген.",
    contactUsePrefix: (l) => `Автормен байланысу үшін мына деректерді пайдаланыңыз:\n${l}`,
    instructionVideoFail: "⚠️ Нұсқаулық видеосын жүктеу мүмкін болмады. Сатушыға жазыңыз.",
    idLabel: (id) => `Сіздің Telegram ID: ${id}`,
    rejectedNotice: (id) =>
      `❌ Сіздің №${id} тапсырысыңыз қабылданбады. Бұл қате болса — сатушыға жазыңыз.`,
    accessDenied: "⛔ Қол жеткізу тыйым салынған.",
    fileAlreadySent: "⚠️ Бұл файл бұрын жіберілген.",
    loadingMaterials: (lang) => `⏳ Материалдар жүктелуде (${lang})...`,
    materialNotConfigured: (lang) => `⚠️ Файл (${lang}) теңшелмеген. Сатушы қолмен жібереді.`,
    paymentReminder: (orderNo, amount) =>
      `🔔 <b>Тапсырыс #${orderNo} бойынша ескерту</b>\n\n` +
      `Тапсырыс әлі төлемді күтуде (${amount}).\n` +
      `Төменде — өзекті төлем әдісі. Егер төлеп қойған болсаңыз — чекті осы чатқа жіберіңіз.`,
    chooseDeliveryLanguage: "🌐 Материалдарды қай тілде алғыңыз келеді?",
    allLanguagesBtn: "🌐 Барлық тілдер (баға ×N)",
  },
  en: {
    back: "« Back",
    subcategories: "📁 Subcategories:",
    catalogHeader: "📚 Catalog:",
    emptyHere: "📂 Nothing here yet.",
    showMore: "⬇️ Show more",
    backToCategories: "« Back to categories",
    navigation: "Navigation:",
    addToCartBtn: "➕ Add to cart",
    priceFrom: (amount) => `from ${amount}`,
    descPending: "Full description available on request from the seller.",
    productNotFound: "Product not found.",
    contactSaved: "✅ Number saved.",
    cartEmpty: "🛒 Your cart is empty.",
    webHandoffImported:
      "✅ Items from the web storefront were added to your cart. Let's continue checkout and payment.",
    cartHeader: "🛒 <b>Your cart:</b>\n\n",
    removeItem: (name) => `❌ Remove “${name}”`,
    total: (amount) => `\n<b>Total: ${amount}</b>`,
    checkoutBtn: "💳 Checkout",
    clearBtn: "🗑 Clear",
    promoCodeBtn: "🎟 Enter promo code",
    removePromoBtn: "❌ Remove promo code",
    promoCodePrompt: "Enter your promo code:",
    promoCodeApplied: (amount) => `✅ Promo code applied. Discount: ${amount}`,
    promoCodeInvalid: "⚠️ This promo code is invalid or no longer works.",
    promoCodeRemoved: "Promo code removed.",
    discountLine: (amount) => `Promo discount: −${amount}\n`,
    pointsBalanceLine: (points) => `🏆 Your points: ${points}\n`,
    usePointsBtn: "🏆 Use points",
    removePointsBtn: "❌ Don't use points",
    pointsDiscountLine: (amount) => `Points discount: −${amount}\n`,
    giftCertificateBtn: "🎫 Enter certificate code",
    removeGiftCertificateBtn: "❌ Remove certificate",
    giftCertificateCodePrompt: "Enter your gift certificate code:",
    giftCertificateInvalid: "⚠️ This certificate is invalid or already used.",
    giftCertificateRemoved: "Certificate removed.",
    giftCertificateDiscountLine: (amount) => `Certificate discount: −${amount}\n`,
    outOfStockAtCheckout: "⚠️ One of the items in your cart just sold out. Check out without it.",
    phonePromptHtml:
      "To place your order, share your phone number — <b>just type it in this chat</b>, for example:\n<code>+7 900 123-45-67</code>\n\nOr tap the button below to share your contact automatically.",
    shareContactBtn: "📱 Share contact",
    fulfillmentTypePrompt: "How would you like to receive your order?",
    fulfillmentTypePickupBtn: "🚶 Pickup",
    fulfillmentTypeDeliveryBtn: "🚚 Delivery",
    fulfillmentDatePrompt: (minDate) =>
      `When can you receive the order? Not earlier than ${minDate}. Please write the date as DD.MM.YYYY.`,
    fulfillmentDateInvalid: "Couldn't read that date. Format: DD.MM.YYYY, e.g. 05.03.2026.",
    fulfillmentDateTooEarly: (minDate) =>
      `This order takes longer to prepare — not earlier than ${minDate}. Please pick a later date.`,
    deliveryZonePrompt: "Choose a delivery zone.",
    addressPrompt: "Please provide the delivery address.",
    fulfillmentNotePrompt:
      'Any note for the order (e.g. a message on the cake)? Tap "No note" if none.',
    fulfillmentNoteSkipBtn: "No note",
    paymentNotConfigured: "Payment methods are not configured yet. Please contact the seller.",
    chooseCountry: "Please choose your country (to show correct prices and payment details):",
    countryNoLongerAvailable: "Your country is no longer served — please choose it again.",
    orderCreateFailed: "Couldn’t create the order. Please try again later.",
    defaultInstructions: "Contact the seller for payment details.",
    kzTitleNew: (n) => `🧾 <b>Order #${n}</b> created.`,
    kzTitleReminder: (n) => `🔔 <b>Order #${n}</b> — choose a payment method`,
    amountToPay: (a) => `Amount due: <b>${a}</b>`,
    choosePayMethod: "Choose a payment method:",
    robokassaDesc: "• <b>Robokassa</b> — card payment, files arrive right after payment",
    manualDesc:
      "• <b>By bank details</b> — manual transfer, send the receipt — files arrive right away",
    payViaRobokassaBtn: "💳 Pay via Robokassa",
    payManualBtn: "🧾 Pay by bank details",
    rkTitleNew: (n) => `🧾 <b>Order #${n}</b>`,
    rkTitleReminder: (n) => `🔔 <b>Order #${n}</b> — payment`,
    robokassaHint:
      "Tap the button below to pay via Robokassa — files will arrive automatically after payment.",
    manualTitleNew: (n) => `🧾 <b>Order #${n}</b> created.`,
    manualTitleReminder: (n) => `🔔 <b>Order #${n}</b> — payment by bank details`,
    afterProofAuto: (isPhysical) =>
      isPhysical
        ? "After payment, <b>send the receipt</b> (photo or PDF) in this chat — the bot will accept the order right away."
        : "After payment, <b>send the receipt</b> (photo or PDF) in this chat — the bot will send the files right away.",
    afterProofManual: (isPhysical) =>
      isPhysical
        ? "After payment, <b>send a screenshot</b> (photo) in this chat — the seller will verify it and accept the order."
        : "After payment, <b>send a screenshot</b> (photo) in this chat — the seller will verify it and send the files.",
    alreadyProcessed: (id) => `Order #${id} is already being processed or closed.`,
    robokassaUnavailable:
      "Robokassa is temporarily unavailable. Please choose payment by bank details.",
    searchNothingFound: "Nothing found. Try a different word.",
    searchDeeperHint: "One moment, looking deeper…",
    foundCount: (n) => `🔍 Materials found: ${n}`,
    shownOf: (s, t) => `Showing ${s} of ${t}`,
    searchSessionExpired: "Your search session has expired. Please search again.",
    addedToCart: "✅ Added to cart.",
    productUnavailable:
      "⚠️ This material is currently unavailable. Please pick another one from the catalog.",
    productMixedCartMsg:
      "⚠️ Your cart already has a different item type. Check out or clear the cart first.",
    productDigitalLimitMsg:
      "⚠️ This material is already in your cart — a second copy isn't needed.",
    productOutOfStockMsg: "⚠️ Not enough of this item left in stock.",
    outOfStockLabel: "❌ Out of stock",
    leadTimeLabel: (days) => `🕒 Made to order: ${days} day${days === 1 ? "" : "s"}`,
    cartCleared: "🗑 Cart cleared.",
    countrySaved: (c) => `✅ Your country is saved: ${c}\nNow you’ll see the correct prices!`,
    noOrdersYet: "You don’t have any orders yet.",
    orderNotFound: "Order not found.",
    myOrdersHeader: (l) => `📋 Your orders:\n\n${l}`,
    resendBtn: (orderNo) => `📥 Download again (#${orderNo})`,
    resendSent: "📤 Sending your order files again…",
    resendFailed: "⚠️ Couldn't find files for this order. Please contact the seller.",
    rateBtn: (orderNo) => `⭐ Rate (#${orderNo})`,
    chooseProductToRate: "Which product from this order are you rating?",
    chooseRatingPrompt: (name) => `Rate "${name}":`,
    reviewSaved: "✅ Thanks for the rating! Want to add a comment — just type it.",
    reviewCommentPrompt: "Type a comment or tap the Skip button.",
    reviewSkipBtn: "Skip",
    reviewCommentSaved: "✅ Comment saved. Thanks for the review!",
    reviewNotAllowed: "⚠️ You can only rate something you actually bought and received.",
    noReviewableProducts: "This order has no products you can rate.",
    statusAwaitingPayment: "⏳ awaiting payment",
    statusAwaitingConfirmation: "🔎 under review",
    statusDelivering: "📤 delivering",
    statusDelivered: "✅ delivered",
    statusRejected: "❌ rejected",
    statusAccepted: "✅ accepted",
    statusInProduction: "👩‍🍳 in production",
    statusReady: "📦 ready",
    shareContactHint:
      "Tap the “📱 Share contact” button at the bottom of the screen, or just type your phone number in the chat.",
    phoneParseFail:
      "Couldn’t recognize that number. Please type it as digits, e.g.: <code>+79001234567</code> or <code>89001234567</code>",
    sendReceiptPrompt: "📨 Please send the payment receipt — a photo or a file (e.g. PDF).",
    fileDownloadFail:
      "⚠️ Couldn’t download the file. Please send the receipt again — photo or PDF.",
    notReceiptLike: (id) =>
      `⚠️ This doesn’t look like a payment receipt.\n\nPlease send a screenshot of the transfer/receipt showing the amount for order #${id}.`,
    receiptManualReview: (id, isPhysical) =>
      `📨 Receipt received for order #${id}, but automatic verification failed.\n` +
      (isPhysical
        ? "The order was sent to the seller for manual review — it will be accepted after confirmation."
        : "The order was sent to the seller for manual review — files will arrive after confirmation."),
    receiptVerifiedDelivering: (id, isPhysical) =>
      isPhysical
        ? `📨 Thank you! Receipt verified. Order #${id} — accepting it now…`
        : `📨 Thank you! Receipt verified. Order #${id} — sending files…`,
    deliveryFailedAfterOcr: (id, isPhysical) =>
      isPhysical
        ? `⚠️ Receipt accepted, but automatic acceptance of order #${id} didn’t complete. The seller will check and accept it manually.`
        : `⚠️ Receipt accepted, but automatic delivery of order #${id} didn’t complete. The seller will check and send the files.`,
    receiptForwardedAwaitingConfirm: (id, isPhysical) =>
      isPhysical
        ? `📨 Thank you! Receipt received. Order #${id} sent for review. As soon as the seller confirms payment, the order will be accepted.`
        : `📨 Thank you! Receipt received. Order #${id} sent for review. As soon as the seller confirms payment, the bot will send the files.`,
    receiptForwardedNoStorage: (id) =>
      `📨 Receipt received and forwarded to the seller. Order #${id} is under review. If needed, you can send the receipt again.`,
    receiptSaveFailed: (id) =>
      `⚠️ Couldn’t save the receipt for order #${id}. The seller will review the order manually. If you’d like, try sending the receipt again.`,
    searchTypePrompt: "Type a name or keyword:",
    infoHeader: "ℹ️ <b>Store information</b>\n\n",
    infoRequiredDocs: "Required documents and payment details (payment system requirement):\n\n",
    offerBtn: "📄 Terms of Use (offer)",
    offerBtnShort: "📄 Terms of Use",
    privacyBtn: "🔒 Privacy Policy",
    requisitesBtn: "🏦 Payment details",
    aboutBtn: "👤 About the seller",
    inviteFriendBtn: "🎁 Invite a friend",
    contactsNotSet: "The author’s contact details haven’t been set yet.",
    contactUsePrefix: (l) => `To contact the author, use the following details:\n${l}`,
    instructionVideoFail: "⚠️ Couldn’t load the instructional video. Please contact the seller.",
    idLabel: (id) => `Your Telegram ID: ${id}`,
    rejectedNotice: (id) =>
      `❌ Your order №${id} has been rejected. If this is a mistake, please contact the seller.`,
    accessDenied: "⛔ Access denied.",
    fileAlreadySent: "⚠️ This file was already sent.",
    loadingMaterials: (lang) => `⏳ Loading materials (${lang})...`,
    materialNotConfigured: (lang) =>
      `⚠️ The file (${lang}) isn’t set up. The seller will send it manually.`,
    paymentReminder: (orderNo, amount) =>
      `🔔 <b>Reminder for order #${orderNo}</b>\n\n` +
      `The order is still awaiting payment (${amount}).\n` +
      `Below is the current payment method. If you already paid, please send the receipt in this chat.`,
    chooseDeliveryLanguage: "🌐 Which language would you like the materials in?",
    allLanguagesBtn: "🌐 All languages (price ×N)",
  },
  uz: {
    back: "« Orqaga",
    subcategories: "📁 Ichki kategoriyalar:",
    catalogHeader: "📚 Katalog:",
    emptyHere: "📂 Bu yerda hozircha hech narsa yo‘q.",
    showMore: "⬇️ Yana ko‘rsatish",
    backToCategories: "« Kategoriyalarga qaytish",
    navigation: "Navigatsiya:",
    addToCartBtn: "➕ Savatga qo‘shish",
    priceFrom: (amount) => `${amount} dan`,
    descPending: "Batafsil tavsif sotuvchidan aniqlanadi.",
    productNotFound: "Mahsulot topilmadi.",
    contactSaved: "✅ Raqam saqlandi.",
    cartEmpty: "🛒 Savat bo‘sh.",
    webHandoffImported:
      "✅ Veb-vitrinadan tanlangan mahsulotlar savatga qo‘shildi. Buyurtma va to‘lovni davom ettiramiz.",
    cartHeader: "🛒 <b>Sizning savatingiz:</b>\n\n",
    removeItem: (name) => `❌ Olib tashlash «${name}»`,
    total: (amount) => `\n<b>Jami: ${amount}</b>`,
    checkoutBtn: "💳 Buyurtma berish",
    clearBtn: "🗑 Tozalash",
    promoCodeBtn: "🎟 Promokod kiritish",
    removePromoBtn: "❌ Promokodni olib tashlash",
    promoCodePrompt: "Promokodni kiriting:",
    promoCodeApplied: (amount) => `✅ Promokod qo‘llandi. Chegirma: ${amount}`,
    promoCodeInvalid: "⚠️ Promokod amal qilmaydi yoki endi ishlamaydi.",
    promoCodeRemoved: "Promokod olib tashlandi.",
    discountLine: (amount) => `Promokod bo‘yicha chegirma: −${amount}\n`,
    pointsBalanceLine: (points) => `🏆 Sizning ballaringiz: ${points}\n`,
    usePointsBtn: "🏆 Ballarni sarflash",
    removePointsBtn: "❌ Ballarni sarflamaslik",
    pointsDiscountLine: (amount) => `Ballar bilan hisobdan chiqarildi: −${amount}\n`,
    giftCertificateBtn: "🎫 Sertifikat kodini kiritish",
    removeGiftCertificateBtn: "❌ Sertifikatni olib tashlash",
    giftCertificateCodePrompt: "Sovg‘a sertifikati kodini kiriting:",
    giftCertificateInvalid: "⚠️ Sertifikat amal qilmaydi yoki allaqachon ishlatilgan.",
    giftCertificateRemoved: "Sertifikat olib tashlandi.",
    giftCertificateDiscountLine: (amount) => `Sertifikat bo‘yicha chegirma: −${amount}\n`,
    outOfStockAtCheckout:
      "⚠️ Savatdagi mahsulotlardan biri hozirgina tugadi. Usiz rasmiylashtiring.",
    phonePromptHtml:
      "Buyurtma berish uchun telefon raqamingizni kiriting — <b>uni shu chatga yozing</b>, masalan:\n<code>+7 900 123-45-67</code>\n\nYoki kontaktni avtomatik ulashish uchun quyidagi tugmani bosing.",
    shareContactBtn: "📱 Kontaktni ulashish",
    fulfillmentTypePrompt: "Buyurtmani qanday olishni xohlaysiz?",
    fulfillmentTypePickupBtn: "🚶 O‘zi olib ketish",
    fulfillmentTypeDeliveryBtn: "🚚 Yetkazib berish",
    fulfillmentDatePrompt: (minDate) =>
      `Buyurtmani qachon olishingiz mumkin? ${minDate} dan erta emas. Sanani KK.OO.YYYY formatida yozing.`,
    fulfillmentDateInvalid: "Sanani tushunmadim. Format: KK.OO.YYYY, masalan 05.03.2026.",
    fulfillmentDateTooEarly: (minDate) =>
      `Bu buyurtma tayyorlanishi uzoqroq — ${minDate} dan erta emas. Keyinroq sana ko‘rsating.`,
    deliveryZonePrompt: "Yetkazib berish zonasini tanlang.",
    addressPrompt: "Yetkazib berish manzilini ko‘rsating.",
    fulfillmentNotePrompt:
      "Buyurtmaga izoh (masalan, tortga yozuv)? Kerak bo‘lmasa — «Izohsiz» tugmasini bosing.",
    fulfillmentNoteSkipBtn: "Izohsiz",
    paymentNotConfigured: "To‘lov usullari hali sozlanmagan. Sotuvchi bilan bog‘laning.",
    chooseCountry:
      "Iltimos, mamlakatingizni tanlang (narxlar va to‘lov ma’lumotlarini ko‘rsatish uchun):",
    countryNoLongerAvailable: "Mamlakatingizga endi xizmat ko‘rsatilmaydi — qayta tanlang.",
    orderCreateFailed: "Buyurtmani yaratib bo‘lmadi. Birozdan so‘ng qayta urinib ko‘ring.",
    defaultInstructions: "To‘lov ma’lumotlarini aniqlash uchun sotuvchi bilan bog‘laning.",
    kzTitleNew: (n) => `🧾 <b>Buyurtma #${n}</b> yaratildi.`,
    kzTitleReminder: (n) => `🔔 <b>Buyurtma #${n}</b> — to‘lov usulini tanlang`,
    amountToPay: (a) => `To‘lash summasi: <b>${a}</b>`,
    choosePayMethod: "To‘lov usulini tanlang:",
    robokassaDesc:
      "• <b>Robokassa</b> — karta orqali to‘lov, fayllar to‘lovdan so‘ng darhol keladi",
    manualDesc:
      "• <b>Rekvizitlar bo‘yicha</b> — qo‘lda o‘tkazma, chekni yuboring — fayllar darhol keladi",
    payViaRobokassaBtn: "💳 Robokassa orqali to‘lash",
    payManualBtn: "🧾 Rekvizitlar bo‘yicha to‘lash",
    rkTitleNew: (n) => `🧾 <b>Buyurtma #${n}</b>`,
    rkTitleReminder: (n) => `🔔 <b>Buyurtma #${n}</b> — to‘lov`,
    robokassaHint:
      "Robokassa orqali to‘lash uchun quyidagi tugmani bosing — to‘lovdan so‘ng fayllar avtomatik keladi.",
    manualTitleNew: (n) => `🧾 <b>Buyurtma #${n}</b> yaratildi.`,
    manualTitleReminder: (n) => `🔔 <b>Buyurtma #${n}</b> — rekvizitlar bo‘yicha to‘lov`,
    afterProofAuto: (isPhysical) =>
      isPhysical
        ? "To‘lovdan so‘ng <b>chekni shu chatga yuboring</b> (foto yoki PDF) — bot buyurtmani darhol ishga qabul qiladi."
        : "To‘lovdan so‘ng <b>chekni shu chatga yuboring</b> (foto yoki PDF) — bot fayllarni darhol yuboradi.",
    afterProofManual: (isPhysical) =>
      isPhysical
        ? "To‘lovdan so‘ng <b>skrinshotni shu chatga yuboring</b> (foto) — sotuvchi tekshirib, buyurtmani ishga qabul qiladi."
        : "To‘lovdan so‘ng <b>skrinshotni shu chatga yuboring</b> (foto) — sotuvchi tekshirib, fayllarni yuboradi.",
    alreadyProcessed: (id) => `Buyurtma #${id} allaqachon qayta ishlanmoqda yoki yopilgan.`,
    robokassaUnavailable:
      "Robokassa vaqtincha ishlamayapti. Rekvizitlar bo‘yicha to‘lovni tanlang.",
    searchNothingFound: "Hech narsa topilmadi. Boshqa so‘z bilan urinib ko‘ring.",
    searchDeeperHint: "Bir daqiqa, batafsil qidiryapman…",
    foundCount: (n) => `🔍 Topilgan materiallar: ${n}`,
    shownOf: (s, t) => `Ko‘rsatildi ${s} / ${t}`,
    searchSessionExpired: "Qidiruv sessiyasi eskirdi. Qayta qidiring.",
    addedToCart: "✅ Savatga qo‘shildi.",
    productUnavailable: "⚠️ Bu material hozir mavjud emas. Katalogdan boshqasini tanlang.",
    productMixedCartMsg:
      "⚠️ Savatda boshqa turdagi mahsulot bor. Avval joriy savatni rasmiylashtiring yoki tozalang.",
    productDigitalLimitMsg: "⚠️ Bu material savatda allaqachon bor — ikkinchi nusxasi kerak emas.",
    productOutOfStockMsg: "⚠️ Kerakli miqdorda mahsulot qolmadi.",
    outOfStockLabel: "❌ Sotuvda yo‘q",
    leadTimeLabel: (days) => `🕒 Tayyorlash muddati: ${days} kun`,
    cartCleared: "🗑 Savat tozalandi.",
    countrySaved: (c) => `✅ Mamlakatingiz saqlandi: ${c}\nEndi to‘g‘ri narxlarni ko‘rasiz!`,
    noOrdersYet: "Sizda hali buyurtmalar yo‘q.",
    orderNotFound: "Buyurtma topilmadi.",
    myOrdersHeader: (l) => `📋 Sizning buyurtmalaringiz:\n\n${l}`,
    resendBtn: (orderNo) => `📥 Qayta yuklab olish (#${orderNo})`,
    resendSent: "📤 Buyurtma fayllarini qayta yuboryapman…",
    resendFailed: "⚠️ Bu buyurtmaning fayllari topilmadi. Sotuvchiga yozing.",
    rateBtn: (orderNo) => `⭐ Baholash (#${orderNo})`,
    chooseProductToRate: "Ushbu buyurtmadan qaysi mahsulotni baholaysiz?",
    chooseRatingPrompt: (name) => `«${name}» mahsulotini baholang:`,
    reviewSaved: "✅ Baholaganingiz uchun rahmat! Izoh qo‘shmoqchi bo‘lsangiz — shunchaki yozing.",
    reviewCommentPrompt: "Izoh yozing yoki «O‘tkazib yuborish» tugmasini bosing.",
    reviewSkipBtn: "O‘tkazib yuborish",
    reviewCommentSaved: "✅ Izoh saqlandi. Sharh uchun rahmat!",
    reviewNotAllowed: "⚠️ Faqat haqiqatan sotib olgan va olgan mahsulotingizni baholay olasiz.",
    noReviewableProducts: "Bu buyurtmada baholash mumkin bo‘lgan mahsulot yo‘q.",
    statusAwaitingPayment: "⏳ to‘lov kutilmoqda",
    statusAwaitingConfirmation: "🔎 tekshirilmoqda",
    statusDelivering: "📤 yetkazilmoqda",
    statusDelivered: "✅ yetkazildi",
    statusRejected: "❌ rad etildi",
    statusAccepted: "✅ ishga qabul qilindi",
    statusInProduction: "👩‍🍳 tayyorlanmoqda",
    statusReady: "📦 tayyor",
    shareContactHint:
      "Ekranning pastidagi «📱 Kontaktni ulashish» tugmasini bosing yoki telefon raqamini chatga yozing.",
    phoneParseFail:
      "Raqamni aniqlab bo‘lmadi. Telefon raqamini raqamlar bilan yozing, masalan: <code>+79001234567</code> yoki <code>89001234567</code>",
    sendReceiptPrompt: "📨 Iltimos, to‘lov chekini yuboring — foto yoki fayl (masalan, PDF).",
    fileDownloadFail: "⚠️ Faylni yuklab bo‘lmadi. Chekni qayta yuboring — foto yoki PDF.",
    notReceiptLike: (id) =>
      `⚠️ Bu to‘lov chekiga o‘xshamayapti.\n\n#${id} buyurtma summasi ko‘rsatilgan o‘tkazma/chek skrinshotini yuboring.`,
    receiptManualReview: (id, isPhysical) =>
      `📨 #${id} buyurtmasi uchun chek qabul qilindi, lekin avtomatik tekshiruv o‘tmadi.\n` +
      (isPhysical
        ? "Buyurtma sotuvchiga qo‘lda tekshirish uchun yuborildi — tasdiqlangandan so‘ng ishga qabul qilinadi."
        : "Buyurtma sotuvchiga qo‘lda tekshirish uchun yuborildi — fayllar tasdiqlangandan so‘ng keladi."),
    receiptVerifiedDelivering: (id, isPhysical) =>
      isPhysical
        ? `📨 Rahmat! Chek tekshirildi. Buyurtma #${id} — ishga qabul qilinmoqda…`
        : `📨 Rahmat! Chek tekshirildi. Buyurtma #${id} — fayllar yuborilmoqda…`,
    deliveryFailedAfterOcr: (id, isPhysical) =>
      isPhysical
        ? `⚠️ Chek qabul qilindi, lekin #${id} buyurtmasini avtomatik qabul qilish yakunlanmadi. Sotuvchi tekshirib, qo‘lda qabul qiladi.`
        : `⚠️ Chek qabul qilindi, lekin #${id} buyurtmasini avtomatik yetkazish yakunlanmadi. Sotuvchi tekshirib, fayllarni yuboradi.`,
    receiptForwardedAwaitingConfirm: (id, isPhysical) =>
      isPhysical
        ? `📨 Rahmat! Chek qabul qilindi. Buyurtma #${id} tekshirishga yuborildi. Sotuvchi to‘lovni tasdiqlashi bilanoq buyurtma ishga qabul qilinadi.`
        : `📨 Rahmat! Chek qabul qilindi. Buyurtma #${id} tekshirishga yuborildi. Sotuvchi to‘lovni tasdiqlashi bilanoq bot fayllarni yuboradi.`,
    receiptForwardedNoStorage: (id) =>
      `📨 Chek qabul qilindi va sotuvchiga yuborildi. Buyurtma #${id} tekshirilmoqda. Kerak bo‘lsa, chekni qayta yuborishingiz mumkin.`,
    receiptSaveFailed: (id) =>
      `⚠️ #${id} buyurtmasi cheki saqlanmadi. Sotuvchi buyurtmani qo‘lda tekshiradi. Xohlasangiz, chekni qayta yuborib ko‘ring.`,
    searchTypePrompt: "Nomi yoki kalit so‘zni yozing:",
    infoHeader: "ℹ️ <b>Do‘kon haqida ma’lumot</b>\n\n",
    infoRequiredDocs: "Majburiy hujjatlar va to‘lov ma’lumotlari (to‘lov tizimlari talabi):\n\n",
    offerBtn: "📄 Foydalanish shartlari (oferta)",
    offerBtnShort: "📄 Foydalanish shartlari",
    privacyBtn: "🔒 Maxfiylik siyosati",
    requisitesBtn: "🏦 To‘lov ma’lumotlari",
    aboutBtn: "👤 Sotuvchi haqida",
    inviteFriendBtn: "🎁 Do‘stni taklif qilish",
    contactsNotSet: "Muallifning aloqa ma’lumotlari hali ko‘rsatilmagan.",
    contactUsePrefix: (l) =>
      `Muallif bilan bog‘lanish uchun quyidagi ma’lumotlardan foydalaning:\n${l}`,
    instructionVideoFail: "⚠️ Yo‘riqnoma videosini yuklab bo‘lmadi. Sotuvchiga yozing.",
    idLabel: (id) => `Sizning Telegram ID: ${id}`,
    rejectedNotice: (id) =>
      `❌ Sizning №${id} buyurtmangiz rad etildi. Agar bu xato bo‘lsa, sotuvchiga yozing.`,
    accessDenied: "⛔ Kirish taqiqlangan.",
    fileAlreadySent: "⚠️ Bu fayl allaqachon yuborilgan.",
    loadingMaterials: (lang) => `⏳ Materiallar yuklanmoqda (${lang})...`,
    materialNotConfigured: (lang) => `⚠️ Fayl (${lang}) sozlanmagan. Sotuvchi qo‘lda yuboradi.`,
    paymentReminder: (orderNo, amount) =>
      `🔔 <b>#${orderNo} buyurtma bo‘yicha eslatma</b>\n\n` +
      `Buyurtma hali to‘lovni kutmoqda (${amount}).\n` +
      `Quyida — joriy to‘lov usuli. Agar allaqachon to‘lagan bo‘lsangiz, chekni shu chatga yuboring.`,
    chooseDeliveryLanguage: "🌐 Materiallarni qaysi tilda olishni xohlaysiz?",
    allLanguagesBtn: "🌐 Barcha tillar (narx ×N)",
  },
};

const MENU_ACTIONS = new Set([
  "📚 Каталог",
  "🔍 Поиск",
  "🛒 Корзина",
  "📋 Мои заказы",
  "📖 Инструкция",
  "ℹ️ Информация",
  // Блок 4, находка 4.11: canonicalMenuAction уже знает эту кнопку и
  // канонизирует под неё локализованный текст — без записи сюда её текст
  // на любом шаге сбора свободного текста (адрес, дата, комментарий к
  // торту) сохранялся как есть, вместо перехода в раздел «Автор».
  "💬 Связаться с автором",
]);

async function mainMenu(locale: Locale = "ru") {
  const c = botCopy[locale];
  const keyboard: Array<Array<Record<string, unknown>>> = [
    [{ text: c.catalog }, { text: c.search }],
    [{ text: c.cart }, { text: c.myOrders }],
    [{ text: c.instruction }, { text: c.information }],
    [{ text: currentVerticalDef().locales[locale].contactBtn }],
  ];
  if ((await hasModule("telegram_mini_app")) && (await hasModule("shop"))) {
    const { appOrigin } = await import("./app-origin.server");
    const { miniAppUrl } = await import("./mini-app.server");
    const origin = appOrigin();
    if (origin) {
      keyboard.unshift([{ text: c.miniAppShop, web_app: { url: miniAppUrl(origin) } }]);
    }
  }
  return {
    keyboard,
    resize_keyboard: true,
  };
}

async function sendMain(
  chat_id: number,
  text?: string,
  opts?: { parse_mode?: "HTML" },
  locale: Locale = "ru",
) {
  await tg("sendMessage", {
    chat_id,
    text: text ?? botCopy[locale].chooseSection,
    reply_markup: await mainMenu(locale),
    disable_web_page_preview: true,
    ...(opts?.parse_mode ? { parse_mode: opts.parse_mode } : {}),
  });
}

function canonicalMenuAction(text: string | undefined): string | undefined {
  if (!text) return text;
  for (const locale of SUPPORTED_LOCALES) {
    const c = botCopy[locale];
    if (text === c.catalog) return "📚 Каталог";
    if (text === c.search) return "🔍 Поиск";
    if (text === c.cart) return "🛒 Корзина";
    if (text === c.myOrders) return "📋 Мои заказы";
    if (text === c.instruction) return "📖 Инструкция";
    if (text === c.information) return "ℹ️ Информация";
    if (text === currentVerticalDef().locales[locale].contactBtn) return "💬 Связаться с автором";
  }
  return text;
}

function languageKeyboard() {
  return {
    inline_keyboard: SUPPORTED_LOCALES.map((locale) => [
      { text: localeNames[locale], callback_data: `locale:${locale}` },
    ]),
  };
}

async function askLanguage(chat_id: number) {
  await tg("sendMessage", {
    chat_id,
    text: botCopy.ru.chooseLanguage,
    reply_markup: languageKeyboard(),
  });
}

/**
 * Применить выбор языка и провести дальше по сценарию — welcome, оферта,
 * страна, главное меню. Вынесено из обработчика `locale:` (см. handleUpdate),
 * чтобы тем же путём можно было провести покупателя автоматически, когда
 * модуль multi_language выключен (см. вызов ниже, в ветке "/start"): тогда
 * выбор языка не показывается вовсе, а сразу подставляется locale по
 * умолчанию — ровно то же самое действие, которое иначе делает нажатие
 * кнопки.
 */
async function applyLocaleSelection(
  chat_id: number,
  from_id: number,
  locale: Locale,
  user: BotUser,
) {
  const s = await db();
  const { data: fresh } = await s
    .from("bot_users")
    .select("*")
    .eq("telegram_id", from_id)
    .maybeSingle();
  const baseUser = (fresh ?? user) as BotUser;
  const nextState = { ...baseUser.state, locale, mode: "idle" as const };
  await setState(from_id, nextState);
  await tg("sendMessage", { chat_id, text: botCopy[locale].languageSaved });
  const base = originFromState();
  const needCountry = !nextState.country_code;
  await tg("sendMessage", {
    chat_id,
    text: welcomeStartHtml(baseUser.first_name, needCountry, locale),
    parse_mode: "HTML",
    reply_markup: legalInlineKeyboard(base, locale),
    disable_web_page_preview: true,
  });
  await sendMain(chat_id, undefined, undefined, locale);
  if (!nextState.country_code) await askCountry(chat_id, from_id, false, locale);
  void syncBotPublicDescription();
  void import("./mini-app.server").then(({ syncMiniAppMenuButton }) =>
    syncMiniAppMenuButton(chat_id, botCopy[locale].miniAppShop),
  );

  if (nextState.web_handoff_pending_checkout) {
    const { web_handoff_pending_checkout: _drop, ...restHandoff } = nextState;
    await setState(from_id, restHandoff);
    const s = await db();
    const { data: refreshed } = await s
      .from("bot_users")
      .select("*")
      .eq("telegram_id", from_id)
      .maybeSingle();
    const handoffUser = (refreshed ?? baseUser) as BotUser;
    const hm = copy[locale];
    await tg("sendMessage", {
      chat_id,
      text: hm.webHandoffImported,
    });
    await showCart(chat_id, handoffUser);
    try {
      await startCheckout(chat_id, handoffUser);
    } catch (e: unknown) {
      console.error(`[bot] web handoff checkout failed for telegram_id=${from_id}`, e);
    }
  }
}

function legalInlineKeyboard(base: string, locale: Locale = "ru") {
  const m = copy[locale];
  return {
    inline_keyboard: [
      [{ text: m.offerBtnShort, url: `${base}/legal/offer` }],
      [{ text: m.privacyBtn, url: `${base}/legal/privacy` }],
    ],
  };
}

async function sendInstruction(chat_id: number, locale: Locale = "ru") {
  const m = copy[locale];
  const s = await db();
  const { data: rows } = await s
    .from("app_settings")
    .select("key, value")
    .in("key", ["instruction_video_path", "instruction_video_file_id", "instruction_caption"]);
  const get = (key: string) =>
    (rows?.find((r) => r.key === key)?.value as string | undefined)?.trim() || "";

  const caption =
    get("instruction_caption") || currentVerticalDef().locales[locale].instructionDefaultCaption;
  const fileId = get("instruction_video_file_id");
  const path = get("instruction_video_path");

  async function cacheFileId(newId: string) {
    if (!newId || newId === fileId) return;
    await s.from("app_settings").upsert({
      key: "instruction_video_file_id",
      value: newId,
      updated_at: new Date().toISOString(),
    });
  }

  function extractVideoFileId(result: unknown): string | null {
    const r = result as
      { video?: { file_id?: string }; document?: { file_id?: string } } | undefined;
    return r?.video?.file_id || r?.document?.file_id || null;
  }

  if (fileId) {
    const res = await tg("sendVideo", { chat_id, video: fileId, caption });
    if (res?.ok) return;
    // stale file_id — fall through to re-upload
  }

  if (!path) {
    await tg("sendMessage", {
      chat_id,
      text: currentVerticalDef().locales[locale].instructionComingSoon,
      reply_markup: await mainMenu(locale),
    });
    return;
  }

  const { data: pub } = s.storage.from("instruction-videos").getPublicUrl(path);
  const publicUrl = pub?.publicUrl;
  if (publicUrl) {
    const res = await tg("sendVideo", { chat_id, video: publicUrl, caption });
    if (res?.ok) {
      const id = extractVideoFileId(res.result);
      if (id) await cacheFileId(id);
      return;
    }
  }

  const { data: blob, error } = await s.storage.from("instruction-videos").download(path);
  if (error || !blob) {
    await tg("sendMessage", {
      chat_id,
      text: m.instructionVideoFail,
      reply_markup: await mainMenu(locale),
    });
    return;
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const filename = path.split("/").pop() || "instruction.mp4";
  const { tgSendMultipart } = await import("./telegram.server");
  const res = await tgSendMultipart(
    "sendVideo",
    { chat_id, caption },
    {
      field: "video",
      filename,
      bytes,
      contentType: blob.type || "video/mp4",
    },
  );
  if (res?.ok) {
    const id = extractVideoFileId(res.result);
    if (id) await cacheFileId(id);
    return;
  }

  // Fallback as document
  const doc = await tgSendMultipart(
    "sendDocument",
    { chat_id, caption },
    {
      field: "document",
      filename,
      bytes,
      contentType: blob.type || "video/mp4",
    },
  );
  if (doc?.ok) {
    const id = extractVideoFileId(doc.result);
    if (id) await cacheFileId(id);
    return;
  }

  await tg("sendMessage", {
    chat_id,
    text: caption,
    reply_markup: await mainMenu(locale),
  });
}

async function showCategories(
  chat_id: number,
  parentId: string | null,
  userCountryCode?: string,
  offset = 0,
  locale: Locale = "ru",
) {
  const m = copy[locale];
  const s = await db();
  const q = s
    .from("categories")
    .select("id, name")
    .eq("is_visible", true)
    .order("sort_order")
    .order("name");
  const { data: cats } = parentId
    ? await q.eq("parent_id", parentId)
    : await q.is("parent_id", null);
  const productsQuery = s
    .from("products")
    .select(
      "*, product_images(image_path, sort_order), product_variants(id, name, price, sort_order)",
    )
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  const { data: products } = parentId
    ? await productsQuery.contains("category_ids", JSON.stringify([parentId]))
    : await productsQuery.eq("category_ids", "[]");

  if (offset === 0 && cats && cats.length > 0) {
    const catButtons: Array<Array<{ text: string; callback_data: string }>> = [];
    for (const c of cats) {
      catButtons.push([
        { text: categoryButtonLabel(c.name as string), callback_data: `cat:${c.id}:0` },
      ]);
    }
    if (parentId) {
      const { data: cur } = await s
        .from("categories")
        .select("parent_id")
        .eq("id", parentId)
        .single();
      const back = cur?.parent_id ? `cat:${cur.parent_id}:0` : "cat:root:0";
      catButtons.push([{ text: m.back, callback_data: back }]);
    }
    await tg("sendMessage", {
      chat_id,
      text: parentId ? m.subcategories : m.catalogHeader,
      reply_markup: { inline_keyboard: catButtons },
    });
  }

  const allProds = products ?? [];
  const page = allProds.slice(offset, offset + 5);

  if (allProds.length === 0 && (!cats || cats.length === 0)) {
    if (offset === 0) {
      const navButtons = [];
      if (parentId) {
        const { data: cur } = await s
          .from("categories")
          .select("parent_id")
          .eq("id", parentId)
          .single();
        const back = cur?.parent_id ? `cat:${cur.parent_id}:0` : "cat:root:0";
        navButtons.push([{ text: m.back, callback_data: back }]);
      }
      await tg("sendMessage", {
        chat_id,
        text: m.emptyHere,
        reply_markup: navButtons.length ? { inline_keyboard: navButtons } : undefined,
      });
    }
    return;
  }

  for (const p of page) {
    await sendProductCard(chat_id, p, userCountryCode, locale);
  }

  const navButtons = [];
  if (offset + 5 < allProds.length) {
    navButtons.push([
      {
        text: m.showMore,
        callback_data: parentId ? `cat:${parentId}:${offset + 5}` : `cat:root:${offset + 5}`,
      },
    ]);
  }

  // Show back button at the end of products if we didn't show categories
  if (parentId && (!cats || cats.length === 0 || offset > 0)) {
    const { data: cur } = await s
      .from("categories")
      .select("parent_id")
      .eq("id", parentId)
      .single();
    const back = cur?.parent_id ? `cat:${cur.parent_id}:0` : "cat:root:0";
    navButtons.push([{ text: m.backToCategories, callback_data: back }]);
  }

  if (navButtons.length > 0) {
    await tg("sendMessage", {
      chat_id,
      text: m.navigation,
      reply_markup: { inline_keyboard: navButtons },
    });
  }
}

async function sendProductCard(
  chat_id: number,
  p: ProductCard,
  userCountryCode: string | undefined,
  locale: Locale = "ru",
) {
  const m = copy[locale];
  const imgs = (p.product_images || []).slice().sort((a, b) => a.sort_order - b.sort_order);

  /**
   * Цена считается общим расчётом — тем же, что и в Instagram.
   *
   * Раньше при неизвестной стране показывалась базовая цена товара, а она у
   * клиента намеренно завышена: у материала за 500 ₸ в основном поле стоит 700,
   * а «500» задано в цене для Казахстана. Покупатель, который не ответил на
   * вопрос о стране (или пришёл в бота до того, как этот вопрос появился), видел
   * 700 вместо 500. Теперь при неизвестной стране считаем по домашней стране
   * продавца.
   *
   * Валюту возвращает сам расчёт — из реквизитов продавца, так что отдельный
   * запрос за ней (и параметр targetCurrency) больше не нужен.
   */
  const { resolvePrice } = await import("./pricing.server");

  // Варианты (Ниши, Блок D) — простой список «1 кг»/«2 кг»: кнопка на
  // каждый вариант вместо одной «В корзину», в подписи — цена «от».
  // Инлайн-клавиатура Telegram не ограничена тремя кнопками (в отличие от
  // Zernio/Direct), пагинация не нужна.
  const variants = (p.product_variants ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);

  const desc = p.description ? `\n\n${escapeHtml(p.description)}` : `\n\n<i>${m.descPending}</i>`;
  const ratingLine = formatRatingSummary(p.rating_avg ?? null, p.rating_count ?? 0);
  // Складской учёт (Кейс 4) — платный модуль: без него stock_quantity в
  // карточке никак не влияет на показ, даже если у товара задан остаток.
  // Остаток считается на весь товар, не на отдельный вариант.
  const outOfStock =
    (await hasModule("stock")) && p.stock_quantity !== undefined && (p.stock_quantity ?? 0) <= 0;
  // Срок изготовления — ДО покупки, не после выбора способа получения
  // (Блок 4, находка 4.21): раньше единственным местом, где покупатель
  // узнавал про "готовим 3 дня", был отказ "Этот заказ готовится дольше"
  // уже во время ввода даты получения — самый важный для решения о покупке
  // факт был спрятан в самом конце чекаута.
  const leadTimeLine =
    p.lead_time_days && p.lead_time_days > 0 ? `\n${m.leadTimeLabel(p.lead_time_days)}` : "";

  let caption: string;
  let reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
  if (variants.length > 0) {
    const priced = await Promise.all(
      variants.map(async (v) => ({ v, money: await resolvePrice(p, userCountryCode ?? null, v) })),
    );
    const minAmount = Math.min(...priced.map((r) => r.money.amount));
    const currency = priced[0]?.money.currency ?? p.currency ?? "KZT";
    caption = `📦 <b>${escapeHtml(p.name)}</b>${desc}\n\n💰 <b>${m.priceFrom(formatMoney(minAmount, currency))}</b>${ratingLine ? `\n${ratingLine}` : ""}${leadTimeLine}${outOfStock ? `\n${m.outOfStockLabel}` : ""}`;
    reply_markup = outOfStock
      ? { inline_keyboard: [] }
      : {
          inline_keyboard: priced.map(({ v, money }) => [
            {
              text: `${v.name} — ${formatMoney(money.amount, money.currency)}`,
              callback_data: `add:${p.id}:${v.id}`,
            },
          ]),
        };
  } else {
    const money = await resolvePrice(p, userCountryCode ?? null);
    caption = `📦 <b>${escapeHtml(p.name)}</b>${desc}\n\n💰 <b>${formatMoney(money.amount, money.currency)}</b>${ratingLine ? `\n${ratingLine}` : ""}${leadTimeLine}${outOfStock ? `\n${m.outOfStockLabel}` : ""}`;
    reply_markup = outOfStock
      ? { inline_keyboard: [] }
      : { inline_keyboard: [[{ text: m.addToCartBtn, callback_data: `add:${p.id}` }]] };
  }

  if (imgs.length === 0) {
    await tg("sendMessage", { chat_id, text: caption, parse_mode: "HTML", reply_markup });
  } else {
    // Send single photo with button
    await tg("sendPhoto", {
      chat_id,
      photo: imageUrl(imgs[0].image_path),
      caption,
      parse_mode: "HTML",
      reply_markup,
    });
  }
}

async function showProduct(
  chat_id: number,
  product_id: string,
  userCountryCode?: string,
  locale: Locale = "ru",
) {
  const s = await db();
  const { data: p } = await s
    .from("products")
    .select(
      "*, product_images(image_path, sort_order), product_variants(id, name, price, sort_order)",
    )
    .eq("id", product_id)
    .eq("is_active", true)
    .single();
  if (!p) {
    await tg("sendMessage", { chat_id, text: copy[locale].productNotFound });
    return;
  }
  await sendProductCard(chat_id, p, userCountryCode, locale);
}
function escapeHtml(t: string): string {
  if (!t) return "";
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("+")) {
    const num = trimmed.replace(/[^\d+]/g, "").slice(1);
    if (num.length < 10 || num.length > 15) return null;
    return `+${num}`;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

async function saveContactAndContinueCheckout(chat_id: number, user: BotUser, phone: string) {
  const locale: Locale = user.state?.locale ?? "ru";
  await setContact(user.telegram_id, phone);
  const updatedUser = { ...user, contact_phone: phone };
  const nextState = { ...user.state, mode: "idle" as const };
  await setState(user.telegram_id, nextState);

  await tg("sendMessage", {
    chat_id,
    text: copy[locale].contactSaved,
    reply_markup: await mainMenu(locale),
  });

  if (!user.state?.country_code) {
    await askCountry(chat_id, user.telegram_id, true, locale);
    return;
  }

  await proceedToFulfillmentOrPlace(chat_id, updatedUser, user.state.country_code);
}

const TELEGRAM_MEDIA_GROUP_MAX = 10;
const TELEGRAM_MESSAGE_MAX = 4000;

/**
 * Насколько свежим должен быть заказ, чтобы присланное фото засчиталось чеком
 * по нему без явного шага сценария. См. запасной путь в handleUpdate.
 */
const PROOF_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// chat_id — number | string, как и у самого Telegram: идентификаторы админов
// читаются из app_settings строкой ("123,456" через запятую) и по пути к отправке
// в число не переводятся. Соседний sendCoverPreviews принимает их так же.
/**
 * `replyMarkup`, when given, is attached only to the last chunk — Telegram
 * rejects anything over TELEGRAM_MESSAGE_MAX outright, `tg()` doesn't throw
 * on that, and a caller that skips this helper for its keyboard (as showCart
 * used to) gets a silent no-op instead of a cart the buyer can act on
 * (Блок 4.4).
 */
async function sendLongHtmlMessage(
  chat_id: number | string,
  text: string,
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
): Promise<number[]> {
  const ids: number[] = [];
  if (text.length <= TELEGRAM_MESSAGE_MAX) {
    const res = await tg("sendMessage", {
      chat_id,
      text,
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    ids.push(...collectTgMessageIds(res.result));
    return ids;
  }
  const lines = text.split("\n");
  const chunks: string[] = [];
  let chunk = "";
  for (const line of lines) {
    const next = chunk ? `${chunk}\n${line}` : line;
    if (next.length > TELEGRAM_MESSAGE_MAX) {
      if (chunk) chunks.push(chunk);
      chunk = line;
    } else {
      chunk = next;
    }
  }
  if (chunk) chunks.push(chunk);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const res = await tg("sendMessage", {
      chat_id,
      text: chunks[i],
      parse_mode: "HTML",
      ...(isLast && replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    ids.push(...collectTgMessageIds(res.result));
  }
  return ids;
}

/**
 * Сквозной номер заказа в пределах одного бота — то, что видит покупатель.
 * Внутренний orders.id остаётся глобальным (FK, callback_data, InvId Robokassa),
 * поэтому показывать его нельзя: у разных клиентов номера шли бы вперемешку.
 */
async function displayNoFor(orderId: number): Promise<number> {
  const s = await db();
  const { data } = await s.from("orders").select("order_no").eq("id", orderId).maybeSingle();
  return data?.order_no ?? orderId;
}

async function sendCoverPreviews(
  adminChatId: string,
  displayNo: number,
  coverUrls: string[],
): Promise<number[]> {
  if (coverUrls.length === 0) return [];
  const ids: number[] = [];
  const shortCaption = `📦 <b>Материалы заказа #${displayNo}</b> (${coverUrls.length} шт.)`;
  for (let offset = 0; offset < coverUrls.length; offset += TELEGRAM_MEDIA_GROUP_MAX) {
    const batch = coverUrls.slice(offset, offset + TELEGRAM_MEDIA_GROUP_MAX);
    try {
      if (batch.length === 1) {
        const res = await tg("sendPhoto", {
          chat_id: adminChatId,
          photo: batch[0],
          caption: offset === 0 ? shortCaption : undefined,
          parse_mode: "HTML",
        });
        ids.push(...collectTgMessageIds(res.result));
      } else {
        const res = await tg("sendMediaGroup", {
          chat_id: adminChatId,
          media: batch.map((u, idx) => ({
            type: "photo",
            media: u,
            ...(offset === 0 && idx === 0 ? { caption: shortCaption, parse_mode: "HTML" } : {}),
          })),
        });
        ids.push(...collectTgMessageIds(res.result));
      }
    } catch (err) {
      console.error(`[bot] cover preview batch failed for order #${displayNo}`, err);
    }
    if (offset + TELEGRAM_MEDIA_GROUP_MAX < coverUrls.length) await sleep(300);
  }
  return ids;
}

/**
 * Положить товар в корзину.
 *
 * `product_id` приходит из `callback_data`, то есть от клиента: старая кнопка
 * из переписки месячной давности работает ровно так же, как свежая. Поэтому
 * товар проверяется здесь, а не только при показе каталога — иначе снятая
 * продавцом галочка «показывать в боте» не мешала покупке, а удалённый товар
 * ронял вставку по внешнему ключу.
 *
 * Direct-ветка делает ровно это и объясняет причину (zernio-bot.server.ts:
 * «Материал без файла продавать нельзя: заказ дошёл бы до подтверждения и
 * упёрся бы там — уже после того, как человек заплатил»). Телеграмная ветка
 * этих проверок не имела.
 *
 * Возвращает причину, когда добавить не удалось (Блок 4, находка 4.20):
 * раньше все пять исходов сворачивались в один и тот же generic
 * «Товар недоступен», и покупатель не мог понять, стоит ли повторить
 * попытку (сбой БД) или он ничего не может сделать (смешанная корзина,
 * остаток исчерпан, цифровой товар уже в корзине).
 */
async function addToCart(
  telegram_id: number,
  product_id: string,
  product_variant_id?: string | null,
): Promise<"ok" | "unavailable" | "mixed_cart" | "digital_limit" | "out_of_stock" | "error"> {
  const s = await db();

  const { data: product, error: productError } = await s
    .from("products")
    .select("id, is_active, stock_quantity, fulfillment_kind")
    .eq("id", product_id)
    .maybeSingle();
  if (productError) {
    console.error("[bot] addToCart: не удалось прочитать товар", product_id, productError);
    return "error";
  }
  if (!product?.is_active) return "unavailable";

  // Вариант (Ниши, Блок D) должен реально принадлежать этому товару —
  // callback_data приходит от клиента, доверять её без проверки нельзя:
  // иначе можно было бы подсунуть чужой (или чужого продавца) вариант с
  // произвольной ценой.
  if (product_variant_id) {
    const { data: variant } = await s
      .from("product_variants")
      .select("id")
      .eq("id", product_variant_id)
      .eq("product_id", product_id)
      .maybeSingle();
    if (!variant) return "unavailable";
  }

  // Смешанная корзина (физический товар + цифровой материал) не
  // поддерживается — у них разные машины выдачи (Ниши, Блок 6). Проверяем
  // ДО вставки, а не разбираем после.
  const incomingKind = product.fulfillment_kind === "physical" ? "physical" : "digital";
  const { data: other } = await s
    .from("cart_items")
    .select("products(fulfillment_kind)")
    .eq("telegram_id", telegram_id)
    .neq("product_id", product_id)
    .limit(1)
    .maybeSingle();
  if (other) {
    const otherKind =
      (other as { products?: { fulfillment_kind?: string } }).products?.fulfillment_kind ===
      "physical"
        ? "physical"
        : "digital";
    if (otherKind !== incomingKind) return "mixed_cart";
  }

  // Строка корзины — по товару И варианту: у одного товара может быть
  // несколько строк в корзине одновременно, по одной на выбранный вариант
  // (Ниши, Блок D). PostgREST не матчит NULL через .eq(), поэтому для
  // товара без вариантов нужна отдельная ветка с .is().
  let existingQuery = s
    .from("cart_items")
    .select("id, quantity")
    .eq("telegram_id", telegram_id)
    .eq("product_id", product_id);
  existingQuery = product_variant_id
    ? existingQuery.eq("product_variant_id", product_variant_id)
    : existingQuery.is("product_variant_id", null);
  const { data: existing } = await existingQuery.maybeSingle();

  // Цифровой товар — не более 1 шт. в строке: копия того же файла не имеет
  // смысла (Блок 4, находка 4.14). У Direct-канала этот потолок уже был
  // (direct-purchase.server.ts), у Telegram его не было никогда.
  if (incomingKind === "digital" && existing) return "digital_limit";

  // Складской учёт (Кейс 4) — платный модуль: без него stock_quantity
  // никогда не ограничивает добавление в корзину, даже если задан. Точная
  // атомарная проверка — на оформлении (placeOrderInner); здесь только
  // предварительная, чтобы не пускать в корзину заведомо больше остатка.
  // Остаток считается на весь товар, не на отдельный вариант — вариантов
  // без своего складского учёта (Ниши, Блок D, вне объёма).
  //
  // Сумма по ВСЕМ строкам этого товара, не только по `existing` строке
  // текущего варианта (Блок 8, находка 8.5) — иначе при остатке 1 можно
  // было положить и "1 кг" (existing для него — 0), и "2 кг" (existing для
  // него тоже 0), в сумме 2 при остатке 1. decrementStock на оформлении
  // упал бы, но именно на второй позиции, и без 8.5's cart_items.delete()
  // выше повторная попытка падала бы так же бесконечно.
  if ((await hasModule("stock")) && product.stock_quantity !== null) {
    const { data: sameProductRows } = await s
      .from("cart_items")
      .select("quantity")
      .eq("telegram_id", telegram_id)
      .eq("product_id", product_id);
    const alreadyInCart = (sameProductRows ?? []).reduce(
      (sum, r) => sum + (Number(r.quantity) || 0),
      0,
    );
    if (alreadyInCart + 1 > product.stock_quantity) return "out_of_stock";
  }

  if (existing) {
    const { error } = await s
      .from("cart_items")
      .update({ quantity: (existing.quantity as number) + 1 })
      .eq("id", existing.id);
    if (error) {
      console.error("[bot] addToCart: не удалось увеличить количество", error);
      return "error";
    }
    return "ok";
  }

  const { error } = await s.from("cart_items").insert({
    telegram_id,
    product_id,
    product_variant_id: product_variant_id ?? null,
    quantity: 1,
  });
  if (error) {
    console.error("[bot] addToCart: не удалось добавить позицию", error);
    return "error";
  }
  return "ok";
}

/**
 * Перенос позиций с веб-витрины (deep link wc_<token>) в cart_items.
 * digital_limit считается успехом — товар уже в корзине.
 */
export async function importCartItemsForHandoff(
  telegram_id: number,
  items: Array<{
    product_id: string;
    product_variant_id?: string | null;
    quantity: number;
  }>,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  for (const item of items) {
    const qty = Math.max(1, Math.min(99, Math.floor(item.quantity) || 1));
    for (let i = 0; i < qty; i++) {
      const result = await addToCart(telegram_id, item.product_id, item.product_variant_id ?? null);
      if (result === "ok" || result === "digital_limit") imported++;
      else skipped++;
    }
  }
  return { imported, skipped };
}

/**
 * Списывает остаток атомарно (CAS по stock_quantity, с повторами — в
 * отличие от used_count промокода это ресурс без единственного владельца
 * "первый выигрывает", гонка при высоком спросе более вероятна). null у
 * товара — остаток не отслеживается, всегда доступно. false после
 * исчерпания попыток — вызывающий код (placeOrderInner) откатывает уже
 * списанные позиции той же корзины через restoreStock().
 */
async function decrementStock(productId: string, qty: number): Promise<boolean> {
  const s = await db();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: product } = await s
      .from("products")
      .select("stock_quantity")
      .eq("id", productId)
      .maybeSingle();
    if (!product || product.stock_quantity === null) return true;
    if (product.stock_quantity < qty) return false;
    const { data: updated } = await s
      .from("products")
      .update({ stock_quantity: product.stock_quantity - qty })
      .eq("id", productId)
      .eq("stock_quantity", product.stock_quantity)
      .select("id")
      .maybeSingle();
    if (updated) return true;
  }
  return false;
}

/** Возвращает остаток, списанный decrementStock() ранее в той же попытке оформления. */
async function restoreStock(productId: string, qty: number): Promise<void> {
  const s = await db();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: product } = await s
      .from("products")
      .select("stock_quantity")
      .eq("id", productId)
      .maybeSingle();
    if (!product || product.stock_quantity === null) return;
    const { data: updated } = await s
      .from("products")
      .update({ stock_quantity: product.stock_quantity + qty })
      .eq("id", productId)
      .eq("stock_quantity", product.stock_quantity)
      .select("id")
      .maybeSingle();
    if (updated) return;
  }
  // Исчерпали попытки — best-effort, как и остальные CAS в этом файле.
  // Расхождение требует пяти гонок подряд на одном товаре, крайне
  // маловероятно; не блокируем оформление ради отката остатка.
}

async function showCart(chat_id: number, user: BotUser) {
  const locale: Locale = user.state?.locale ?? "ru";
  const m = copy[locale];
  const telegram_id = user.telegram_id;
  const s = await db();
  const { data: items } = await s
    .from("cart_items")
    .select(
      "id, quantity, product_variant_id, products(id, name, price, currency, country_prices), product_variants(id, name, price)",
    )
    .eq("telegram_id", telegram_id);
  if (!items?.length) {
    await tg("sendMessage", { chat_id, text: m.cartEmpty });
    return;
  }
  let total = 0;
  // Валюту задаёт общий расчёт: она берётся из реквизитов страны покупателя, а
  // при неизвестной стране — из домашней страны продавца.
  let currency = "KZT";
  const { resolvePrice } = await import("./pricing.server");

  let text = m.cartHeader;
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const it of items) {
    const p = it.products;
    if (!p) continue;
    // Вариант (Ниши, Блок D) — имя строкой в скобках, цена подставляется в
    // resolvePrice вместо цены товара.
    const variant = it.product_variants;
    const money = await resolvePrice(p, user.state?.country_code ?? null, variant);
    currency = money.currency;
    const line = Number(money.amount) * Number(it.quantity);
    total += line;
    const displayName = variant ? `${p.name} (${variant.name})` : p.name;
    text += `• ${escapeHtml(displayName)} × ${it.quantity} — ${formatMoney(line, currency)}\n`;
    buttons.push([{ text: m.removeItem(displayName), callback_data: `rem:${it.id}` }]);
  }
  // Кейс 3 №1/№3 (промокоды/баллы) продаются как отдельные платные модули
  // (registry.ts coupons/loyalty) — без него ни кнопка, ни списание не
  // показываются, даже если в state завалялся код/переключатель с
  // момента, когда модуль ещё был включён.
  const couponsOn = await hasModule("coupons");
  const promoCode = couponsOn ? user.state?.promo_code : undefined;
  let discount = 0;
  if (promoCode) {
    const found = await findValidPromoCode(promoCode);
    if (found.ok) {
      discount = computePromoDiscount(total, found.promo);
      text += m.discountLine(formatMoney(discount, currency));
    }
  }
  const loyaltyOn = await hasModule("loyalty");
  const pointsBalance = loyaltyOn ? (user.loyalty_points ?? 0) : 0;
  const usePoints = Boolean(user.state?.use_points);
  let pointsDiscount = 0;
  if (pointsBalance > 0) {
    text += m.pointsBalanceLine(pointsBalance);
    if (usePoints) {
      pointsDiscount = computePointsDiscount(total - discount, pointsBalance);
      if (pointsDiscount > 0) text += m.pointsDiscountLine(formatMoney(pointsDiscount, currency));
    }
  }
  const giftCertificatesOn = await hasModule("gift_certificates");
  const giftCertificateCode = giftCertificatesOn ? user.state?.gift_certificate_code : undefined;
  let giftCertificateDiscount = 0;
  if (giftCertificateCode) {
    const found = await findValidGiftCertificate(giftCertificateCode);
    if (found.ok) {
      giftCertificateDiscount = computeGiftCertificateDiscount(
        total - discount - pointsDiscount,
        found.certificate.amount,
      );
      text += m.giftCertificateDiscountLine(formatMoney(giftCertificateDiscount, currency));
    }
  }
  text += m.total(
    formatMoney(total - discount - pointsDiscount - giftCertificateDiscount, currency),
  );
  buttons.push([
    { text: m.checkoutBtn, callback_data: "checkout" },
    { text: m.clearBtn, callback_data: "clear" },
  ]);
  if (couponsOn) {
    buttons.push([
      promoCode
        ? { text: m.removePromoBtn, callback_data: "promo:clear" }
        : { text: m.promoCodeBtn, callback_data: "promo:enter" },
    ]);
  }
  if (pointsBalance > 0) {
    buttons.push([
      usePoints
        ? { text: m.removePointsBtn, callback_data: "points:clear" }
        : { text: m.usePointsBtn, callback_data: "points:use" },
    ]);
  }
  if (giftCertificatesOn) {
    buttons.push([
      giftCertificateCode
        ? { text: m.removeGiftCertificateBtn, callback_data: "giftcert:clear" }
        : { text: m.giftCertificateBtn, callback_data: "giftcert:enter" },
    ]);
  }
  // Большая корзина легко превышает лимит Telegram в 4096 символов — tg()
  // не бросает на отказе, и покупатель молча не получал вообще ничего
  // (Блок 4.4).
  await sendLongHtmlMessage(chat_id, text, { inline_keyboard: buttons });
}

async function startCheckout(chat_id: number, user: BotUser) {
  const locale: Locale = user.state?.locale ?? "ru";
  const m = copy[locale];
  const telegram_id = user.telegram_id;
  console.info(`[bot] checkout start for telegram_id=${telegram_id}`, {
    hasContact: Boolean(user.contact_phone),
    countryCode: user.state?.country_code ?? null,
  });
  const s = await db();
  const { count, error: cartError } = await s
    .from("cart_items")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", telegram_id);
  if (cartError) {
    throw new Error(`checkout cart lookup failed: ${cartError.message}`);
  }
  if (!count) {
    await tg("sendMessage", { chat_id, text: m.cartEmpty });
    return;
  }
  if (!user.contact_phone) {
    await setState(telegram_id, { ...user.state, mode: "awaiting_contact" });
    await tg("sendMessage", {
      chat_id,
      text: m.phonePromptHtml,
      parse_mode: "HTML",
      reply_markup: {
        keyboard: [[{ text: m.shareContactBtn, request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return;
  }

  if (!user.state?.country_code) {
    await askCountry(chat_id, telegram_id, true, locale);
    return;
  }

  // Двойной тап по "Оформить" гасится атомарным claimOrderPlacement внутри
  // placeOrder (тем же приёмом, что checkout через кнопку страны) — здесь
  // раньше стоял свой, отдельный и неатомарный guard "прочитал mode, потом
  // записал", ровно тот паттерн гонки, который claimOrderPlacement и чинит.
  // user has contact and country, proceed to fulfillment/language questions or straight to placeOrder
  await proceedToFulfillmentOrPlace(chat_id, user, user.state.country_code);
}

async function askCountry(
  chat_id: number,
  telegram_id: number,
  forCheckout = false,
  locale: Locale = "ru",
) {
  const m = copy[locale];
  const s = await db();
  const { data: methods } = await s
    .from("payment_methods")
    .select("country_code, country_name")
    .eq("is_active", true)
    .order("sort_order");
  if (!methods?.length) {
    await tg("sendMessage", {
      chat_id,
      text: m.paymentNotConfigured,
    });
    return;
  }

  const prefix = forCheckout ? "country:" : "setcountry:";

  await tg("sendMessage", {
    chat_id,
    text: m.chooseCountry,
    reply_markup: {
      inline_keyboard: methods.map((method) => [
        { text: method.country_name as string, callback_data: `${prefix}${method.country_code}` },
      ]),
    },
  });
}

// A product's deliverable material: either rows in product_material_files
// (the current multi-file/photo uploader) or, for products saved before it
// existed, the single legacy file_path/file_url column for that language.
//
// Логика переехала в product-materials.ts и стала общей с заказами из
// Instagram: две копии этого разбора уже разошлись один раз и стоили клиенту
// оплаченного, но не выданного заказа (см. комментарий в том файле).
import {
  MATERIAL_LANGUAGES,
  materialsForProduct,
  availableMaterialLanguages,
  materialsForOrderItem,
  parseDeliveredLanguages,
  addDeliveredLanguage,
  isDeliveryLangChoice,
  deliveryPriceMultiplier,
  type DeliveryLangChoice,
} from "./product-materials";
import { normalizePromoCode, computePromoDiscount, type PromoDiscountType } from "./promo-codes";
import { computePointsDiscount } from "./loyalty";
import { formatRatingSummary, isValidRating } from "./reviews";
import { normalizeGiftCertificateCode, computeGiftCertificateDiscount } from "./gift-certificates";

/**
 * Атомарно помечает начало оформления заказа. Кнопка выбора страны — обычный
 * inline-callback, и двойной тап по ней (частое дело в Telegram) до этой
 * правки успевал прочитать одну и ту же корзину дважды и создать два
 * одинаковых заказа: cart_items не трогается до самого конца placeOrder.
 *
 * Раньше здесь был CAS по updated_at (claimBotUserState). Он оказался
 * ненадёжен: токеном служил updated_at, а его двигает триггер
 * trg_bot_users_touch на любой апдейт строки — включая upsertUser(), который
 * handleUpdate вызывает на каждое нажатие ещё до оформления. Достаточно было
 * двум исполнениям одного и того же «Оформить заказ» наложиться (Telegram
 * повторяет обновление, если не дождался ответа), и они рушили захваты друг
 * друга: оба возвращали false, placeOrder молча выходил — ни заказа, ни
 * сообщения покупателю. См. MIGRATION-27-atomic-order-claim.sql.
 *
 * Теперь проверка и запись — один оператор внутри claim_order_placement():
 * посторонние записи в строку на него не влияют.
 *
 * Флаг сам стирается на успешном пути: startManualProofPath /
 * sendKzPaymentChoice / sendRobokassaPayLink переписывают state целиком из
 * user.state, снятого ДО claim'а, — в нём placing_order никогда не было.
 * Явно снимать его нужно только на ранних выходах ниже (пустая корзина,
 * ошибка вставки заказа), где никто больше state не перезапишет.
 */
export async function claimOrderPlacement(telegram_id: number): Promise<boolean> {
  const s = await db();
  const { data, error } = await s.rpc("claim_order_placement", {
    p_bot_id: process.env.BOT_ID?.trim() ?? "",
    p_telegram_id: telegram_id,
  });
  if (error) {
    // Не глотаем: без захвата placeOrder просто молча выйдет, а покупатель
    // так и не поймёт, почему «Оформить заказ» ничего не делает.
    throw new Error(`claim_order_placement failed: ${error.message}`);
  }
  return data === true;
}

export async function releaseOrderPlacement(telegram_id: number, state: BotUser["state"]) {
  const { placing_order: _placing_order, ...rest } = (state ?? {}) as NonNullable<BotUser["state"]>;
  await setState(telegram_id, rest);
}

/**
 * Между выбором страны и оформлением: если настройка delivery_lang_timing
 * = "before" и у товаров в корзине больше одного языка на выбор, спросить
 * язык доставки ДО заказа (см. product-materials.ts DeliveryLangChoice) —
 * иначе сразу оформлять как раньше.
 */
async function proceedToLanguageOrPlace(chat_id: number, user: BotUser, country_code: string) {
  const telegram_id = user.telegram_id;
  const locale: Locale = user.state?.locale ?? "ru";

  if (await shouldAskDeliveryLangBeforeOrder()) {
    const langs = await deliveryLangChoicesForCart(telegram_id);
    if (langs.length > 1) {
      const nextState = { ...user.state, country_code };
      await setState(telegram_id, nextState);
      await askDeliveryLanguage(chat_id, langs, locale);
      return;
    }
  }
  await placeOrder(chat_id, user, country_code);
}

// loadPaymentMode()/cartFulfillmentKind()/maxLeadTimeDaysInCart()/
// fulfillmentOptionsEnabled() и дата-хелперы (todayInAppTZ и т.д.) переехали
// в fulfillment.server.ts — физический заказ подтверждается и оформляется
// не только из Telegram (admin-панель, Direct-каналы), тянуть туда весь
// этот файл ради нескольких чистых функций не нужно (Ниши, Блок 8.3).

/**
 * Развилка чекаута для физических товаров (Ниши, Блок 8) — вставлена между
 * выбором страны и proceedToLanguageOrPlace. Цифровая корзина идёт по
 * прежнему пути без единого изменения; физическая — спрашивает способ и
 * дату получения (и адрес, если доставка) до самого оформления.
 */
async function proceedToFulfillmentOrPlace(chat_id: number, user: BotUser, country_code: string) {
  const telegram_id = user.telegram_id;
  const locale: Locale = user.state?.locale ?? "ru";
  // Зона/тип/дата получения — одноразовые поля прошлого прохода чекаута
  // (Блок 4, находка 4.1). Раньше они чистились только внутри
  // placeOrderInner, в конце успешного оформления: если покупатель выбрал
  // зону доставки "Левый берег" (+2000), бросил чекаут на шаге адреса и
  // вернулся выбрать самовывоз — старая зона и её комиссия ехали в новый
  // заказ, хотя способ получения сменился. Здесь — самое начало решения
  // "как получать", поэтому все прежние значения сбрасываются явно.
  const nextState = {
    ...user.state,
    country_code,
    checkout_fulfillment_type: undefined,
    checkout_delivery_zone_id: undefined,
    checkout_delivery_zone_name: undefined,
    checkout_delivery_fee: undefined,
  };
  const { cartFulfillmentKind, fulfillmentOptionsEnabled } = await import("./fulfillment.server");

  if ((await cartFulfillmentKind(telegram_id)) !== "physical") {
    await setState(telegram_id, nextState);
    await proceedToLanguageOrPlace(chat_id, { ...user, state: nextState }, country_code);
    return;
  }

  const { pickup, delivery } = await fulfillmentOptionsEnabled();
  if (pickup && delivery) {
    // Свой mode (Блок 4, находка 4.4) — раньше здесь стоял mode: undefined,
    // и у шага "как получать" не было ни текстового фолбэка (напечатал
    // "самовывоз" вместо тапа — уходило в поиск товара), ни защиты от
    // тапа по старой кнопке из прошлого прохода чекаута (находка 4.6).
    await setState(telegram_id, { ...nextState, mode: "awaiting_fulfillment_type" });
    await tg("sendMessage", {
      chat_id,
      text: copy[locale].fulfillmentTypePrompt,
      reply_markup: {
        inline_keyboard: [
          [{ text: copy[locale].fulfillmentTypePickupBtn, callback_data: "fulfilltype:pickup" }],
          [
            {
              text: copy[locale].fulfillmentTypeDeliveryBtn,
              callback_data: "fulfilltype:delivery",
            },
          ],
        ],
      },
    });
    return;
  }
  // Продавец сам не оставил выбора (или отключил оба варианта — тогда
  // самовывоз безопаснее считать умолчанием, чем ломать оформление).
  const only: "pickup" | "delivery" = delivery ? "delivery" : "pickup";
  await askFulfillmentDate(
    chat_id,
    telegram_id,
    { ...nextState, checkout_fulfillment_type: only },
    locale,
  );
}

async function askFulfillmentDate(
  chat_id: number,
  telegram_id: number,
  state: BotUser["state"],
  locale: Locale,
) {
  const { maxLeadTimeDaysInCart, todayInAppTZ, addDaysToIsoDate, isoDateToDisplay } =
    await import("./fulfillment.server");
  const minDays = await maxLeadTimeDaysInCart(telegram_id);
  const minIso = addDaysToIsoDate(todayInAppTZ(), minDays);
  await setState(telegram_id, {
    ...state,
    mode: "awaiting_fulfillment_date",
    checkout_min_fulfillment_date: minIso,
  });
  await tg("sendMessage", {
    chat_id,
    text: copy[locale].fulfillmentDatePrompt(isoDateToDisplay(minIso)),
  });
}

/**
 * Шаг выбора зоны доставки (Ниши, Блок B) — вставлен между датой и адресом,
 * только когда выбрана доставка. Если у продавца нет ни одной активной
 * зоны — шаг пропускается целиком и сразу спрашивается адрес, как и было
 * раньше (обратная совместимость для ботов без настроенных зон).
 */
async function proceedToDeliveryZoneOrAddress(
  chat_id: number,
  telegram_id: number,
  state: BotUser["state"],
  locale: Locale,
) {
  const { activeDeliveryZones } = await import("./fulfillment.server");
  const zones = await activeDeliveryZones();
  if (!zones.length) {
    await setState(telegram_id, { ...state, mode: "awaiting_address" });
    await tg("sendMessage", { chat_id, text: copy[locale].addressPrompt });
    return;
  }
  await setState(telegram_id, { ...state, mode: "awaiting_delivery_zone" });
  // Цена зоны в подписи кнопки (Блок 4, находка 4.2) — раньше показывалось
  // только название, покупатель выбирал вслепую и узнавал стоимость
  // доставки только по итоговой сумме к оплате.
  const { currencyForCountry, defaultCountryCode } = await import("./pricing.server");
  const currency =
    (await currencyForCountry(state?.country_code ?? (await defaultCountryCode()))) ?? "";
  await tg("sendMessage", {
    chat_id,
    text: copy[locale].deliveryZonePrompt,
    reply_markup: {
      inline_keyboard: zones.map((z) => [
        {
          text: `${z.name} (+${z.price}${currency ? ` ${currency}` : ""})`,
          callback_data: `zone:${z.id}`,
        },
      ]),
    },
  });
}

async function shouldAskDeliveryLangBeforeOrder(): Promise<boolean> {
  const { hasModule } = await import("./modules/modules.server");
  if (!(await hasModule("multi_language"))) return false;
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", "delivery_lang_timing")
    .maybeSingle();
  return (data?.value ?? "after") === "before";
}

/** Языки, реально доступные хоть у одного товара в корзине — те, что стоит предлагать выбрать. */
async function deliveryLangChoicesForCart(telegram_id: number): Promise<Locale[]> {
  const s = await db();
  const { data: items } = await s
    .from("cart_items")
    .select(
      "products(file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz, product_material_files(language, file_path, file_name, sort_order))",
    )
    .eq("telegram_id", telegram_id);
  const set = new Set<Locale>();
  for (const it of items ?? []) {
    for (const lang of availableMaterialLanguages(it.products)) set.add(lang);
  }
  return MATERIAL_LANGUAGES.filter((l) => set.has(l));
}

async function askDeliveryLanguage(chat_id: number, langs: Locale[], locale: Locale) {
  const m = copy[locale];
  await tg("sendMessage", {
    chat_id,
    text: m.chooseDeliveryLanguage,
    reply_markup: {
      inline_keyboard: [
        ...langs.map((l) => [
          { text: `${localeFlags[l]} ${localeNames[l]}`, callback_data: `checkoutlang:${l}` },
        ]),
        [{ text: m.allLanguagesBtn, callback_data: "checkoutlang:all" }],
      ],
    },
  });
}

type PromoLookup =
  | {
      ok: true;
      promo: {
        id: string;
        used_count: number;
        discount_type: PromoDiscountType;
        discount_value: number;
      };
    }
  | { ok: false; reason: "not_found" | "inactive" | "expired" | "exhausted" };

/**
 * Проверка кода без списания использования — для предпоказа скидки в
 * корзине. Списание (used_count += 1) происходит только один раз, в
 * redeemPromoCode при оформлении, чтобы код не сгорал от одной попытки
 * ввода без реальной покупки.
 */
async function findValidPromoCode(rawCode: string): Promise<PromoLookup> {
  const s = await db();
  const code = normalizePromoCode(rawCode);
  const { data: promo } = await s
    .from("promo_codes")
    .select("id, used_count, discount_type, discount_value, max_uses, valid_until, is_active")
    .eq("code", code)
    .maybeSingle();
  if (!promo) return { ok: false, reason: "not_found" };
  if (!promo.is_active) return { ok: false, reason: "inactive" };
  if (promo.valid_until && new Date(promo.valid_until).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
    return { ok: false, reason: "exhausted" };
  }
  return {
    ok: true,
    promo: {
      id: promo.id,
      used_count: promo.used_count,
      discount_type: promo.discount_type as PromoDiscountType,
      discount_value: Number(promo.discount_value),
    },
  };
}

/**
 * Списывает использование промокода атомарно (CAS по used_count — тот же
 * приём, что и delivery_index в orders.server.ts): два покупателя, оба
 * читающие последнее доступное использование лимитированного кода
 * одновременно, не смогут оба его получить — второй получит "race" и код
 * будет считаться недоступным, а не перерасходованным.
 */
async function redeemPromoCode(
  rawCode: string,
  subtotal: number,
): Promise<
  { ok: true; discount: number; promoId: string; previousUsedCount: number } | { ok: false }
> {
  const found = await findValidPromoCode(rawCode);
  if (!found.ok) return { ok: false };
  const discount = computePromoDiscount(subtotal, found.promo);
  const s = await db();
  const { data: updated } = await s
    .from("promo_codes")
    .update({ used_count: found.promo.used_count + 1 })
    .eq("id", found.promo.id)
    .eq("used_count", found.promo.used_count)
    .select("id")
    .maybeSingle();
  if (!updated) return { ok: false };
  return {
    ok: true,
    discount,
    promoId: found.promo.id,
    previousUsedCount: found.promo.used_count,
  };
}

type GiftCertificateLookup =
  { ok: true; certificate: { id: string; amount: number } } | { ok: false };

async function findValidGiftCertificate(rawCode: string): Promise<GiftCertificateLookup> {
  const s = await db();
  const code = normalizeGiftCertificateCode(rawCode);
  const { data: cert } = await s
    .from("gift_certificates")
    .select("id, amount, status")
    .eq("code", code)
    .maybeSingle();
  if (!cert || cert.status !== "active") return { ok: false };
  return { ok: true, certificate: { id: cert.id, amount: Number(cert.amount) } };
}

/**
 * Списывает сертификат атомарно (CAS по status — тот же приём, что и
 * used_count у промокода). Заказ на этот момент ещё не создан (см.
 * placeOrderInner), поэтому redeemed_order_id проставляется отдельным
 * запросом сразу после успешной вставки заказа — best-effort, как и у
 * промокода: если оформление сорвётся ниже, списание не откатывается.
 */
async function redeemGiftCertificate(
  rawCode: string,
  subtotal: number,
  telegram_id: number,
): Promise<{ ok: true; discount: number; certificateId: string } | { ok: false }> {
  const found = await findValidGiftCertificate(rawCode);
  if (!found.ok) return { ok: false };
  const discount = computeGiftCertificateDiscount(subtotal, found.certificate.amount);
  const s = await db();
  const { data: updated } = await s
    .from("gift_certificates")
    .update({
      status: "redeemed",
      redeemed_by_telegram_id: telegram_id,
      redeemed_at: new Date().toISOString(),
    })
    .eq("id", found.certificate.id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (!updated) return { ok: false };
  return { ok: true, discount, certificateId: found.certificate.id };
}

async function rollbackCheckoutRedemptions(params: {
  telegram_id: number;
  promo?: { id: string; previousUsedCount: number } | null;
  pointsUsed?: number;
  giftCertificateId?: string | null;
  orderId?: number | null;
}): Promise<void> {
  const s = await db();
  if (params.promo) {
    // Usage is an aggregate counter. If other buyers incremented it after us,
    // decrement the current value by one with CAS instead of requiring the
    // exact original value.
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: promo } = await s
        .from("promo_codes")
        .select("used_count")
        .eq("id", params.promo.id)
        .maybeSingle();
      const current = Number(promo?.used_count ?? 0);
      if (current <= params.promo.previousUsedCount) break;
      const { data: restored } = await s
        .from("promo_codes")
        .update({ used_count: current - 1 })
        .eq("id", params.promo.id)
        .eq("used_count", current)
        .select("id")
        .maybeSingle();
      if (restored) break;
    }
  }

  const points = Math.max(0, Number(params.pointsUsed ?? 0));
  if (points > 0) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: user } = await s
        .from("bot_users")
        .select("loyalty_points")
        .eq("telegram_id", params.telegram_id)
        .maybeSingle();
      if (!user) break;
      const current = Number(user.loyalty_points ?? 0);
      const { data: restored } = await s
        .from("bot_users")
        .update({ loyalty_points: current + points })
        .eq("telegram_id", params.telegram_id)
        .eq("loyalty_points", current)
        .select("telegram_id")
        .maybeSingle();
      if (restored) break;
    }
  }

  if (params.giftCertificateId) {
    let query = s
      .from("gift_certificates")
      .update({
        status: "active",
        redeemed_by_telegram_id: null,
        redeemed_at: null,
        redeemed_order_id: null,
      })
      .eq("id", params.giftCertificateId)
      .eq("status", "redeemed")
      .eq("redeemed_by_telegram_id", params.telegram_id);
    query = params.orderId
      ? query.or(`redeemed_order_id.eq.${params.orderId},redeemed_order_id.is.null`)
      : query.is("redeemed_order_id", null);
    await query;
  }
}

async function placeOrder(chat_id: number, user: BotUser, country_code: string) {
  const locale: Locale = user.state?.locale ?? "ru";
  const m = copy[locale];
  const telegram_id = user.telegram_id;

  if (!(await claimOrderPlacement(telegram_id))) {
    // Второй тап той же кнопки (или другая гонка с оформлением) — не создаём
    // дубль заказа. Первый вызов доведёт дело до конца сам.
    console.warn(`[bot] checkout claim was not acquired for telegram_id=${telegram_id}`);
    await tg("sendMessage", {
      chat_id,
      text: "⏳ Оформление уже выполняется. Подождите несколько секунд и проверьте сообщения бота.",
    }).catch(() => {});
    return;
  }

  // Раньше исключение где угодно в этой функции ловилось общим catch в самом
  // handleUpdate и превращалось в полную тишину для покупателя — ни заказа,
  // ни сообщения об ошибке, только console.error, невидимый ему. Плюс
  // placing_order оставался бы выставлен навсегда (следующий тап «Оформить»
  // молча ничего не делал бы), если бы не try/catch именно здесь — он же
  // снимает claim перед тем, как что-то ответить покупателю.
  try {
    await placeOrderInner(chat_id, user, country_code, telegram_id, locale, m, undefined);
  } catch (e: unknown) {
    console.error(`[bot] placeOrder failed for telegram_id=${telegram_id}`, e);
    await releaseOrderPlacement(telegram_id, user.state);
    await tg("sendMessage", {
      chat_id,
      text: "⚠️ Не удалось оформить заказ. Попробуйте ещё раз через минуту — если не получится, напишите продавцу.",
    }).catch(() => {});
  }
}

/**
 * Блок 4 (ревизия кондитерской ветки) — сознательно отложенные находки,
 * не тронутые в этом заходе:
 *
 * 4.3 — order_items не содержит строки "Доставка", поэтому
 * sum(order_items) ≠ orders.total у заказов с доставкой (deliveryFee
 * прибавляется только к total ниже). Правка через синтетическую строку
 * order_items с product_id=null задевает всех потребителей order_items
 * (админку, "Мои заказы" обоих каналов, CSV-экспорт, аналитику) — шире,
 * чем оправдано для одного P1 в этом заходе; delivery_fee сама по себе
 * уже видна отдельным полем и в БД, и в админке (Блок 1, находка 7.5).
 *
 * 4.10 — нет отдельного текстового "отмена"/"назад" на шагах физического
 * чекаута. Выход через тап по кнопке главного меню уже работает на каждом
 * шаге (MENU_ACTIONS + canonicalMenuAction) — как и в Direct, где
 * matchDirectCommand тоже не знает слова "отмена", только переход в
 * другой раздел. Добавление парсера отмены на нескольких языках — заметная
 * по объёму работа на оба канала разом, не входит в этот заход.
 *
 * 4.12 — Direct не проверяет остаток вообще (addToCart/createOrderFromCart
 * не читают stock_quantity). Складской учёт в Direct с нуля — отдельная
 * задача уровня Блока D, не точечная правка.
 *
 * 4.15 — ни один канал не умеет уменьшать количество в корзине, только
 * удалять строку целиком. Новая UI-механика в обоих ботах, откладывается.
 *
 * 4.16 — промокоды/баллы/сертификаты не поддержаны в Direct-чекауте вовсе:
 * priceCart не знает о скидках. Того же масштаба, что и 4.12.
 *
 * 4.17 — Direct не спрашивает телефон; orders.contact — хендл Instagram.
 * Требует нового шага чекаута (state, i18n, валидация) в Direct — вне
 * объёма точечной правки.
 *
 * 4.19 — запрет смешанной корзины проверяется в коде (read-then-write), но
 * не на уровне БД. Настоящая защита — триггер на cart_items, а не CHECK
 * (правило завязано на JOIN с products.fulfillment_kind, обычный CHECK его
 * не выразит) — миграция потребует отдельного проектирования и проверки
 * на живых данных, не входит в этот заход.
 */
export type MiniAppPlaceOrderResult =
  | {
      ok: true;
      type: "robokassa";
      paymentUrl: string;
      amountLabel: string;
      orderId: number;
    }
  | { ok: true; type: "choose_payment"; amountLabel: string; orderId: number }
  | {
      ok: true;
      type: "manual_proof";
      amountLabel: string;
      instructions: string;
      qrImageUrl?: string;
      orderId: number;
    }
  | { ok: true; type: "completed"; message: string; orderId: number }
  | { ok: false; error: string };

async function miniAppAmountLabel(
  total: number,
  currency: string,
  locale: Locale = "ru",
  orderTotal = total,
): Promise<string> {
  const { miniAppStrings } = await import("./mini-app-i18n");
  const strings = miniAppStrings(locale);
  const formatted = formatMoney(total, currency);
  return total < orderTotal ? strings.depositNow(formatted) : strings.amountToPay(formatted);
}

async function miniAppRobokassaUrl(
  orderId: number,
  displayNo: number,
  total: number,
  currency: string,
  rk: Awaited<ReturnType<typeof loadRobokassaSettings>>,
): Promise<string | null> {
  if (!rk.ready) return null;
  const { buildRobokassaPaymentUrl } = await import("./robokassa.server");
  const outSum = Number(total).toFixed(2);
  return buildRobokassaPaymentUrl({
    login: rk.login,
    pass1: rk.pass1,
    outSum,
    invId: orderId,
    description: `Заказ #${displayNo}`,
    isTest: rk.testMode,
  });
}

async function placeOrderInner(
  chat_id: number,
  user: BotUser,
  country_code: string,
  telegram_id: number,
  locale: Locale,
  m: (typeof copy)["ru"],
  options?: { miniApp?: boolean; paymentMethod?: "robokassa" | "manual" },
): Promise<MiniAppPlaceOrderResult | void> {
  const miniApp = Boolean(options?.miniApp);
  const paymentMethod = options?.paymentMethod;
  const retryState = user.state ? { ...user.state } : user.state;
  // Разовый выбор языка ДО оформления (см. proceedToLanguageOrPlace) — снят
  // сразу же, чтобы не протух в состоянии и не повлиял на следующий заказ:
  // все сообщения ниже (startManualProofPath и т.д.) берут за основу именно
  // user.state.
  const deliveryLangChoice: DeliveryLangChoice | null = user.state?.checkout_lang_choice ?? null;
  if (user.state?.checkout_lang_choice !== undefined) {
    const { checkout_lang_choice: _checkout_lang_choice, ...rest } = user.state;
    user = { ...user, state: rest };
  }
  // Промокод — тот же приём: читаем один раз здесь и сразу снимаем из
  // состояния, чтобы код не липнул к следующему заказу, если этот сорвётся.
  // hasModule — на случай, если продавец выключил модуль между тем, как
  // покупатель ввёл код в корзине, и оформлением: старое значение в state
  // не должно тихо продолжать работать.
  const promoCodeInput = (await hasModule("coupons")) ? (user.state?.promo_code ?? null) : null;
  if (user.state?.promo_code !== undefined) {
    const { promo_code: _promo_code, ...rest } = user.state;
    user = { ...user, state: rest };
  }
  // Тот же приём для баллов: снимаем переключатель здесь же, чтобы он не
  // прилип к следующему заказу, если этот сорвётся.
  const usePointsInput = (await hasModule("loyalty")) && user.state?.use_points === true;
  if (user.state?.use_points !== undefined) {
    const { use_points: _use_points, ...rest } = user.state;
    user = { ...user, state: rest };
  }
  // И для подарочного сертификата — тот же приём.
  const giftCertificateInput = (await hasModule("gift_certificates"))
    ? (user.state?.gift_certificate_code ?? null)
    : null;
  if (user.state?.gift_certificate_code !== undefined) {
    const { gift_certificate_code: _gift_certificate_code, ...rest } = user.state;
    user = { ...user, state: rest };
  }
  // Данные получения физического заказа (Ниши, Блок 8) — тот же приём:
  // читаем и сразу снимаем, иначе адрес/дата прилипнут к следующему заказу.
  const fulfillmentType = user.state?.checkout_fulfillment_type ?? null;
  const fulfillmentAt = user.state?.checkout_fulfillment_at ?? null;
  const fulfillmentAddress =
    fulfillmentType === "delivery" ? (user.state?.checkout_fulfillment_address ?? null) : null;
  const fulfillmentNote = user.state?.checkout_fulfillment_note ?? null;
  // Зона доставки (Ниши, Блок B) — тот же приём, отдельно от адреса: заказ
  // может быть с доставкой без выбранной зоны, если у продавца зоны не
  // настроены вовсе (checkout_delivery_zone_id тогда просто не заводится).
  const deliveryZoneId =
    fulfillmentType === "delivery" ? (user.state?.checkout_delivery_zone_id ?? null) : null;
  const deliveryZoneName =
    fulfillmentType === "delivery" ? (user.state?.checkout_delivery_zone_name ?? null) : null;
  const deliveryFee = fulfillmentType === "delivery" ? (user.state?.checkout_delivery_fee ?? 0) : 0;
  if (
    user.state?.checkout_fulfillment_type !== undefined ||
    user.state?.checkout_fulfillment_at !== undefined ||
    user.state?.checkout_fulfillment_address !== undefined ||
    user.state?.checkout_fulfillment_note !== undefined ||
    user.state?.checkout_delivery_zone_id !== undefined ||
    user.state?.checkout_delivery_zone_name !== undefined ||
    user.state?.checkout_delivery_fee !== undefined
  ) {
    const {
      checkout_fulfillment_type: _cft,
      checkout_fulfillment_at: _cfa,
      checkout_fulfillment_address: _cfaddr,
      checkout_fulfillment_note: _cfn,
      checkout_delivery_zone_id: _cdzi,
      checkout_delivery_zone_name: _cdzn,
      checkout_delivery_fee: _cdf,
      ...rest
    } = user.state;
    user = { ...user, state: rest };
  }

  const s = await db();
  const { data: method } = await s
    .from("payment_methods")
    .select("*")
    .eq("country_code", country_code)
    .maybeSingle();

  if (!method) {
    const {
      country_code: _country_code,
      country_name: _country_name,
      checkout_delivery_zone_id: _zone_id,
      checkout_delivery_zone_name: _zone_name,
      checkout_delivery_fee: _zone_fee,
      ...stateWithoutCountry
    } = (retryState ?? {}) as NonNullable<BotUser["state"]>;
    await releaseOrderPlacement(telegram_id, stateWithoutCountry);
    if (miniApp) return { ok: false, error: "country_unavailable" };
    await tg("sendMessage", { chat_id, text: m.countryNoLongerAvailable });
    await askCountry(chat_id, telegram_id, true, locale);
    return;
  }

  const { data: items } = await s
    .from("cart_items")
    .select(
      "id, quantity, product_variant_id, products(id, name, price, currency, file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz, country_prices, fulfillment_kind, product_material_files(language, file_path, file_name, sort_order)), product_variants(id, name, price)",
    )
    .eq("telegram_id", telegram_id);
  if (!items?.length) {
    if (miniApp) {
      await releaseOrderPlacement(telegram_id, retryState);
      return { ok: false, error: "empty_cart" };
    }
    await tg("sendMessage", { chat_id, text: m.cartEmpty });
    await releaseOrderPlacement(telegram_id, retryState);
    return;
  }

  // Тип заказа — снимок с товаров в корзине, тем же приёмом, что и снимок
  // цены ниже: смена типа товара задним числом не должна задним числом
  // менять уже размещённые заказы. Смешанная корзина невозможна (см.
  // addToCart, Ниши Блок 5) — типа всей корзины достаточно взять с первого.
  const orderFulfillmentKind =
    items[0]?.products?.fulfillment_kind === "physical" ? "physical" : "digital";

  // Складской учёт (Кейс 4) — платный модуль. Списываем остаток здесь же,
  // до создания заказа: тот же принцип, что у промокода/сертификата ниже —
  // если позиции не хватило, не создаём заказ по неверному составу, а
  // откатываем уже списанные позиции этой же корзины и просим оформить
  // заново без раскупленного товара.
  // Вынесено за пределы if ниже (Блок 4, находка 4.13) — раньше
  // reservedStock жил только внутри блока decrementStock, и все более
  // поздние ранние return (невалидный промокод, гонка сертификата, сбой
  // вставки заказа/позиций) выходили из функции, не возвращая уже
  // списанный остаток обратно. Пустой массив, если модуль stock выключен —
  // восстанавливать нечего, вызов restoreStock по пустому списку безвреден.
  const reservedStock: Array<{ productId: string; qty: number }> = [];
  if (await hasModule("stock")) {
    for (const it of items) {
      if (!it.products) continue;
      const productId = String(it.products.id);
      const qty = Number(it.quantity);
      const ok = await decrementStock(productId, qty);
      if (!ok) {
        for (const r of reservedStock) await restoreStock(r.productId, r.qty);
        // Убираем раскупленную строку из корзины (Блок 8, находка 8.5) —
        // раньше сообщение говорило "оформите без него", но саму строку не
        // трогало: повторное «Оформить» било в тот же decrementStock и
        // падало точно так же, пока покупатель не находил и не удалял её
        // вручную кнопкой в корзине.
        await s.from("cart_items").delete().eq("id", it.id);
        await releaseOrderPlacement(telegram_id, retryState);
        if (miniApp) return { ok: false, error: "out_of_stock" };
        await tg("sendMessage", { chat_id, text: m.outOfStockAtCheckout });
        return;
      }
      reservedStock.push({ productId, qty });
    }
  }

  /**
   * Считаем общим расчётом — тем же, что показывал цены в каталоге и в корзине.
   *
   * Раньше здесь была третья копия тех же правил, и заказ мог разойтись с той
   * ценой, которую покупатель видел. Заодно цена за штуку считается один раз и
   * попадает и в итог, и в снимок позиции ниже.
   */
  const { resolvePrice } = await import("./pricing.server");
  // Ключ — id строки корзины, а не товара: у одного товара может быть
  // несколько строк одновременно, по одной на выбранный вариант (Ниши,
  // Блок D) — ключ по product_id склеил бы их цены в одну.
  const priced = new Map<string, number>();
  let total = 0;
  let currency = method?.currency || "KZT";
  for (const it of items) {
    if (!it.products) continue;
    const money = await resolvePrice(it.products, country_code, it.product_variants);
    // "Все языки" — цена за позицию ×N, где N — сколько языков реально есть
    // у ЭТОГО товара (product-materials.ts deliveryPriceMultiplier).
    const multiplier = deliveryPriceMultiplier(
      deliveryLangChoice,
      availableMaterialLanguages(it.products).length,
    );
    const amount = money.amount * multiplier;
    currency = money.currency;
    priced.set(it.id, amount);
    total += amount * Number(it.quantity);
  }
  // Комиссия зоны доставки (Ниши, Блок B) — до промокода/баллов/сертификата,
  // чтобы скидка действовала и на доставку (то же умолчание, что описано в
  // плане: не выделяем доставку в отдельную неуценяемую строку).
  total += deliveryFee;

  // Промокод — на всю сумму заказа, списывается атомарно прямо здесь (не
  // раньше): если оформление сорвётся ниже, использование не сгорит зря,
  // ведь до этой строки мы его ещё не трогали.
  let promoCode: string | null = null;
  let discountAmount = 0;
  let promoRedemption: { id: string; previousUsedCount: number } | null = null;
  if (promoCodeInput) {
    const redeemed = await redeemPromoCode(promoCodeInput, total);
    if (redeemed.ok) {
      promoCode = normalizePromoCode(promoCodeInput);
      discountAmount = redeemed.discount;
      promoRedemption = {
        id: redeemed.promoId,
        previousUsedCount: redeemed.previousUsedCount,
      };
      total -= discountAmount;
    } else {
      // Код стал недоступен между вводом в корзине и оформлением (истёк,
      // исчерпан, гонка с другим покупателем) — не создаём заказ по неверной
      // цене, просим повторить без него.
      for (const r of reservedStock) await restoreStock(r.productId, r.qty);
      await releaseOrderPlacement(telegram_id, retryState);
      if (miniApp) return { ok: false, error: "promo_invalid" };
      await tg("sendMessage", { chat_id, text: m.promoCodeInvalid });
      return;
    }
  }

  // Баллы — поверх промокода, на остаток суммы. В отличие от промокода гонка
  // тут не блокирует заказ (см. redeemPointsForOrder): просто спишется 0.
  let pointsUsed = 0;
  if (usePointsInput) {
    const { redeemPointsForOrder } = await import("./loyalty.server");
    const redeemed = await redeemPointsForOrder(telegram_id, total);
    pointsUsed = redeemed.discount;
    total -= pointsUsed;
  }

  // Сертификат — поверх промокода и баллов, на остаток суммы. Как и
  // промокод, гонка с другим покупателем блокирует заказ: цена уже не та,
  // что видел покупатель, а сертификат — реальные деньги продавца.
  let giftCertificateCode: string | null = null;
  let giftCertificateDiscountAmount = 0;
  let giftCertificateId: string | null = null;
  if (giftCertificateInput) {
    const redeemed = await redeemGiftCertificate(giftCertificateInput, total, telegram_id);
    if (redeemed.ok) {
      giftCertificateCode = normalizeGiftCertificateCode(giftCertificateInput);
      giftCertificateDiscountAmount = redeemed.discount;
      giftCertificateId = redeemed.certificateId;
      total -= giftCertificateDiscountAmount;
    } else {
      for (const r of reservedStock) await restoreStock(r.productId, r.qty);
      await rollbackCheckoutRedemptions({
        telegram_id,
        promo: promoRedemption,
        pointsUsed,
      });
      await releaseOrderPlacement(telegram_id, retryState);
      if (miniApp) return { ok: false, error: "gift_invalid" };
      await tg("sendMessage", { chat_id, text: m.giftCertificateInvalid });
      return;
    }
  }

  const display =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() ||
    (user?.username ? `@${user.username}` : `id${telegram_id}`);

  const { data: order, error } = await s
    .from("orders")
    .insert({
      telegram_id,
      username: user?.username ?? null,
      display_name: display,
      contact: user?.contact_phone ?? null,
      country_code: method?.country_code ?? country_code,
      country_name: method?.country_name ?? country_code,
      total,
      currency,
      status: "awaiting_payment",
      delivery_lang_choice: deliveryLangChoice,
      promo_code: promoCode,
      discount_amount: discountAmount,
      points_used: pointsUsed,
      gift_certificate_code: giftCertificateCode,
      gift_certificate_discount: giftCertificateDiscountAmount,
      fulfillment_kind: orderFulfillmentKind,
      fulfillment_type: fulfillmentType,
      fulfillment_at: fulfillmentAt,
      fulfillment_address: fulfillmentAddress,
      fulfillment_note: fulfillmentNote,
      delivery_zone_id: deliveryZoneId,
      delivery_zone_name: deliveryZoneName,
      delivery_fee: deliveryFee,
    })
    .select("*")
    .single();
  if (error || !order) {
    for (const r of reservedStock) await restoreStock(r.productId, r.qty);
    await rollbackCheckoutRedemptions({
      telegram_id,
      promo: promoRedemption,
      pointsUsed,
      giftCertificateId,
    });
    if (miniApp) {
      await releaseOrderPlacement(telegram_id, retryState);
      return { ok: false, error: "order_failed" };
    }
    await tg("sendMessage", { chat_id, text: m.orderCreateFailed });
    await releaseOrderPlacement(telegram_id, retryState);
    return;
  }
  if (giftCertificateId) {
    // Best-effort: если этот запрос не выполнится, сертификат всё равно уже
    // списан (status=redeemed) — теряется только обратная ссылка на заказ,
    // не сама скидка и не деньги продавца.
    const { error: linkError } = await s
      .from("gift_certificates")
      .update({ redeemed_order_id: order.id })
      .eq("id", giftCertificateId);
    if (linkError) console.error("[bot] gift certificate redeemed_order_id link failed", linkError);
  }
  if (miniApp) {
    const { logger } = await import("./logger.server");
    logger.info("mini_app.order_created", {
      telegram_id,
      order_id: order.id,
      country_code: method?.country_code ?? country_code,
      fulfillment_kind: orderFulfillmentKind,
      total,
      currency,
      source: "mini_app",
    });
  }

  /**
   * Строки без товара отсеиваем так же, как их отсеивает расчёт цены выше
   * (`if (!it.products) continue`).
   *
   * Позиция корзины может остаться без товара — товар удалили, пока корзина
   * лежала. Без этого фильтра в снимок уходило `name_snapshot: undefined`
   * против NOT NULL, и падала вся пачка целиком: заказ уже создан, а позиций
   * в нём ноль.
   */
  const withProduct = items.filter((it) => it.products);

  if (withProduct.length === 0) {
    // Платить не за что: заказ без позиций выдать нельзя, а покупателю нужен
    // понятный ответ, а не «оплатите 0 ₸».
    for (const r of reservedStock) await restoreStock(r.productId, r.qty);
    await s.from("orders").delete().eq("id", order.id);
    await rollbackCheckoutRedemptions({
      telegram_id,
      promo: promoRedemption,
      pointsUsed,
      giftCertificateId,
      orderId: order.id as number,
    });
    await s.from("cart_items").delete().eq("telegram_id", telegram_id);
    if (miniApp) {
      await releaseOrderPlacement(telegram_id, retryState);
      return { ok: false, error: "empty_cart" };
    }
    await tg("sendMessage", { chat_id, text: m.cartEmpty });
    await releaseOrderPlacement(telegram_id, retryState);
    return;
  }

  const rows = await Promise.all(
    withProduct.map(async (it) => {
      // Ту же цену, что вошла в итог заказа: считать её второй раз незачем, а
      // разойтись они не должны.
      const displayPrice = priced.get(it.id) ?? Number(it.products?.price ?? 0);

      // Снимаем ВСЕ языки, какие у товара реально заведены (было только
      // ru/kk) — иначе купленный материал на en/uz долетит до выдачи пустым.
      const byLang: Record<string, ReturnType<typeof materialsForProduct>> = {};
      for (const lang of availableMaterialLanguages(it.products)) {
        byLang[lang] = materialsForProduct(it.products, lang);
      }

      // Вариант (Ниши, Блок D) — имя склеивается в снимок позиции, например
      // «Торт — 1 кг»: order_items не хранит отдельного поля под имя
      // варианта, а name_snapshot уже и так снимок на момент покупки.
      const variantName = it.product_variants?.name;
      const nameSnapshot = variantName
        ? `${it.products?.name} — ${variantName}`
        : it.products?.name;

      return {
        order_id: order.id,
        product_id: it.products?.id,
        product_variant_id: it.product_variant_id,
        name_snapshot: nameSnapshot,
        price_snapshot: displayPrice,
        quantity: it.quantity,
        // Legacy single-file columns kept for older order rows/tooling; the
        // JSONB below is what delivery actually reads from now on.
        file_path_snapshot: it.products?.file_path ?? null,
        file_name_snapshot: it.products?.file_name ?? null,
        file_path_kz_snapshot: it.products?.file_path_kz ?? null,
        file_name_kz_snapshot: it.products?.file_name_kz ?? null,
        file_url_snapshot: it.products?.file_url ?? null,
        file_url_kz_snapshot: it.products?.file_url_kz ?? null,
        // Тоже кладём ru/kk сюда для инструментов, которые ещё читают эти две
        // старые колонки напрямую — но источником истины для выдачи теперь
        // служит material_files_by_lang ниже.
        material_files_snapshot: byLang.ru ?? [],
        material_files_kz_snapshot: byLang.kk ?? [],
        material_files_by_lang: byLang,
      };
    }),
  );
  /**
   * Позиции — обязательная часть заказа, а не побочная запись.
   *
   * Раньше результат вставки не проверялся, и следующей же строкой чистилась
   * корзина. При сбое покупатель получал заказ с суммой и реквизитами, платил,
   * а выдавать было нечего: `claimOrderForDelivery` читает `order_items(*)` и
   * находил пусто. Заодно исчезал и единственный след того, что человек
   * покупал, — корзина уже стёрта.
   *
   * Откатываем заказ так же, как это делает близнец в Direct
   * (direct-purchase.server.ts createOrderFromCart), и корзину НЕ трогаем:
   * пусть покупатель повторит оформление, не набирая всё заново.
   */
  const { error: itemsError } = await s.from("order_items").insert(rows);
  if (itemsError) {
    console.error(`[bot] order_items insert failed for order ${order.id}`, itemsError);
    for (const r of reservedStock) await restoreStock(r.productId, r.qty);
    await s.from("orders").delete().eq("id", order.id);
    await rollbackCheckoutRedemptions({
      telegram_id,
      promo: promoRedemption,
      pointsUsed,
      giftCertificateId,
      orderId: order.id as number,
    });
    if (miniApp) {
      await releaseOrderPlacement(telegram_id, retryState);
      return { ok: false, error: "order_failed" };
    }
    await tg("sendMessage", { chat_id, text: m.orderCreateFailed });
    await releaseOrderPlacement(telegram_id, retryState);
    return;
  }

  await s.from("cart_items").delete().eq("telegram_id", telegram_id);

  // Скидки (промокод+баллы+сертификат) могут в сумме покрыть всю стоимость
  // корзины — платить тогда нечего, и просить чек оплаты 0 ₸ (или вести на
  // Robokassa с нулевой суммой) для покупателя, который просто накопил
  // баллы или получил сертификат на полную стоимость, было бы тупиком. Тот
  // же путь, что и у подтверждённого Robokassa-платежа (result.ts) — сразу
  // выдаём, не спрашивая чек.
  if (total <= 0) {
    try {
      if (orderFulfillmentKind === "physical") {
        const { acceptOrder } = await import("./fulfillment.server");
        await acceptOrder(order.id as number);
      } else {
        const { deliverOrder } = await import("./orders.server");
        await deliverOrder(order.id as number);
      }
    } catch (e) {
      console.error(`[bot] auto-fulfillment failed for zero-total order ${order.id}`, e);
    }
    // Продавец должен знать о продаже, даже когда делать ничего не нужно
    // (Блок 6, находка 6.3) — раньше этот путь заканчивался тихим return,
    // и заказ с нулевой суммой (скидка/баллы/сертификат покрыли всё)
    // доходил до покупателя, но не до продавца вовсе.
    await notifyAdminNewOrder(order.id as number, null, null, { noPaymentNeeded: true }).catch(
      (e) => console.error(`[bot] notifyAdminNewOrder failed for zero-total order ${order.id}`, e),
    );
    await releaseOrderPlacement(telegram_id, user.state);
    if (miniApp) {
      const { miniAppStrings } = await import("./mini-app-i18n");
      return {
        ok: true,
        type: "completed",
        message: miniAppStrings(locale).orderComplete,
        orderId: order.id as number,
      };
    }
    return;
  }

  // Оплата при получении (Ниши, Блок 7) — только для физических заказов:
  // цифровой без оплаты выдавать нечего, а физический продавец примет и
  // изготовит без предоплаты, если сам так настроил.
  const { amountDueNow, loadPaymentMode, acceptOrder } = await import("./fulfillment.server");
  if (orderFulfillmentKind === "physical" && (await loadPaymentMode()) === "on_receipt") {
    try {
      await acceptOrder(order.id as number);
    } catch (e) {
      console.error(`[bot] acceptOrder failed for on_receipt order ${order.id}`, e);
    }
    await notifyAdminNewOrder(order.id as number, null, null, { noPaymentNeeded: true }).catch(
      (e) => console.error(`[bot] notifyAdminNewOrder failed for on_receipt order ${order.id}`, e),
    );
    await releaseOrderPlacement(telegram_id, user.state);
    if (miniApp) {
      const { miniAppStrings } = await import("./mini-app-i18n");
      return {
        ok: true,
        type: "completed",
        message: miniAppStrings(locale).orderOnReceipt,
        orderId: order.id as number,
      };
    }
    return;
  }
  const amountDue = await amountDueNow({ total, fulfillment_kind: orderFulfillmentKind });
  const orderId = order.id as number;
  const displayNo = order.display_no ?? order.order_no ?? orderId;
  const rk = await loadRobokassaSettings();
  const cc = String(method?.country_code ?? country_code ?? "").toUpperCase();
  const instructions = (method?.instructions as string) || m.defaultInstructions;
  const amountLabel = await miniAppAmountLabel(amountDue, currency, locale, total);
  const { imageUrl } = await import("./public-image");

  const miniAppManual = (autoDeliver: boolean): MiniAppPlaceOrderResult => ({
    ok: true,
    type: "manual_proof",
    amountLabel,
    instructions,
    qrImageUrl: method?.qr_code_path ? imageUrl(method.qr_code_path as string) : undefined,
    orderId,
  });

  if (miniApp) {
    const autoDeliverManual = !rk.ready
      ? false
      : isProofAutoOnlyCountry(cc) || paymentMethod === "manual";
    if (!rk.ready || paymentMethod === "manual") {
      if (autoDeliverManual) {
        await s.from("orders").update({ admin_note: "proof_auto" }).eq("id", orderId);
      }
      await setState(telegram_id, {
        ...user.state,
        mode: "awaiting_proof",
        pending_order_id: orderId,
        pending_display_no: displayNo,
        proof_auto: autoDeliverManual,
      });
      return miniAppManual(autoDeliverManual);
    }
    if (isProofAutoOnlyCountry(cc)) {
      await s.from("orders").update({ admin_note: "proof_auto" }).eq("id", orderId);
      await setState(telegram_id, {
        ...user.state,
        mode: "awaiting_proof",
        pending_order_id: orderId,
        pending_display_no: displayNo,
        proof_auto: true,
      });
      return miniAppManual(true);
    }
    if (cc === "KZ" && !paymentMethod) {
      await setState(telegram_id, {
        ...user.state,
        mode: "choose_pay",
        pending_order_id: orderId,
        pending_display_no: displayNo,
        proof_auto: false,
      });
      return { ok: true, type: "choose_payment", amountLabel, orderId };
    }
    const paymentUrl = await miniAppRobokassaUrl(orderId, displayNo, amountDue, currency, rk);
    if (!paymentUrl) {
      await setState(telegram_id, {
        ...user.state,
        mode: "awaiting_proof",
        pending_order_id: orderId,
        pending_display_no: displayNo,
        proof_auto: false,
      });
      return miniAppManual(false);
    }
    await setState(telegram_id, {
      ...user.state,
      mode: "awaiting_payment",
      pending_order_id: orderId,
      pending_display_no: displayNo,
      proof_auto: false,
    });
    return { ok: true, type: "robokassa", paymentUrl, amountLabel, orderId };
  }

  // Robokassa off (or misconfigured) → all countries: receipt + manual admin confirm
  if (!rk.ready) {
    await startManualProofPath({
      chat_id,
      telegram_id,
      userState: user.state,
      orderId: order.id as number,
      displayNo: order.display_no ?? order.order_no ?? order.id,
      total: amountDue,
      currency,
      instructions,
      autoDeliver: false,
      locale,
      qrCodePath: method?.qr_code_path,
      isPhysical: orderFulfillmentKind === "physical",
    });
    return;
  }

  // Robokassa on + RU/BY/OTHER → receipt with auto-delivery (no Robokassa)
  if (isProofAutoOnlyCountry(cc)) {
    await startManualProofPath({
      chat_id,
      telegram_id,
      userState: user.state,
      orderId: order.id as number,
      displayNo: order.display_no ?? order.order_no ?? order.id,
      total: amountDue,
      currency,
      instructions,
      autoDeliver: true,
      locale,
      qrCodePath: method?.qr_code_path,
      isPhysical: orderFulfillmentKind === "physical",
    });
    return;
  }

  // Robokassa on + KZ → choose Robokassa or receipt (auto-delivery)
  if (cc === "KZ") {
    await sendKzPaymentChoice({
      chat_id,
      telegram_id,
      userState: user.state,
      orderId: order.id as number,
      displayNo: order.display_no ?? order.order_no ?? order.id,
      total: amountDue,
      currency,
      locale,
    });
    return;
  }

  // Robokassa on + other countries → Robokassa only
  await sendRobokassaPayLink({
    chat_id,
    telegram_id,
    userState: user.state,
    orderId: order.id as number,
    displayNo: order.display_no ?? order.order_no ?? order.id,
    total: amountDue,
    currency,
    rk,
    locale,
  });
}

/** Re-send payment instructions for a stuck awaiting_payment order (admin nudge). */
export async function remindOrderPayment(orderId: number) {
  const s = await db();
  const { data: order, error } = await s
    .from("orders")
    .select(
      "id, order_no, display_no, telegram_id, status, total, currency, country_code, country_name, fulfillment_kind",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) throw new Error("Заказ не найден");
  if (order.status !== "awaiting_payment") {
    throw new Error(`Напомнить можно только заказам «Ждёт оплаты» (сейчас: ${order.status})`);
  }
  const isPhysical = order.fulfillment_kind === "physical";

  const telegram_id = Number(order.telegram_id);
  const chat_id = telegram_id;
  const { data: botUser } = await s
    .from("bot_users")
    .select("*")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  const userState = (botUser?.state as BotUser["state"]) ?? {};
  const locale: Locale = userState?.locale ?? "ru";
  const m = copy[locale];

  const cc = String(order.country_code ?? "").toUpperCase();
  const { data: method } = await s
    .from("payment_methods")
    .select("*")
    .eq("country_code", cc || "OTHER")
    .maybeSingle();
  const instructions = (method?.instructions as string) || m.defaultInstructions;
  const total = Number(order.total);
  const currency = (order.currency as string) || (method?.currency as string) || "USD";
  const displayNo = order.display_no ?? order.order_no ?? orderId;
  const { amountDueNow } = await import("./fulfillment.server");
  const amountDue = await amountDueNow({ total, fulfillment_kind: order.fulfillment_kind });

  await tg("sendMessage", {
    chat_id,
    text: m.paymentReminder(displayNo, formatMoney(amountDue, currency)),
    parse_mode: "HTML",
    reply_markup: await mainMenu(locale),
  });

  const rk = await loadRobokassaSettings();

  if (!rk.ready) {
    await startManualProofPath({
      chat_id,
      telegram_id,
      userState,
      orderId,
      displayNo,
      total: amountDue,
      currency,
      instructions,
      autoDeliver: false,
      reminder: true,
      locale,
      qrCodePath: method?.qr_code_path,
      isPhysical,
    });
    return { ok: true as const };
  }

  if (isProofAutoOnlyCountry(cc)) {
    await startManualProofPath({
      chat_id,
      telegram_id,
      userState,
      orderId,
      displayNo,
      total: amountDue,
      currency,
      instructions,
      autoDeliver: true,
      reminder: true,
      locale,
      qrCodePath: method?.qr_code_path,
      isPhysical,
    });
    return { ok: true as const };
  }

  if (cc === "KZ") {
    await sendKzPaymentChoice({
      chat_id,
      telegram_id,
      userState,
      orderId,
      displayNo,
      total: amountDue,
      currency,
      reminder: true,
      locale,
    });
    return { ok: true as const };
  }

  await sendRobokassaPayLink({
    chat_id,
    telegram_id,
    displayNo,
    userState,
    orderId,
    total: amountDue,
    currency,
    rk,
    reminder: true,
    locale,
  });
  return { ok: true as const };
}

async function sendKzPaymentChoice(params: {
  chat_id: number;
  telegram_id: number;
  userState: BotUser["state"];
  orderId: number;
  displayNo: number;
  total: number;
  currency: string;
  reminder?: boolean;
  locale?: Locale;
}) {
  const m = copy[params.locale ?? "ru"];
  await setState(params.telegram_id, {
    ...params.userState,
    mode: "choose_pay",
    pending_order_id: params.orderId,
    pending_display_no: params.displayNo,
    proof_auto: false,
  });
  const title = params.reminder
    ? m.kzTitleReminder(params.displayNo)
    : m.kzTitleNew(params.displayNo);
  await tg("sendMessage", {
    chat_id: params.chat_id,
    text:
      `${title}\n\n` +
      `${m.amountToPay(formatMoney(params.total, params.currency))}\n\n` +
      `${m.choosePayMethod}\n` +
      `${m.robokassaDesc}\n` +
      `${m.manualDesc}`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: m.payViaRobokassaBtn, callback_data: `pay:rk:${params.orderId}` }],
        [{ text: m.payManualBtn, callback_data: `pay:manual:${params.orderId}` }],
      ],
    },
  });
}

/**
 * Кнопки «Подтвердить и выдать» / «Отклонить» может нажимать только продавец.
 *
 * До этой проверки её не было вовсе, хотя комментарий над ветками гласил
 * «Admin actions»: `callback_data` приходит от клиента, Telegram не сверяет
 * его с реально отправленной кнопкой, а внутренний id заказа покупатель
 * получает на руки в кнопке оплаты (`pay:rk:<id>`). То есть любой покупатель
 * мог прислать `confirm:<своего заказа>` и получить оплаченные материалы, не
 * заплатив, — `claimOrderForDelivery` выдаёт и заказы в статусе
 * `awaiting_payment`. А перебором id — отменить чужие заказы через `reject:`.
 *
 * Отдельно закрывает и сценарий без всякого эксплойта: если продавец вписал
 * в список получателей уведомлений id группы, кнопки приходят в группу, и
 * нажать их мог любой её участник.
 *
 * Слепок с `requireVipAdmin` (vip-bot.server.ts) — там та же операция была
 * закрыта с самого начала, разошлись только эти две ветки.
 */
async function requireShopAdmin(from_id: number, chat_id: number): Promise<boolean> {
  const s = await db();
  const { data } = await s.from("app_settings").select("key, value");
  const settings: Record<string, string> = {};
  for (const row of data ?? []) settings[row.key as string] = (row.value as string) ?? "";

  const adminIds = parseNotifyAdminIds(settings);
  if (adminIds.length === 0) {
    // Пустой список — не повод пускать всех: без известного администратора
    // подтверждать заказ из Telegram нельзя (в панели кнопка остаётся).
    console.error("[bot] confirm/reject: не настроен admin_chat_id — действие отклонено");
    await tg("sendMessage", {
      chat_id,
      text: "Ошибка: не настроен admin_chat_id. Подтверждение заказов из Telegram отключено — воспользуйтесь панелью.",
    });
    return false;
  }

  if (!isTelegramAdmin(from_id, adminIds)) {
    console.warn(`[bot] confirm/reject отклонён: ${from_id} не администратор`);
    await tg("sendMessage", {
      chat_id,
      text: "⛔ Только продавец может подтверждать и отклонять заказы.",
    });
    return false;
  }
  return true;
}

async function loadRobokassaSettings() {
  const s = await db();
  const { data: allSettings } = await s.from("app_settings").select("key, value");
  const getSetting = (key: string) => allSettings?.find((r) => r.key === key)?.value;
  // Setting alone used to be the whole story — a client who cancelled the
  // paid Robokassa module kept card payments working as long as the toggle
  // itself was still on, since only the admin UI route checked the module.
  const enabled = getSetting("robokassa_enabled") === "true" && (await hasModule("robokassa"));
  const testMode = getSetting("robokassa_test_mode") === "true";
  const login = getSetting("robokassa_login")?.trim() || "";
  const pass1 =
    (testMode ? getSetting("robokassa_pass1_test") : getSetting("robokassa_pass1"))?.trim() || "";
  return { enabled, testMode, login, pass1, ready: enabled && Boolean(login && pass1) };
}

async function sendRobokassaPayLink(params: {
  chat_id: number;
  telegram_id: number;
  userState: BotUser["state"];
  orderId: number;
  displayNo: number;
  total: number;
  currency: string;
  rk: Awaited<ReturnType<typeof loadRobokassaSettings>>;
  reminder?: boolean;
  locale?: Locale;
}) {
  const m = copy[params.locale ?? "ru"];
  const { buildRobokassaPaymentUrl } = await import("./robokassa.server");
  const outSum = Number(params.total).toFixed(2);
  const paymentUrl = buildRobokassaPaymentUrl({
    login: params.rk.login,
    pass1: params.rk.pass1,
    outSum,
    invId: params.orderId,
    description: `Заказ #${params.displayNo}`,
    isTest: params.rk.testMode,
  });

  await setState(params.telegram_id, {
    ...params.userState,
    mode: "awaiting_payment",
    pending_order_id: params.orderId,
    pending_display_no: params.displayNo,
    proof_auto: false,
  });
  const title = params.reminder
    ? m.rkTitleReminder(params.displayNo)
    : m.rkTitleNew(params.displayNo);
  await tg("sendMessage", {
    chat_id: params.chat_id,
    text:
      `${title}\n\n` +
      `${m.amountToPay(formatMoney(params.total, params.currency))}\n\n` +
      m.robokassaHint,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: m.payViaRobokassaBtn, url: paymentUrl }]],
    },
  });
}

async function startManualProofPath(params: {
  chat_id: number;
  telegram_id: number;
  userState: BotUser["state"];
  orderId: number;
  displayNo: number;
  total: number;
  currency: string;
  instructions: string;
  autoDeliver: boolean;
  reminder?: boolean;
  locale?: Locale;
  /** payment_methods.qr_code_path для страны заказа — если задан, шлём QR картинкой перед текстом. */
  qrCodePath?: string | null;
  /** Ниши, Блок 110-фикс: чтобы не обещать «пришлёт файлы» покупателю торта. */
  isPhysical?: boolean;
}) {
  const m = copy[params.locale ?? "ru"];
  const s = await db();
  if (params.autoDeliver) {
    await s.from("orders").update({ admin_note: "proof_auto" }).eq("id", params.orderId);
  }

  await setState(params.telegram_id, {
    ...params.userState,
    mode: "awaiting_proof",
    pending_order_id: params.orderId,
    pending_display_no: params.displayNo,
    proof_auto: params.autoDeliver,
  });

  const isPhysical = Boolean(params.isPhysical);
  const afterProof = params.autoDeliver
    ? m.afterProofAuto(isPhysical)
    : m.afterProofManual(isPhysical);

  const title = params.reminder
    ? m.manualTitleReminder(params.displayNo)
    : m.manualTitleNew(params.displayNo);

  const text =
    `${title}\n\n` +
    `${m.amountToPay(formatMoney(params.total, params.currency))}\n\n` +
    `${params.instructions}\n\n` +
    afterProof;

  // QR раньше вообще нигде не читался в коде бота (только сохранялся из
  // админки), поэтому клиенты с оплатой по QR получали одну голую надпись
  // «Оплатите через Kaspi Qr» без самого QR.
  //
  // Предпочтительно — одним сообщением, картинка с текстом в подписи: так
  // они физически не могут разъехаться на экране покупателя. Подпись у
  // Telegram ограничена 1024 символами (у обычного текста — 4096), а
  // instructions — свободный текст, который продавец мог написать длинным;
  // если не влезает, шлём фото отдельным сообщением ПОСЛЕ текста — не до,
  // чтобы не оставлять пустых отступов в тексте на месте, где раньше стояло
  // изображение.
  if (params.qrCodePath && text.length <= 1024) {
    const res = await tg("sendPhoto", {
      chat_id: params.chat_id,
      photo: imageUrl(params.qrCodePath),
      caption: text,
      parse_mode: "HTML",
    });
    // Фото не ушло (например, файл недоступен) — покупатель не должен
    // остаться совсем без ответа, шлём хотя бы текст.
    if (res.ok) return;
  }

  await tg("sendMessage", { chat_id: params.chat_id, text, parse_mode: "HTML" });

  if (params.qrCodePath) {
    await tg("sendPhoto", {
      chat_id: params.chat_id,
      photo: imageUrl(params.qrCodePath),
    }).catch((e) => console.error("[bot] failed to send QR code photo", params.orderId, e));
  }
}

export async function notifyAdminNewOrder(
  orderId: number,
  proofFileId: string | null,
  proofKind: "photo" | "document" | null,
  options?: {
    autoDelivered?: boolean;
    reviewReason?: string;
    /**
     * Заказ уже принят/выдан без чека — задаток=0 после скидок или
     * payment_mode=on_receipt (Блок 6, находка 6.3). Не то же самое, что
     * autoDelivered: там речь о распознанном OCR чеке, здесь чека вообще
     * не было и не будет. Кнопок принять/отклонить не показываем — решение
     * уже принято автоматически.
     */
    noPaymentNeeded?: boolean;
  },
) {
  const s = await db();
  const { data: setting } = await s
    .from("app_settings")
    .select("value")
    .eq("key", "admin_chat_id")
    .maybeSingle();
  const adminChatIdStr = setting?.value;
  if (!adminChatIdStr) {
    console.warn("[bot] admin_chat_id not configured");
    return;
  }
  const adminIds = adminChatIdStr
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
  if (adminIds.length === 0) return;

  const { data: order } = await s
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", orderId)
    .single();
  if (!order) return;
  // Покупателю и админу показывается сквозной номер этого бота, а не глобальный
  // id (id остаётся во внутренних ссылках, callback_data и InvId Robokassa).
  // display_no, не order_no (Блок 6, находка 6.12) — order_no двигает
  // ночная перенумерация, покупатель мог увидеть уже другое число; везде
  // остальное в проекте берёт display_no ?? order_no ?? id.
  const displayNo = order.display_no ?? order.order_no ?? order.id;
  const items = order.order_items || [];

  // --- Задача 4: обложки товаров отдельным сообщением (чтобы админ сразу видел, что продаётся) ---
  const productIds = items.map((i) => i.product_id).filter(Boolean) as string[];
  const coverUrls: string[] = [];
  if (productIds.length > 0) {
    const { data: imgs } = await s
      .from("product_images")
      .select("product_id, image_path, sort_order")
      .in("product_id", productIds)
      .order("sort_order");
    // Берём первую (по sort_order) обложку для каждого товара, без дублей по product_id
    const seen = new Set<string>();
    for (const im of imgs ?? []) {
      const pid = im.product_id as string;
      if (seen.has(pid)) continue;
      seen.add(pid);
      coverUrls.push(imageUrl(im.image_path as string));
    }
  }

  const autoDelivered = Boolean(options?.autoDelivered);
  const reviewReason = options?.reviewReason?.trim();
  const noPaymentNeeded = Boolean(options?.noPaymentNeeded);
  // Дата/адрес/надпись на торте — Блок 6, находка 6.1: раньше это сообщение
  // печатало только имя/телефон/страну/сумму, хотя order уже выбран через
  // select("*, order_items(*)") и все физические поля под рукой. Именно из
  // этого сообщения продавец жмёт «✅ Принять заказ» — без даты и адреса
  // решение принималось вслепую.
  let fulfillmentLine = "";
  if (order.fulfillment_kind === "physical") {
    const { isoDateToDisplay } = await import("./fulfillment.server");
    const typeLabel = order.fulfillment_type === "delivery" ? "🚚 Доставка" : "🏠 Самовывоз";
    const dateLabel = order.fulfillment_at
      ? isoDateToDisplay(String(order.fulfillment_at).slice(0, 10))
      : "—";
    const addressLine =
      order.fulfillment_type === "delivery"
        ? `\n📍 ${escapeHtml((order.fulfillment_address as string) || "—")}${order.delivery_zone_name ? ` (${escapeHtml(order.delivery_zone_name as string)})` : ""}`
        : "";
    const noteLine = order.fulfillment_note
      ? `\n✏️ ${escapeHtml(order.fulfillment_note as string)}`
      : "";
    fulfillmentLine = `\n${typeLabel} — ${dateLabel}${addressLine}${noteLine}\n`;
  }
  const summaryText =
    (autoDelivered
      ? `🆕 <b>Заказ #${displayNo}</b> — автовыдача по чеку\n\n`
      : noPaymentNeeded
        ? `🆕 <b>Заказ #${displayNo}</b> — принят без предоплаты\n\n`
        : reviewReason
          ? `🆕 <b>Заказ #${displayNo}</b> — нужна проверка чека\n\n`
          : `🆕 <b>Новый заказ #${displayNo}</b>\n\n`) +
    `👤 ${escapeHtml(order.display_name as string)}${order.username ? ` (@${escapeHtml(order.username)})` : ""}
📞 ${escapeHtml((order.contact as string) || "—")}
🌍 ${escapeHtml((order.country_name as string) || "—")}
📦 Позиций: ${items.length}
${fulfillmentLine}
💰 <b>Итого: ${order.total} ${order.currency}</b>` +
    (autoDelivered
      ? `\n\n⚡ Файлы выданы автоматически после проверки чека (OCR).`
      : noPaymentNeeded
        ? order.fulfillment_kind === "physical"
          ? `\n\n✅ Заказ принят в работу без предоплаты (оплата при получении, либо скидка покрыла всю сумму).`
          : `\n\n✅ Материалы уже выданы — скидка покрыла всю сумму, чек не требовался.`
        : reviewReason
          ? `\n\n⚠️ <b>Причина:</b> ${escapeHtml(reviewReason)}`
          : "");

  const itemsMessage =
    items.length > 0
      ? `📋 <b>Состав заказа #${displayNo}</b>\n\n${items.map((i) => `• ${escapeHtml(i.name_snapshot)} × ${i.quantity} — ${i.price_snapshot} ${order.currency}`).join("\n")}`
      : "";

  // confirm: уже диспетчеризует по order.fulfillment_kind (Ниши, Блок 6) —
  // тут меняется только подпись, чтобы кондитеру не предлагали «выдать» торт.
  const acceptLabel =
    order.fulfillment_kind === "physical" ? "✅ Принять заказ" : "✅ Подтвердить и выдать";
  const reply_markup =
    autoDelivered || noPaymentNeeded
      ? undefined
      : {
          inline_keyboard: [
            [
              { text: acceptLabel, callback_data: `confirm:${order.id}` },
              { text: "❌ Отклонить", callback_data: `reject:${order.id}` },
            ],
          ],
        };

  const combinedText = itemsMessage ? `${summaryText}\n\n${itemsMessage}` : summaryText;
  const summaryFitsItems = combinedText.length <= TELEGRAM_MESSAGE_MAX;
  const keepAfterDecision = autoDelivered || noPaymentNeeded;

  for (const adminChatId of adminIds) {
    const refs: AdminNotifyTgRef[] = [];
    const remember = (ids: number[]) => {
      for (const message_id of ids) refs.push({ chat_id: String(adminChatId), message_id });
    };

    // 1) Сводка + состав в одном сообщении, если влезает; иначе состав следом.
    try {
      if (summaryFitsItems) {
        const res = await tg("sendMessage", {
          chat_id: adminChatId,
          text: combinedText,
          parse_mode: "HTML",
          ...(reply_markup ? { reply_markup } : {}),
        });
        remember(collectTgMessageIds(res.result));
      } else {
        const res = await tg("sendMessage", {
          chat_id: adminChatId,
          text: summaryText,
          parse_mode: "HTML",
          ...(reply_markup ? { reply_markup } : {}),
        });
        remember(collectTgMessageIds(res.result));
        if (itemsMessage) {
          remember(await sendLongHtmlMessage(adminChatId, itemsMessage));
        }
      }
    } catch (err) {
      console.error(`[bot] failed to notify admin ${adminChatId} (summary)`, err);
    }

    // 2) Чек — только когда он реально ожидается. Без предоплаты отдельное
    // «чек не получен» только засоряет чат.
    const proofCaption = `🧾 <b>Чек оплаты — заказ #${displayNo}</b>`;
    if (!noPaymentNeeded) {
      try {
        if (proofFileId && proofKind === "document") {
          const res = await tg("sendDocument", {
            chat_id: adminChatId,
            document: proofFileId,
            caption: proofCaption,
            parse_mode: "HTML",
          });
          remember(collectTgMessageIds(res.result));
        } else if (proofFileId) {
          const res = await tg("sendPhoto", {
            chat_id: adminChatId,
            photo: proofFileId,
            caption: proofCaption,
            parse_mode: "HTML",
          });
          remember(collectTgMessageIds(res.result));
        } else if (order.payment_proof_path) {
          const proofPath = String(order.payment_proof_path);
          const { data: storedProof, error: proofDownloadError } = await s.storage
            .from("payment-proofs")
            .download(proofPath);
          if (proofDownloadError || !storedProof) {
            throw proofDownloadError ?? new Error("stored proof is empty");
          }
          const bytes = new Uint8Array(await storedProof.arrayBuffer());
          const { mimeFromPath, paymentProofKind } = await import("./file-mime");
          const { tgSendMultipart } = await import("./telegram.server");
          const mime = mimeFromPath(proofPath, storedProof.type || "application/octet-stream");
          const kind = paymentProofKind(proofPath);
          const res = await tgSendMultipart(
            kind === "image" ? "sendPhoto" : "sendDocument",
            {
              chat_id: adminChatId,
              caption: proofCaption,
              parse_mode: "HTML",
            },
            {
              field: kind === "image" ? "photo" : "document",
              filename: proofPath.split("/").pop() || "receipt",
              bytes,
              contentType: mime,
            },
          );
          remember(collectTgMessageIds(res.result));
        } else if (!autoDelivered) {
          const res = await tg("sendMessage", {
            chat_id: adminChatId,
            text: `${proofCaption}\n\n⚠️ <b>Чек не удалось получить автоматически</b> — запросите у покупателя.`,
            parse_mode: "HTML",
          });
          remember(collectTgMessageIds(res.result));
        }
      } catch (err) {
        console.error(`[bot] failed to notify admin ${adminChatId} (proof)`, err);
      }
    }

    try {
      remember(await sendCoverPreviews(adminChatId, displayNo as number, coverUrls));
    } catch (err) {
      console.error(`[bot] failed to notify admin ${adminChatId} (covers)`, err);
    }

    if (!keepAfterDecision) {
      await rememberAdminNotifyMessages(orderId, refs);
    }
  }
}

async function showSearch(chat_id: number, user: BotUser, query: string, offset = 0) {
  const locale: Locale = user.state?.locale ?? "ru";
  const m = copy[locale];
  const telegram_id = user.telegram_id;
  const s = await db();
  // Запятая — разделитель условий в PostgREST .or(), а не только спецсимвол
  // ILIKE: "математика, 5 класс" рвал фильтр на лишние условия, PostgREST
  // отвечал ошибкой на весь запрос, а она проглатывалась ниже и выглядела
  // как честное «ничего не найдено» (Блок 4.2).
  const term = `%${query.replace(/[%_,]/g, "")}%`;
  const { data, error } = await s
    .from("products")
    .select(
      "*, product_images(image_path, sort_order), product_variants(id, name, price, sort_order)",
    )
    .eq("is_active", true)
    .or(`name.ilike.${term},description.ilike.${term},keywords.ilike.${term}`)
    .order("name")
    .limit(30);

  if (error) {
    console.error("[bot] showSearch failed", error);
    await tg("sendMessage", { chat_id, text: m.searchNothingFound });
    return;
  }

  // showCategories() уже прячет товары скрытой категории — там до них просто
  // некому дойти, кнопки самой категории нет. Поиск же шёл в обход: смотрел
  // только на products.is_active и находил товары, чья единственная папка
  // скрыта продавцом (Блок 4.5). Товары без категорий (category_ids=[]) —
  // корень каталога, их это не касается.
  const { data: hiddenCats } = await s.from("categories").select("id").eq("is_visible", false);
  const hiddenIds = new Set((hiddenCats ?? []).map((c) => c.id as string));
  const visibleOf = (rows: typeof data) =>
    (rows ?? []).filter((p) => {
      const catIds = (p.category_ids as string[] | null) ?? [];
      return catIds.length === 0 || catIds.some((id) => !hiddenIds.has(id));
    });
  let visible = visibleOf(data);

  // Запоминаем запрос для пагинации (callback_data ограничена 64 байтами,
  // поэтому сам запрос в payload не кладём, а храним в state).
  await setState(telegram_id, { ...user.state, mode: "idle", last_search: query });

  if (!visible.length) {
    // Умный поиск (Кейс 3, №9) — фолбэк для запросов, которые точный
    // ILIKE-поиск не понял (нет пересечения по словам), но модель может
    // сопоставить по смыслу. Включается отдельно от наличия ключа API (см.
    // isSmartSearchEnabled) — стоимость за вызов реальная, продавец должен
    // включить это сознательно.
    const { isSmartSearchEnabled, consumeSmartSearchQuota, smartSearchProductIds, MAX_CANDIDATES } =
      await import("./smart-search.server");
    // Личный кулдаун + общий дневной потолок — бот открыт всем в Telegram,
    // не только покупателям, а вызов LLM стоит реальных денег продавцу.
    // Превышение любого из двух молча приводит к «ничего не найдено», как
    // и раньше — не отдельная ошибка, которую стоило бы объяснять.
    if ((await isSmartSearchEnabled()) && (await consumeSmartSearchQuota(telegram_id))) {
      // Обычный поиск уже ответил «ничего», а запрос уходит в LLM и может
      // занять заметно больше времени — без этой строки молчание бота
      // выглядит как зависание, а не как «ищу ещё».
      await tg("sendMessage", { chat_id, text: m.searchDeeperHint });
      // Тот же лимит, что smartSearchProductIds реально отправляет в LLM —
      // раньше здесь стояло независимое число (300 против MAX_CANDIDATES
      // 200), и часть каталога клиента с ~400 товарами умный поиск вообще
      // не видел, никак это не показывая.
      const { data: allActive } = await s
        .from("products")
        .select(
          "*, product_images(image_path, sort_order), product_variants(id, name, price, sort_order)",
        )
        .eq("is_active", true)
        .limit(MAX_CANDIDATES);
      const candidates = visibleOf(allActive ?? []);
      const ids = await smartSearchProductIds(
        query,
        candidates.map((p) => {
          // Блок 10, находка 10.3 — названия вариантов ("1 кг"/"2 кг") не
          // попадали в кандидаты вовсе: запрос "торт 2 кг" не сопоставлялся
          // с товаром, у которого именно такой вариант. Дописываем их в
          // keywords — отдельного поля под варианты в LLM-запросе нет и не
          // нужно, они не более значимы, чем остальные ключевые слова.
          const variantNames = (p.product_variants ?? []).map((v) => v.name).join(", ");
          const keywords = variantNames ? `${p.keywords ?? ""} ${variantNames}`.trim() : p.keywords;
          return {
            id: p.id,
            name: p.name,
            description: p.description,
            keywords,
          };
        }),
      );
      if (ids?.length) {
        const byId = new Map(candidates.map((p) => [p.id, p]));
        visible = ids
          .map((id) => byId.get(id))
          .filter((p): p is NonNullable<typeof p> => Boolean(p));
      }
    }
    if (!visible.length) {
      await tg("sendMessage", { chat_id, text: m.searchNothingFound });
      return;
    }
  }

  const all = visible;
  const page = all.slice(offset, offset + 5);

  if (offset === 0) {
    await tg("sendMessage", { chat_id, text: m.foundCount(all.length) });
  }

  for (const p of page) {
    await sendProductCard(chat_id, p, user.state?.country_code, locale);
  }

  // Кнопка «Показать ещё», если остались результаты
  const nextOffset = offset + 5;
  if (nextOffset < all.length) {
    await tg("sendMessage", {
      chat_id,
      text: m.shownOf(nextOffset, all.length),
      reply_markup: {
        inline_keyboard: [[{ text: m.showMore, callback_data: `searchmore:${nextOffset}` }]],
      },
    });
  }
}

function starButtons(productId: string): Array<{ text: string; callback_data: string }> {
  return [1, 2, 3, 4, 5].map((n) => ({
    text: "⭐".repeat(n),
    callback_data: `stars:${productId}:${n}`,
  }));
}

async function showMyOrders(chat_id: number, telegram_id: number, locale: Locale = "ru") {
  const m = copy[locale];
  const s = await db();
  const { data } = await s
    .from("orders")
    .select("id, order_no, display_no, status, total, currency, created_at, fulfillment_kind")
    .eq("telegram_id", telegram_id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (!data?.length) {
    await tg("sendMessage", { chat_id, text: m.noOrdersYet });
    return;
  }
  // Блок 5, находка 5.2 — раньше statusMap знал только 5 цифровых статусов,
  // и accepted/in_production/ready показывались покупателю сырым кодом.
  const statusMap: Record<string, string> = {
    awaiting_payment: m.statusAwaitingPayment,
    awaiting_confirmation: m.statusAwaitingConfirmation,
    delivering: m.statusDelivering,
    delivered: m.statusDelivered,
    rejected: m.statusRejected,
    accepted: m.statusAccepted,
    in_production: m.statusInProduction,
    ready: m.statusReady,
  };
  const text = data
    .map(
      (o) =>
        `#${o.display_no ?? o.order_no ?? o.id} — ${o.total} ${o.currency} — ${statusMap[o.status as string] || o.status}`,
    )
    .join("\n");
  // «Скачать снова» и «Оценить» — по кнопке на каждый уже выданный заказ
  // (Кейс 3, №4 и №5): самообслуживание без обращения к продавцу.
  const reviewOn = await hasModule("review_request");
  const buttons = data
    .filter((o) => o.status === "delivered")
    .map((o) => [
      // "Скачать снова" только для цифровых заказов (Блок 5, находка 5.4) —
      // раньше кнопка показывалась и на выданный торт, а вела на "⚠️ Не
      // удалось найти файлы этого заказа" (их у него и не может быть — веб-
      // панель это уже исключала, бот — нет). "Оценить" остаётся на оба
      // типа — право на отзыв за физический заказ уже работает корректно.
      ...(o.fulfillment_kind !== "physical"
        ? [
            {
              text: m.resendBtn(o.display_no ?? o.order_no ?? o.id),
              callback_data: `resend:${o.id}`,
            },
          ]
        : []),
      ...(reviewOn
        ? [{ text: m.rateBtn(o.display_no ?? o.order_no ?? o.id), callback_data: `rate:${o.id}` }]
        : []),
    ])
    .filter((row) => row.length > 0);
  await tg("sendMessage", {
    chat_id,
    text: m.myOrdersHeader(text),
    ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export async function handleUpdate(update: TelegramUpdate) {
  try {
    // Callback queries
    if (update.callback_query) {
      const cq = update.callback_query;
      const chat_id = cq.message?.chat?.id;
      const data: string = cq.data || "";
      await tg("answerCallbackQuery", { callback_query_id: cq.id });
      // Отсутствует только у inline-режима (inline_message_id вместо message),
      // которым этот бот не пользуется — но раз callback без message пришёл,
      // отвечать в чат всё равно некуда.
      if (!chat_id || !cq.from) return;
      const from_id = cq.from.id;
      if (await replyIfBlocked(chat_id, from_id)) return;
      // Keep the manager-chat audit trail, but do not let takeover suppress
      // callback queries. These are explicit actions in the bot UI (catalog,
      // cart, checkout, country selection), not free-form conversation. A
      // previous takeover guard returned here and made the button tap visible
      // in the chat log while silently preventing order placement.
      await handleManagerChatCallback(from_id, callbackButtonLabel(cq));
      if (await replyIfPaused(chat_id)) return;

      const user = await upsertUser(cq.from);
      if (!user) return;
      const locale: Locale = user.state?.locale ?? "ru";
      const m = copy[locale];

      // Before allowing navigation, require country code
      if (
        !data.startsWith("setcountry:") &&
        !data.startsWith("confirm:") &&
        !data.startsWith("reject:") &&
        !data.startsWith("pay:") &&
        data !== "clear" &&
        !data.startsWith("rem:") &&
        !data.startsWith("add:") &&
        !data.startsWith("lang_") &&
        !data.startsWith("locale:") &&
        !data.startsWith("searchmore:") &&
        !data.startsWith("prod:")
      ) {
        if (!user.state?.country_code) {
          await askCountry(chat_id, from_id, false, locale);
          return;
        }
      }

      if (data.startsWith("locale:")) {
        const locale = data.slice("locale:".length);
        if (!isLocale(locale)) return;
        await applyLocaleSelection(chat_id, from_id, locale, user);
        return;
      }

      if (data.startsWith("pay:rk:") || data.startsWith("pay:manual:")) {
        const isRk = data.startsWith("pay:rk:");
        const orderId = Number(data.slice(isRk ? 7 : 11));
        if (!orderId) return;

        const s = await db();
        const { data: order } = await s
          .from("orders")
          .select(
            "id, order_no, display_no, telegram_id, status, total, currency, country_code, fulfillment_kind",
          )
          .eq("id", orderId)
          .maybeSingle();
        if (!order || Number(order.telegram_id) !== Number(from_id)) {
          await tg("sendMessage", { chat_id, text: m.orderNotFound });
          return;
        }
        const displayNo = order.display_no ?? order.order_no ?? orderId;
        if (order.status !== "awaiting_payment") {
          await tg("sendMessage", {
            chat_id,
            text: m.alreadyProcessed(displayNo),
          });
          return;
        }

        if (cq.message?.message_id) {
          await tg("editMessageReplyMarkup", {
            chat_id,
            message_id: cq.message.message_id,
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
        }

        const { amountDueNow } = await import("./fulfillment.server");
        const amountDue = await amountDueNow({
          total: Number(order.total),
          fulfillment_kind: order.fulfillment_kind,
        });

        if (isRk) {
          const rk = await loadRobokassaSettings();
          if (!rk.ready) {
            await tg("sendMessage", {
              chat_id,
              text: m.robokassaUnavailable,
            });
            return;
          }
          await sendRobokassaPayLink({
            chat_id,
            telegram_id: from_id,
            userState: user.state,
            orderId,
            displayNo,
            total: amountDue,
            currency: (order.currency as string) || "KZT",
            rk,
            locale,
          });
          return;
        }

        const { data: method } = await s
          .from("payment_methods")
          .select("instructions, qr_code_path")
          .eq("country_code", order.country_code || "KZ")
          .maybeSingle();
        await startManualProofPath({
          chat_id,
          telegram_id: from_id,
          userState: user.state,
          orderId,
          displayNo,
          total: amountDue,
          currency: (order.currency as string) || "KZT",
          instructions: (method?.instructions as string) || m.defaultInstructions,
          autoDeliver: true,
          locale,
          qrCodePath: method?.qr_code_path,
          isPhysical: order.fulfillment_kind === "physical",
        });
        return;
      }

      if (data.startsWith("cat:root")) {
        const parts = data.split(":");
        return showCategories(
          chat_id,
          null,
          user.state?.country_code,
          Number(parts[2] || 0),
          locale,
        );
      }
      if (data.startsWith("cat:")) {
        const parts = data.split(":");
        return showCategories(
          chat_id,
          parts[1],
          user.state?.country_code,
          Number(parts[2] || 0),
          locale,
        );
      }
      if (data.startsWith("prod:"))
        return showProduct(chat_id, data.slice(5), user.state?.country_code, locale);
      if (data.startsWith("searchmore:")) {
        // Пагинация поиска: запрос берём из state.last_search
        const offset = Number(data.slice(11)) || 0;
        const query = user.state?.last_search;
        if (!query) {
          await tg("sendMessage", { chat_id, text: m.searchSessionExpired });
          return;
        }
        return showSearch(chat_id, user, query, offset);
      }
      if (data.startsWith("add:")) {
        // "add:<productId>" — товар без вариантов; "add:<productId>:<variantId>"
        // — выбранный вариант (Ниши, Блок D, кнопка на карточке товара).
        const [productId, variantId] = data.slice(4).split(":");
        const addResult = await addToCart(from_id, productId, variantId || null);
        const addText =
          addResult === "ok"
            ? m.addedToCart
            : addResult === "mixed_cart"
              ? m.productMixedCartMsg
              : addResult === "digital_limit"
                ? m.productDigitalLimitMsg
                : addResult === "out_of_stock"
                  ? m.productOutOfStockMsg
                  : m.productUnavailable;
        await tg("sendMessage", { chat_id, text: addText });
        return;
      }
      if (data.startsWith("rem:")) {
        const s = await db();
        await s.from("cart_items").delete().eq("id", data.slice(4)).eq("telegram_id", from_id);
        return showCart(chat_id, user);
      }
      if (data === "clear") {
        const s = await db();
        await s.from("cart_items").delete().eq("telegram_id", from_id);
        await tg("sendMessage", { chat_id, text: m.cartCleared });
        return;
      }
      if (data === "promo:enter") {
        await setState(from_id, { ...user.state, mode: "awaiting_promo_code" });
        await tg("sendMessage", { chat_id, text: m.promoCodePrompt });
        return;
      }
      if (data === "promo:clear") {
        const { promo_code: _promo_code, ...rest } = user.state ?? {};
        await setState(from_id, rest);
        await tg("sendMessage", { chat_id, text: m.promoCodeRemoved });
        return showCart(chat_id, { ...user, state: rest });
      }
      if (data === "giftcert:enter") {
        await setState(from_id, { ...user.state, mode: "awaiting_gift_certificate_code" });
        await tg("sendMessage", { chat_id, text: m.giftCertificateCodePrompt });
        return;
      }
      if (data === "giftcert:clear") {
        const { gift_certificate_code: _gift_certificate_code, ...rest } = user.state ?? {};
        await setState(from_id, rest);
        await tg("sendMessage", { chat_id, text: m.giftCertificateRemoved });
        return showCart(chat_id, { ...user, state: rest });
      }
      if (data === "points:use") {
        const nextState = { ...user.state, use_points: true };
        await setState(from_id, nextState);
        return showCart(chat_id, { ...user, state: nextState });
      }
      if (data === "points:clear") {
        const { use_points: _use_points, ...rest } = user.state ?? {};
        await setState(from_id, rest);
        return showCart(chat_id, { ...user, state: rest });
      }
      if (data.startsWith("resend:")) {
        const orderId = Number(data.slice(7));
        await tg("sendMessage", { chat_id, text: m.resendSent });
        const { resendOrderFiles } = await import("./orders.server");
        const result = await resendOrderFiles(orderId, from_id).catch((e) => {
          console.error(`[bot] resendOrderFiles failed for order ${orderId}`, e);
          return { ok: false as const, reason: "not_found" as const };
        });
        if (!result.ok || result.sent === 0) {
          await tg("sendMessage", { chat_id, text: m.resendFailed });
        }
        return;
      }
      if (data.startsWith("rate:")) {
        // hasModule — не только на кнопке в showMyOrders: старое сообщение с
        // кнопкой «⭐ Оценить» остаётся рабочим в Telegram даже после того,
        // как продавец отключил модуль. Проверяем здесь же, на самом
        // действии, тем же приёмом, что и в awardPointsForDelivery.
        if (!(await hasModule("review_request"))) return;
        const orderId = Number(data.slice(5));
        const { reviewableProductsForOrder } = await import("./reviews.server");
        const products = await reviewableProductsForOrder(orderId, from_id);
        if (products.length === 0) {
          await tg("sendMessage", { chat_id, text: m.noReviewableProducts });
          return;
        }
        if (products.length === 1) {
          await tg("sendMessage", {
            chat_id,
            text: m.chooseRatingPrompt(products[0].name),
            reply_markup: { inline_keyboard: [starButtons(products[0].product_id)] },
          });
          return;
        }
        await tg("sendMessage", {
          chat_id,
          text: m.chooseProductToRate,
          reply_markup: {
            inline_keyboard: products.map((p) => [
              { text: p.name, callback_data: `rateproduct:${p.product_id}` },
            ]),
          },
        });
        return;
      }
      if (data.startsWith("rateproduct:")) {
        if (!(await hasModule("review_request"))) return;
        const productId = data.slice(12);
        const { hasDeliveredPurchase } = await import("./reviews.server");
        if (!(await hasDeliveredPurchase(from_id, productId))) {
          await tg("sendMessage", { chat_id, text: m.reviewNotAllowed });
          return;
        }
        const s = await db();
        const { data: product } = await s
          .from("products")
          .select("name")
          .eq("id", productId)
          .maybeSingle();
        await tg("sendMessage", {
          chat_id,
          text: m.chooseRatingPrompt(product?.name ?? ""),
          reply_markup: { inline_keyboard: [starButtons(productId)] },
        });
        return;
      }
      if (data.startsWith("stars:")) {
        if (!(await hasModule("review_request"))) return;
        const [, productId, ratingRaw] = data.split(":");
        const rating = Number(ratingRaw);
        if (!isValidRating(rating)) return;
        const { hasDeliveredPurchase, upsertReview } = await import("./reviews.server");
        if (!(await hasDeliveredPurchase(from_id, productId))) {
          await tg("sendMessage", { chat_id, text: m.reviewNotAllowed });
          return;
        }
        await upsertReview(from_id, productId, rating, null);
        await setState(from_id, {
          ...user.state,
          mode: "awaiting_review_comment",
          review_product_id: productId,
        });
        await tg("sendMessage", {
          chat_id,
          text: m.reviewSaved,
          reply_markup: {
            inline_keyboard: [[{ text: m.reviewSkipBtn, callback_data: "reviewskip" }]],
          },
        });
        return;
      }
      if (data === "reviewskip") {
        const { mode: _mode, review_product_id: _rpid, ...rest } = user.state ?? {};
        await setState(from_id, rest);
        return;
      }
      // Кнопка из напоминания о брошенной корзине (Кейс 3, №6) — просто
      // открывает корзину, как и текстовая кнопка "🛒 Корзина" меню.
      if (data === "cart:show") {
        return showCart(chat_id, user);
      }
      if (data === "checkout") {
        try {
          return await startCheckout(chat_id, user);
        } catch (e: unknown) {
          console.error(`[bot] checkout failed for telegram_id=${from_id}`, e);
          await tg("sendMessage", {
            chat_id,
            text: "⚠️ Не удалось начать оформление заказа. Попробуйте ещё раз через минуту или напишите продавцу.",
          }).catch(() => {});
          return;
        }
      }
      if (data.startsWith("country:"))
        return proceedToFulfillmentOrPlace(chat_id, user, data.slice(8));

      if (data.startsWith("setcountry:")) {
        const code = data.slice(11);
        const s = await db();
        const { data: countryMethod } = await s
          .from("payment_methods")
          .select("country_name")
          .eq("country_code", code)
          .maybeSingle();
        await setState(from_id, {
          ...user.state,
          country_code: code,
          country_name: countryMethod?.country_name,
        });
        await tg("sendMessage", {
          chat_id,
          text: m.countrySaved(countryMethod?.country_name as string),
        });
        await sendMain(chat_id, undefined, undefined, locale);
        return;
      }

      if (data.startsWith("checkoutlang:")) {
        const choice = data.slice("checkoutlang:".length);
        if (!isDeliveryLangChoice(choice)) return;

        const countryCode = user.state?.country_code;
        if (!countryCode) {
          // Состояние потерялось между сообщениями (например, сессия
          // истекла) — переспрашиваем страну, а не падаем молча.
          await askCountry(chat_id, from_id, true, locale);
          return;
        }

        const nextState = { ...user.state, checkout_lang_choice: choice };
        await setState(from_id, nextState);
        if (cq.message?.message_id) {
          await tg("editMessageReplyMarkup", {
            chat_id,
            message_id: cq.message.message_id,
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
        }
        await placeOrder(chat_id, { ...user, state: nextState }, countryCode);
        return;
      }

      if (data.startsWith("fulfilltype:")) {
        // Guard по mode (Блок 4, находка 4.6) — тап по кнопке из старого
        // сообщения (Telegram хранит инлайн-клавиатуры бессрочно) с новой
        // корзиной/на другом шаге чекаута иначе тихо переписывал бы
        // checkout_fulfillment_type поверх того, что реально происходит
        // сейчас.
        if (user.state?.mode !== "awaiting_fulfillment_type") return;
        const typeRaw = data.slice("fulfilltype:".length);
        if (typeRaw !== "pickup" && typeRaw !== "delivery") return;
        const type: "pickup" | "delivery" = typeRaw;
        if (cq.message?.message_id) {
          await tg("editMessageReplyMarkup", {
            chat_id,
            message_id: cq.message.message_id,
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
        }
        const nextState = { ...user.state, checkout_fulfillment_type: type };
        await askFulfillmentDate(chat_id, from_id, nextState, locale);
        return;
      }

      if (data.startsWith("zone:")) {
        // Guard по mode (Блок 4, находка 4.6/4.7) — тап по старой кнопке
        // зоны из awaiting_proof (уже другой заказ/шаг) иначе загонял бы
        // покупателя обратно в awaiting_address, и следующее его сообщение
        // (например, чек оплаты) съедалось бы как адрес доставки.
        if (user.state?.mode !== "awaiting_delivery_zone") return;
        const zoneId = data.slice("zone:".length);
        if (cq.message?.message_id) {
          await tg("editMessageReplyMarkup", {
            chat_id,
            message_id: cq.message.message_id,
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
        }
        const s = await db();
        const { data: zone } = await s
          .from("delivery_zones")
          .select("id, name, price")
          .eq("id", zoneId)
          .eq("is_active", true)
          .maybeSingle();
        if (!zone) {
          // Зона исчезла/скрыта между показом кнопок и тапом — переспрашиваем шаг.
          await proceedToDeliveryZoneOrAddress(chat_id, from_id, user.state, locale);
          return;
        }
        const nextState = {
          ...user.state,
          checkout_delivery_zone_id: zone.id,
          checkout_delivery_zone_name: zone.name,
          checkout_delivery_fee: Number(zone.price),
          mode: "awaiting_address" as const,
        };
        await setState(from_id, nextState);
        await tg("sendMessage", { chat_id, text: copy[locale].addressPrompt });
        return;
      }

      if (data === "fulfillnote:skip") {
        // Guard по mode (Блок 4, находка 4.6) — старая кнопка "Без
        // комментария" с новой корзиной иначе создавала бы физический
        // заказ с fulfillment_at = NULL, чего быть не должно (MIGRATION-49).
        if (user.state?.mode !== "awaiting_fulfillment_note") return;
        if (cq.message?.message_id) {
          await tg("editMessageReplyMarkup", {
            chat_id,
            message_id: cq.message.message_id,
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
        }
        const countryCode = user.state?.country_code;
        if (!countryCode) {
          await askCountry(chat_id, from_id, true, locale);
          return;
        }
        const nextState = { ...user.state, mode: undefined };
        await setState(from_id, nextState);
        await placeOrder(chat_id, { ...user, state: nextState }, countryCode);
        return;
      }

      if (data.startsWith("lang_") && isLocale(data.slice(5).split(":")[0])) {
        const parts = data.split(":");
        const lang = parts[0].slice(5) as Locale;
        const orderId = Number(parts[1]);
        const idx = Number(parts[2]);
        const s = await db();
        const { data: order } = await s
          .from("orders")
          .select("*, order_items(*)")
          .eq("id", orderId)
          .single();
        if (!order) return;

        // Security: verify the order belongs to the user clicking the button
        if (order.telegram_id !== from_id) {
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            text: m.accessDenied,
          });
          return;
        }

        // Sort items to match server delivery index logic
        const items = ((order.order_items as OrderItem[]) || []).slice().sort((a, b) => {
          const ai = String(a.id || "");
          const bi = String(b.id || "");
          return ai < bi ? -1 : ai > bi ? 1 : 0;
        });

        const item = items[idx];
        if (!item?.id) return;

        // Check if this language was already delivered
        if (parseDeliveredLanguages(item.delivered_language).has(lang)) {
          await tg("sendMessage", { chat_id, text: m.fileAlreadySent });
          return;
        }

        const { sendMaterials } = await import("./orders.server");
        const materials = materialsForOrderItem(item, lang);
        const langLabel = `${localeFlags[lang]} ${localeNames[lang]}`;

        let materialOk = true;
        if (materials.length) {
          await tg("sendMessage", {
            chat_id,
            text: m.loadingMaterials(langLabel),
          });
          // Always 1 copy — quantity is cart price, not file copies
          const result = await sendMaterials(order.telegram_id, materials, item.name_snapshot, 1);
          materialOk = result.outcome === "sent";
          if (!materialOk) {
            await tg("sendMessage", {
              chat_id,
              text: `⚠️ Не удалось отправить материал (${langLabel}) — продавец вышлет вручную.`,
            });
          }
        } else {
          await tg("sendMessage", {
            chat_id,
            text: m.materialNotConfigured(langLabel),
          });
        }

        // Update delivered_language tracking — only on an actual send, so a
        // failed attempt can still be retried by tapping the language button
        // again instead of being silently marked done.
        if (materialOk) {
          await s
            .from("order_items")
            .update({ delivered_language: addDeliveredLanguage(item.delivered_language, lang) })
            .eq("id", item.id);
        }

        // Edit the message to remove buttons
        if (cq.message?.message_id) {
          await tg("editMessageReplyMarkup", {
            chat_id,
            message_id: cq.message.message_id,
            reply_markup: { inline_keyboard: [] },
          });
        }

        return;
      }

      // Admin actions
      if (data.startsWith("confirm:")) {
        if (!(await requireShopAdmin(from_id, chat_id))) return;
        const orderId = Number(data.slice(8));
        const clicked = cq.message?.message_id
          ? [{ chat_id: String(chat_id), message_id: cq.message.message_id }]
          : [];
        // Админу показываем сквозной номер этого бота, а не внутренний id.
        const { data: ordRow } = await (
          await db()
        )
          .from("orders")
          .select("order_no, fulfillment_kind, total, status")
          .eq("id", orderId)
          .maybeSingle();
        const shownNo = ordRow?.order_no ?? orderId;

        if (ordRow?.fulfillment_kind === "physical") {
          const { acceptOrder, amountDueNow, recordPayment } = await import("./fulfillment.server");
          try {
            // "awaiting_payment" — покупатель ещё не присылал чек, продавец
            // принимает на доверие: писать в paid_amount нечего (Блок 1,
            // находка 1.2). Тот же приём, что в orders.functions.ts
            // confirmOrder — статус смотрим ДО acceptOrder, она его меняет.
            const hadProof = ordRow.status !== "awaiting_payment";
            const result = await acceptOrder(orderId);
            // alreadyAccepted — двойной тап по той же кнопке (сообщение уже
            // не редактируется второй раз, но карточка могла остаться
            // открытой у двух админов) — не задваиваем paid_amount (находка 1.1).
            if (!result.alreadyAccepted && hadProof) {
              const due = await amountDueNow({
                total: Number(ordRow.total),
                fulfillment_kind: ordRow.fulfillment_kind,
              });
              // recordPayment сама не бросает при исчерпанных попытках CAS —
              // возвращает false (Блок 1, находка 1.8). .catch() ловит только
              // исключения, false он пропускал молча.
              const paid = await recordPayment(orderId, due).catch((e) => {
                console.error("[bot] recordPayment failed", orderId, e);
                return false;
              });
              if (!paid) console.error("[bot] recordPayment returned false", orderId);
            }
            await dismissAdminOrderNotifications(orderId, clicked);
            await tg("sendMessage", { chat_id, text: `✅ Заказ #${shownNo} принят в работу.` });
          } catch (e: unknown) {
            await tg("sendMessage", { chat_id, text: `Ошибка: ${errorMessage(e)}` });
          }
          return;
        }

        await dismissAdminOrderNotifications(orderId, clicked);
        const statusRes = await tg("sendMessage", {
          chat_id,
          text: `⏳ Выдаю заказ #${shownNo}...`,
        });
        const statusId = collectTgMessageIds(statusRes.result)[0];
        const finishAdminStatus = async (text: string) => {
          if (statusId) {
            await tg("editMessageText", { chat_id, message_id: statusId, text });
            return;
          }
          await tg("sendMessage", { chat_id, text });
        };
        const { deliverOrder } = await import("./orders.server");
        try {
          const result = await deliverOrder(orderId);
          if (result.alreadyDelivered) {
            await finishAdminStatus(`ℹ️ Заказ #${shownNo} уже выдаётся или выдан.`);
          } else if ("pending" in result && result.pending) {
            await finishAdminStatus(
              `📤 Заказ #${shownNo}: отправлено ${result.sent} из ${result.total}. Продолжаю рассылку — нажмите «Продолжить выдачу» в панели или подождите крон.`,
            );
          } else if (result.manualRequired) {
            await finishAdminStatus(
              `⚠️ Заказ #${shownNo} обработан, но часть материалов нужно выслать вручную — проверьте панель.`,
            );
          } else {
            await finishAdminStatus(`✅ Заказ #${shownNo} выдан.`);
          }
        } catch (e: unknown) {
          await finishAdminStatus(`Ошибка: ${errorMessage(e)}`);
        }
        return;
      }
      if (data.startsWith("reject:")) {
        if (!(await requireShopAdmin(from_id, chat_id))) return;
        const orderId = Number(data.slice(7));
        const clicked = cq.message?.message_id
          ? [{ chat_id: String(chat_id), message_id: cq.message.message_id }]
          : [];
        const s = await db();
        const { rejectOrderSafely } = await import("./orders.server");
        const claim = await rejectOrderSafely(orderId);
        if (!claim.ok) {
          await tg("sendMessage", {
            chat_id,
            text: `⚠️ Заказ #${orderId} нельзя отклонить: статус уже «${claim.status}».`,
          });
          return;
        }
        const order = claim.order;

        // Пишем туда, откуда пришёл заказ: у покупателя из Instagram
        // telegram_id синтетический, и прямая отправка улетала в пустоту —
        // человек не узнавал об отказе и продолжал ждать материалы.
        const { notifyOrderCustomer } = await import("./orders.server");
        // Админу — сквозной номер этого бота (как и в confirm: выше);
        // покупателю — замороженный при создании, MIGRATION-28, чтобы
        // совпадал с тем, что он уже видел в переписке.
        const shownNo = order?.order_no ?? orderId;
        const customerDisplayNo = order?.display_no ?? order?.order_no ?? orderId;
        const { data: buyer } = order?.telegram_id
          ? await s
              .from("bot_users")
              .select("state")
              .eq("telegram_id", order.telegram_id)
              .maybeSingle()
          : { data: null };
        const buyerLocale: Locale = (buyer?.state as BotUser["state"])?.locale ?? "ru";
        const notified = await notifyOrderCustomer(
          orderId,
          copy[buyerLocale].rejectedNotice(customerDisplayNo),
        );

        await dismissAdminOrderNotifications(orderId, clicked);
        await tg("sendMessage", {
          chat_id,
          text: notified
            ? `Заказ №${shownNo} отклонён, покупатель предупреждён.`
            : `Заказ №${shownNo} отклонён. Сообщить покупателю не удалось — напишите ему сами.`,
        });
        return;
      }
      return;
    }

    const msg = update.message;
    if (!msg) return;
    const chat_id = msg.chat.id;
    const from = msg.from;
    if (!from) return;
    if (await replyIfBlocked(chat_id, from.id)) return;

    // Фото/документ приходят с `caption`, а не `text` — раньше перехват
    // логировал такое сообщение как "[без текста]", и оператор не видел ни
    // подписи, ни того, что это вообще вложение.
    const attachmentLabel = msg.photo ? "📷 Фото" : msg.document ? "📎 Документ" : undefined;
    const managerLogText = msg.text || msg.caption || attachmentLabel;
    const managerIntercepted = await handleManagerChatInbound(from.id, managerLogText);

    // Чек по заказу не должен потеряться только из-за того, что менеджер
    // взял диалог на себя (Блок 2.1): раньше `return` здесь выполнялся
    // безусловно, и вложение, отправленное во время перехвата, вообще не
    // доходило до кода приёма чека ниже — заказ оставался неоплаченным, а
    // покупатель думал, что чек отправлен. Условие то же самое, что и у
    // обычной ветки приёма чека дальше по файлу: mode ожидания чека с
    // привязанным заказом, либо любой открытый awaiting_payment заказ.
    let interceptedButAwaitingProof = false;
    if (managerIntercepted && (msg.photo || msg.document)) {
      const s = await db();
      const { data: buyer } = await s
        .from("bot_users")
        .select("state")
        .eq("telegram_id", from.id)
        .maybeSingle();
      const state = buyer?.state as BotUser["state"] | undefined;
      const proofModes = new Set(["awaiting_proof", "awaiting_payment"]);
      if (state?.mode && proofModes.has(String(state.mode)) && state.pending_order_id) {
        interceptedButAwaitingProof = true;
      } else {
        // То же окно, что и у запасного пути приёма чека ниже: иначе перехват
        // пропускал бы дальше вложения по заказам, которые тот путь всё равно
        // уже не примет.
        const since = new Date(Date.now() - PROOF_FALLBACK_WINDOW_MS).toISOString();
        const { data: openOrder } = await s
          .from("orders")
          .select("id")
          .eq("telegram_id", from.id)
          .eq("status", "awaiting_payment")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        interceptedButAwaitingProof = Boolean(openOrder?.id);
      }
    }

    if (managerIntercepted && !interceptedButAwaitingProof) return;
    if (await replyIfPaused(chat_id)) return;
    const user = await upsertUser(from);
    if (!user) return;
    const locale: Locale = user.state?.locale ?? "ru";
    const m = copy[locale];

    // /start - special: also detect if sender is the admin and offer to bind
    if (msg.text === "/start" || msg.text?.startsWith("/start ")) {
      const startPayload = msg.text.slice("/start".length).trim();
      let webHandoffPendingCheckout = false;
      if (startPayload.startsWith("ref_") && (await hasModule("referral"))) {
        const { registerReferral } = await import("./referrals.server");
        await registerReferral(from.id, startPayload.slice(4)).catch((e) =>
          console.error("[bot] registerReferral failed", e),
        );
      }
      const { WEB_CART_HANDOFF_START_PREFIX, claimWebCartHandoff } =
        await import("./web-storefront-handoff.server");
      if (startPayload.startsWith(WEB_CART_HANDOFF_START_PREFIX)) {
        const token = startPayload.slice(WEB_CART_HANDOFF_START_PREFIX.length);
        const claimResult = await claimWebCartHandoff(from.id, token);
        if (claimResult === "ok") webHandoffPendingCheckout = true;
        else if (claimResult !== "missing") {
          console.warn("[bot] web handoff claim", { telegram_id: from.id, claimResult, token });
        }
      }
      await setState(from.id, {
        ...user.state,
        mode: "idle",
        web_handoff_pending_checkout: webHandoffPendingCheckout,
      });

      // Разовая настройка бота, не имеет отношения к языку покупателя —
      // поэтому идёт до выбора языка и всегда по-русски: тому, кто это
      // видит, ещё только предстоит открыть панель и выбрать язык магазина.
      const s = await db();
      const { data: setting } = await s
        .from("app_settings")
        .select("value")
        .eq("key", "admin_chat_id")
        .maybeSingle();
      if (!setting?.value) {
        // First user gets a hint with their chat id
        await tg("sendMessage", {
          chat_id,
          text: `Привет! Это бот-каталог.\n\nВаш Telegram ID: <code>${from.id}</code>\nЕсли вы продавец — скопируйте его и вставьте в админ-панель → Настройки, чтобы получать уведомления о заказах.`,
          parse_mode: "HTML",
        });
      }

      // /start is also the language-change entry point. Never infer this from
      // Telegram's device setting: the customer explicitly selects every time.
      // Дальше — в обработчике locale: (welcome, оферта, страна, sendMain).
      //
      // Без модуля multi_language выбор языка не показывается вовсе — сразу
      // подставляется locale по умолчанию (см. applyLocaleSelection), чтобы
      // покупатель не выбирал то, чего продавец не оплатил.
      if (await hasModule("multi_language")) {
        await askLanguage(chat_id);
      } else {
        await applyLocaleSelection(chat_id, from.id, "ru", user);
      }
      return;
    }
    if (msg.text === "/id") {
      await tg("sendMessage", { chat_id, text: m.idLabel(from.id) });
      return;
    }

    // Contact share (optional — user can also type phone as text)
    if (msg.contact && user.state?.mode === "awaiting_contact") {
      await saveContactAndContinueCheckout(chat_id, user, msg.contact.phone_number);
      return;
    }

    // Phone number typed as text during checkout
    if (user.state?.mode === "awaiting_contact" && msg.text) {
      if (MENU_ACTIONS.has(canonicalMenuAction(msg.text) ?? "")) {
        await setState(from.id, { ...user.state, mode: "idle" });
        // Fallthrough to the main menu switch below
      } else {
        if (msg.text === m.shareContactBtn) {
          await tg("sendMessage", {
            chat_id,
            text: m.shareContactHint,
          });
          return;
        }

        const phone = normalizePhone(msg.text);
        if (!phone) {
          await tg("sendMessage", {
            chat_id,
            text: m.phoneParseFail,
            parse_mode: "HTML",
          });
          return;
        }
        await saveContactAndContinueCheckout(chat_id, user, phone);
        return;
      }
    }

    // Payment proof (photo OR document).
    // Robokassa sets mode=awaiting_payment; manual path uses awaiting_proof.
    // Accept receipts in both modes, and for any open awaiting_payment order.
    const proofModes = new Set(["awaiting_proof", "awaiting_payment"]);
    let proofOrderId: number | undefined =
      proofModes.has(String(user.state?.mode || "")) && user.state?.pending_order_id
        ? Number(user.state.pending_order_id)
        : undefined;

    /**
     * Запасной путь: состояние потерялось, но заказ ждёт оплаты.
     *
     * Ветка нужна — состояние живёт в `bot_users.state`, и запись могла не
     * пройти; без неё настоящий чек пропадал бы молча. Но она не привязана к
     * шагу сценария, и до этого ограничения ловила **любое** фото от человека
     * с открытым заказом: покупатель, бросивший заказ три недели назад и
     * приславший сегодня скриншот с вопросом, переводил мёртвый заказ в
     * «ждёт подтверждения», и продавцу прилетала кнопка «выдать».
     *
     * Окно в сутки разделяет эти случаи: чек присылают вскоре после оплаты,
     * а вопрос со скриншотом приходит когда угодно. Заказы старше суток
     * по-прежнему можно оплатить — но чек к ним привяжется только когда бот
     * сам его попросил (mode = awaiting_proof/awaiting_payment выше).
     */
    if (!proofOrderId && (msg.photo || msg.document)) {
      const s = await db();
      const since = new Date(Date.now() - PROOF_FALLBACK_WINDOW_MS).toISOString();
      const { data: openOrder } = await s
        .from("orders")
        .select("id")
        .eq("telegram_id", from.id)
        .eq("status", "awaiting_payment")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (openOrder?.id) proofOrderId = Number(openOrder.id);
    }

    if (
      user.state?.mode === "awaiting_proof" &&
      user.state.pending_order_id &&
      !msg.photo &&
      !msg.document
    ) {
      if (msg.text && MENU_ACTIONS.has(canonicalMenuAction(msg.text) ?? "")) {
        await setState(from.id, { ...user.state, mode: "idle" });
        // Fallthrough to the main menu switch below
      } else {
        await tg("sendMessage", {
          chat_id,
          text: m.sendReceiptPrompt,
        });
        return;
      }
    }

    if (proofOrderId && (msg.photo || msg.document)) {
      const orderId = proofOrderId;

      const sOrder = await db();
      const { data: orderRow } = await sOrder
        .from("orders")
        .select(
          "id, display_no, status, admin_note, country_code, telegram_id, total, currency, fulfillment_kind",
        )
        .eq("id", orderId)
        .maybeSingle();

      if (!orderRow || Number(orderRow.telegram_id) !== Number(from.id)) {
        await tg("sendMessage", { chat_id, text: m.orderNotFound });
        return;
      }
      // Тот же номер, что видел покупатель в «Заказ №X создан» — не живой
      // order_no (его двигает ночная перенумерация), см. MIGRATION-28.
      const displayNo = orderRow.display_no ?? user.state?.pending_display_no ?? orderId;
      if (
        orderRow.status === "delivered" ||
        orderRow.status === "rejected" ||
        orderRow.status === "delivering" ||
        // Физические статусы (Блок 6) не входили сюда изначально (Блок 3,
        // находка 3.2): покупатель, уже принятый в работу, присылает ещё
        // одно фото (например, референс торта) — а pending_order_id всё
        // ещё указывает на этот заказ, и следующий блок пытался обработать
        // фото как новый чек: либо откатывал accepted обратно в
        // awaiting_confirmation/awaiting_payment (ручная/OCR-ветка ниже), либо
        // при повторном accept удваивал paid_amount, пока не была добавлена
        // защита alreadyAccepted (Блок 1, находка 1.1).
        orderRow.status === "accepted" ||
        orderRow.status === "in_production" ||
        orderRow.status === "ready"
      ) {
        await tg("sendMessage", {
          chat_id,
          text: m.alreadyProcessed(displayNo),
          reply_markup: await mainMenu(locale),
        });
        return;
      }

      const note = String(orderRow.admin_note || "");
      const autoDeliver =
        user.state?.proof_auto === true || note === "proof_auto" || note.startsWith("proof_auto");

      // Определяем источник чека и расширение сохраняемого файла.
      // Расширение важно: админ-панель определяет тип чека по расширению пути.
      let proofFileId: string | null = null;
      let proofKind: "photo" | "document" | null = null;
      let dl: { bytes: Uint8Array; mime: string } | null = null;
      let fileExt = "jpg";

      if (msg.photo) {
        const biggest = msg.photo[msg.photo.length - 1];
        proofFileId = biggest.file_id;
        proofKind = "photo";
        dl = await downloadTelegramFile(biggest.file_id);
      } else if (msg.document) {
        proofFileId = msg.document.file_id;
        proofKind = "document";
        dl = await downloadTelegramFile(msg.document.file_id);
        const docName = (msg.document.file_name || "").toLowerCase();
        const extMatch = docName.match(/\.([a-z0-9]{1,8})$/);
        if (extMatch) fileExt = extMatch[1];
        else if (msg.document.mime_type === "application/pdf") fileExt = "pdf";
        else fileExt = "bin";
      }

      // Сохраняем чек в storage.
      // Даже если storage недоступен — пересылаем file_id админу, чтобы чек не потерялся.
      let proofSaved = false;
      let proofPath: string | null = null;
      const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
      if (dl) {
        try {
          const { data: buckets } = await supabaseAdmin.storage.listBuckets();
          if (!buckets?.some((b) => b.name === "payment-proofs")) {
            await supabaseAdmin.storage.createBucket("payment-proofs", {
              public: false,
              fileSizeLimit: 20 * 1024 * 1024,
            });
          }
        } catch (e) {
          console.error("[bot] ensure payment-proofs bucket", e);
        }

        // payment-proofs общий на все деплои (Storage не проходит через RLS) —
        // bot_id-префикс не даёт чекам разных арендаторов оказаться в одной
        // папке общего бакета (см. ANALYSIS.md, пятое обследование).
        const key = `${process.env.BOT_ID?.trim() || "unknown"}/order-${orderId}/${Date.now()}.${fileExt}`;
        const body = new Blob([dl.bytes as BlobPart], {
          type: dl.mime || "application/octet-stream",
        });
        const upRes = await supabaseAdmin.storage.from("payment-proofs").upload(key, body, {
          contentType: dl.mime || "application/octet-stream",
          upsert: true,
        });
        if (!upRes.error) {
          proofPath = key;
          proofSaved = true;
        } else {
          console.error("[bot] payment-proofs upload failed", upRes.error);
        }
      } else {
        console.error("[bot] failed to download proof from Telegram", { orderId, proofKind });
      }

      if (autoDeliver) {
        // OCR check before auto-delivery
        if (!dl) {
          await setState(from.id, {
            ...user.state,
            mode: "awaiting_proof",
            pending_order_id: orderId,
            proof_auto: true,
          });
          await tg("sendMessage", {
            chat_id,
            text: m.fileDownloadFail,
          });
          return;
        }

        // Same gate as verifyDirectReceipt (direct-purchase.server.ts) — this
        // was the one auto-delivery path that spent the paid Vision quota
        // and ran OCR regardless of whether the client's tariff still
        // includes receipt_ocr. Falls into the same "manual review" branch
        // the module's own ocr_unavailable case already handles.
        const { verifyPaymentReceipt } = await import("./receipt-verify.server");
        const { amountDueNow: ocrAmountDueNow } = await import("./fulfillment.server");
        const ocrExpectedAmount = await ocrAmountDueNow({
          total: Number(orderRow.total),
          fulfillment_kind: orderRow.fulfillment_kind,
        });
        const verify: ReceiptVerifyResult = (await hasModule("receipt_ocr"))
          ? await verifyPaymentReceipt({
              bytes: dl.bytes,
              mime: dl.mime || (fileExt === "pdf" ? "application/pdf" : "image/jpeg"),
              expectedAmount: ocrExpectedAmount,
              currency: (orderRow.currency as string) || undefined,
              orderId,
            })
          : { ok: false, reason: "ocr_unavailable", detail: "модуль receipt_ocr не подключён" };

        if (!verify.ok && verify.reason === "not_receipt") {
          // Keep order open; ask for a real receipt
          await setState(from.id, {
            ...user.state,
            mode: "awaiting_proof",
            pending_order_id: orderId,
            proof_auto: true,
          });
          if (proofPath) {
            await supabaseAdmin
              .from("orders")
              .update({
                payment_proof_path: proofPath,
                admin_note: note.startsWith("proof_auto") ? note : "proof_auto",
                status: "awaiting_payment",
              })
              .eq("id", orderId);
          }
          await tg("sendMessage", {
            chat_id,
            text: m.notReceiptLike(displayNo),
          });
          return;
        }

        if (!verify.ok) {
          // amount_mismatch or ocr_unavailable → manual review
          await setState(from.id, {
            ...user.state,
            mode: "idle",
            pending_order_id: undefined,
            proof_auto: false,
          });
          await supabaseAdmin
            .from("orders")
            .update({
              status: "awaiting_confirmation",
              admin_note: `proof_auto; OCR: ${verify.detail}`.slice(0, 500),
              ...(proofPath ? { payment_proof_path: proofPath } : {}),
            })
            .eq("id", orderId);

          await tg("sendMessage", {
            chat_id,
            text: m.receiptManualReview(displayNo, orderRow.fulfillment_kind === "physical"),
            reply_markup: await mainMenu(locale),
          });
          await notifyAdminNewOrder(orderId, proofFileId, proofKind, {
            reviewReason: verify.detail,
          });
          return;
        }

        await setState(from.id, {
          ...user.state,
          mode: "idle",
          pending_order_id: undefined,
          proof_auto: false,
        });

        await supabaseAdmin
          .from("orders")
          .update({
            status: "awaiting_payment",
            admin_note: `proof_auto; OCR ok amount=${verify.matchedAmount}`,
            payment_proof_hash: verify.proofHash,
            ...(proofPath ? { payment_proof_path: proofPath } : {}),
          })
          .eq("id", orderId);

        await tg("sendMessage", {
          chat_id,
          text: m.receiptVerifiedDelivering(displayNo, orderRow.fulfillment_kind === "physical"),
          reply_markup: await mainMenu(locale),
        });

        try {
          if (orderRow.fulfillment_kind === "physical") {
            const { acceptOrder, recordPayment } = await import("./fulfillment.server");
            const result = await acceptOrder(orderId);
            // ocrExpectedAmount уже посчитан выше той же amountDueNow() — то,
            // что реально проверил OCR, и есть то, что реально внесено.
            // !alreadyAccepted — не задваиваем при повторном срабатывании
            // (например, покупатель прислал тот же чек дважды), Блок 1,
            // находка 1.1.
            if (!result.alreadyAccepted) {
              const paid = await recordPayment(orderId, ocrExpectedAmount).catch((e) => {
                console.error("[bot] recordPayment failed", orderId, e);
                return false;
              });
              if (!paid) console.error("[bot] recordPayment returned false", orderId);
            }
          } else {
            const { deliverOrder } = await import("./orders.server");
            await deliverOrder(orderId);
          }
        } catch (e: unknown) {
          console.error("[bot] auto-deliver after proof failed", orderId, e);
          await supabaseAdmin
            .from("orders")
            .update({ status: "awaiting_confirmation" })
            .eq("id", orderId);
          await tg("sendMessage", {
            chat_id,
            text: m.deliveryFailedAfterOcr(displayNo, orderRow.fulfillment_kind === "physical"),
          });
          await notifyAdminNewOrder(orderId, proofFileId, proofKind, {
            reviewReason: "Ошибка выдачи после успешного OCR",
          });
          return;
        }
        // Уведомление админу — за пределами try выше (Блок 3, находка 3.3):
        // acceptOrder/recordPayment/deliverOrder к этому моменту уже
        // отработали успешно, и сбой одной лишь отправки Telegram-сообщения
        // (429/таймаут) не должен откатывать уже принятый и оплаченный
        // заказ обратно в "awaiting_confirmation" — раньше откатывал, весь
        // блок был одним try.
        await notifyAdminNewOrder(orderId, proofFileId, proofKind, { autoDelivered: true }).catch(
          (e) =>
            console.error("[bot] notifyAdminNewOrder failed after successful accept", orderId, e),
        );
        return;
      }

      await setState(from.id, {
        ...user.state,
        mode: "idle",
        pending_order_id: undefined,
        proof_auto: false,
      });

      // Manual path: await seller confirmation
      if (proofSaved && proofPath) {
        await supabaseAdmin
          .from("orders")
          .update({ payment_proof_path: proofPath, status: "awaiting_confirmation" })
          .eq("id", orderId);
      } else {
        await supabaseAdmin
          .from("orders")
          .update({ status: "awaiting_confirmation" })
          .eq("id", orderId);
      }

      if (proofSaved || proofFileId) {
        await tg("sendMessage", {
          chat_id,
          text: proofSaved
            ? m.receiptForwardedAwaitingConfirm(displayNo, orderRow.fulfillment_kind === "physical")
            : m.receiptForwardedNoStorage(displayNo),
          reply_markup: await mainMenu(locale),
        });
        await notifyAdminNewOrder(orderId, proofFileId, proofKind);
      } else {
        await tg("sendMessage", {
          chat_id,
          text: m.receiptSaveFailed(displayNo),
          reply_markup: await mainMenu(locale),
        });
        await notifyAdminNewOrder(orderId, null, null);
      }
      return;
    }

    // Способ получения физического заказа — текстовый фолбэк (Блок 4,
    // находка 4.4). Раньше у этого шага не было своего mode вовсе (см.
    // proceedToFulfillmentOrPlace), и покупатель, напечатавший "самовывоз"
    // вместо тапа по кнопке, улетал в общий поиск товара с сообщением
    // "ничего не найдено" — чекаут молча обрывался.
    if (user.state?.mode === "awaiting_fulfillment_type" && msg.text) {
      if (MENU_ACTIONS.has(canonicalMenuAction(msg.text) ?? "")) {
        await setState(from.id, { ...user.state, mode: "idle" });
        // Fallthrough to the main menu switch below
      } else {
        const { matchFulfillmentType } = await import("./direct-flow");
        const type = matchFulfillmentType(msg.text);
        if (!type) {
          await tg("sendMessage", { chat_id, text: m.fulfillmentTypePrompt });
          return;
        }
        const nextState = { ...user.state, checkout_fulfillment_type: type };
        await askFulfillmentDate(chat_id, from.id, nextState, locale);
        return;
      }
    }

    // Дата получения физического заказа (Ниши, Блок 8) — тот же escape hatch.
    if (user.state?.mode === "awaiting_fulfillment_date" && msg.text) {
      if (MENU_ACTIONS.has(canonicalMenuAction(msg.text) ?? "")) {
        await setState(from.id, { ...user.state, mode: "idle" });
        // Fallthrough to the main menu switch below
      } else {
        const {
          parseFulfillmentDateInput,
          maxLeadTimeDaysInCart,
          todayInAppTZ,
          addDaysToIsoDate,
          isoDateToDisplay,
        } = await import("./fulfillment.server");
        const iso = parseFulfillmentDateInput(msg.text);
        // Замороженная на шаге вопроса граница (Блок 4, находка 4.22) — не
        // пересчитываем заново, чтобы не отклонить дату, которую сам бот
        // только что назвал допустимой. Отсутствие в state — только для
        // уже начатых до этой правки чекаутов, которым некуда было её
        // положить; тогда считаем как раньше.
        const minIso =
          user.state?.checkout_min_fulfillment_date ??
          addDaysToIsoDate(todayInAppTZ(), await maxLeadTimeDaysInCart(from.id));
        if (!iso) {
          await tg("sendMessage", { chat_id, text: m.fulfillmentDateInvalid });
          return;
        }
        if (iso < minIso) {
          await tg("sendMessage", {
            chat_id,
            text: m.fulfillmentDateTooEarly(isoDateToDisplay(minIso)),
          });
          return;
        }
        const withDate = { ...user.state, checkout_fulfillment_at: iso };
        if (withDate.checkout_fulfillment_type === "delivery") {
          await proceedToDeliveryZoneOrAddress(chat_id, from.id, withDate, locale);
        } else {
          await setState(from.id, { ...withDate, mode: "awaiting_fulfillment_note" });
          await tg("sendMessage", {
            chat_id,
            text: m.fulfillmentNotePrompt,
            reply_markup: {
              inline_keyboard: [
                [{ text: m.fulfillmentNoteSkipBtn, callback_data: "fulfillnote:skip" }],
              ],
            },
          });
        }
        return;
      }
    }

    // Зона доставки — ждём тап по кнопке; текстом можно попасть только
    // названием зоны, набранным вручную (например, скопированным из другого
    // чата), иначе просто переспрашиваем список кнопок.
    if (user.state?.mode === "awaiting_delivery_zone" && msg.text) {
      if (MENU_ACTIONS.has(canonicalMenuAction(msg.text) ?? "")) {
        await setState(from.id, { ...user.state, mode: "idle" });
        // Fallthrough to the main menu switch below
      } else {
        const { activeDeliveryZones } = await import("./fulfillment.server");
        const { matchZone } = await import("./direct-flow");
        const zones = await activeDeliveryZones();
        // matchZone (Блок 4, находка 4.23) — тот же приём, что уже был у
        // Direct: понимает порядковый номер и совпадение по началу названия,
        // не только точное совпадение целиком.
        const matched = matchZone(msg.text, zones);
        const fullZone = matched ? zones.find((z) => z.id === matched.id) : null;
        if (fullZone) {
          const withZone = {
            ...user.state,
            checkout_delivery_zone_id: fullZone.id,
            checkout_delivery_zone_name: fullZone.name,
            checkout_delivery_fee: Number(fullZone.price),
            mode: "awaiting_address" as const,
          };
          await setState(from.id, withZone);
          await tg("sendMessage", { chat_id, text: m.addressPrompt });
        } else {
          await proceedToDeliveryZoneOrAddress(chat_id, from.id, user.state, locale);
        }
        return;
      }
    }

    // Адрес доставки физического заказа — тот же escape hatch.
    if (user.state?.mode === "awaiting_address" && msg.text) {
      if (MENU_ACTIONS.has(canonicalMenuAction(msg.text) ?? "")) {
        await setState(from.id, { ...user.state, mode: "idle" });
        // Fallthrough to the main menu switch below
      } else {
        const withAddress = {
          ...user.state,
          checkout_fulfillment_address: msg.text.trim().slice(0, 500),
          mode: "awaiting_fulfillment_note" as const,
        };
        await setState(from.id, withAddress);
        await tg("sendMessage", {
          chat_id,
          text: m.fulfillmentNotePrompt,
          reply_markup: {
            inline_keyboard: [
              [{ text: m.fulfillmentNoteSkipBtn, callback_data: "fulfillnote:skip" }],
            ],
          },
        });
        return;
      }
    }

    // Комментарий к физическому заказу (надпись на торте и т.п.) — необязателен,
    // кнопка «Без комментария» обрабатывается отдельно (fulfillnote:skip).
    if (user.state?.mode === "awaiting_fulfillment_note" && msg.text) {
      if (MENU_ACTIONS.has(canonicalMenuAction(msg.text) ?? "")) {
        await setState(from.id, { ...user.state, mode: "idle" });
        // Fallthrough to the main menu switch below
      } else {
        const countryCode = user.state?.country_code;
        if (!countryCode) {
          await askCountry(chat_id, from.id, true, locale);
          return;
        }
        const withNote = {
          ...user.state,
          checkout_fulfillment_note: msg.text.trim().slice(0, 500),
          mode: "idle" as const,
        };
        await setState(from.id, withNote);
        await placeOrder(chat_id, { ...user, state: withNote }, countryCode);
        return;
      }
    }

    // Ввод промокода — тот же escape hatch, что у search/awaiting_contact:
    // нажатие пункта меню не должно уйти в проверку кода буквально.
    if (user.state?.mode === "awaiting_promo_code" && msg.text) {
      if (MENU_ACTIONS.has(canonicalMenuAction(msg.text) ?? "")) {
        await setState(from.id, { ...user.state, mode: "idle" });
        // Fallthrough to the main menu switch below
      } else {
        const idleState = { ...user.state, mode: "idle" as const };
        const found = await findValidPromoCode(msg.text);
        if (!found.ok) {
          await setState(from.id, idleState);
          await tg("sendMessage", { chat_id, text: m.promoCodeInvalid });
          return showCart(chat_id, { ...user, state: idleState });
        }
        const withPromo = { ...idleState, promo_code: normalizePromoCode(msg.text) };
        await setState(from.id, withPromo);
        return showCart(chat_id, { ...user, state: withPromo });
      }
    }

    if (user.state?.mode === "awaiting_gift_certificate_code" && msg.text) {
      if (MENU_ACTIONS.has(canonicalMenuAction(msg.text) ?? "")) {
        await setState(from.id, { ...user.state, mode: "idle" });
        // Fallthrough to the main menu switch below
      } else {
        const idleState = { ...user.state, mode: "idle" as const };
        const found = await findValidGiftCertificate(msg.text);
        if (!found.ok) {
          await setState(from.id, idleState);
          await tg("sendMessage", { chat_id, text: m.giftCertificateInvalid });
          return showCart(chat_id, { ...user, state: idleState });
        }
        const withCert = {
          ...idleState,
          gift_certificate_code: normalizeGiftCertificateCode(msg.text),
        };
        await setState(from.id, withCert);
        return showCart(chat_id, { ...user, state: withCert });
      }
    }

    if (user.state?.mode === "awaiting_review_comment" && msg.text) {
      if (MENU_ACTIONS.has(canonicalMenuAction(msg.text) ?? "")) {
        await setState(from.id, { ...user.state, mode: "idle" });
        // Fallthrough to the main menu switch below
      } else {
        const productId = user.state.review_product_id;
        const { mode: _mode, review_product_id: _rpid, ...rest } = user.state;
        await setState(from.id, rest);
        if (productId) {
          const { updateReviewComment } = await import("./reviews.server");
          await updateReviewComment(from.id, productId, msg.text).catch(() => {});
        }
        await tg("sendMessage", { chat_id, text: m.reviewCommentSaved });
        return;
      }
    }

    // Search text input — same escape hatch as awaiting_contact above: a
    // menu button pressed while still in search mode used to be searched
    // for literally ("📚 Каталог" → "ничего не найдено") instead of acting
    // on it (Блок 4.3).
    if (user.state?.mode === "search" && msg.text) {
      if (MENU_ACTIONS.has(canonicalMenuAction(msg.text) ?? "")) {
        await setState(from.id, { ...user.state, mode: "idle" });
        // Fallthrough to the main menu switch below
      } else {
        return showSearch(chat_id, user, msg.text);
      }
    }

    const menuAction = canonicalMenuAction(msg.text);
    if (
      !user.state?.country_code &&
      menuAction &&
      ["📚 Каталог", "🔍 Поиск", "🛒 Корзина", "📋 Мои заказы"].includes(menuAction)
    ) {
      await askCountry(chat_id, from.id, false, locale);
      return;
    }

    // Main menu buttons
    switch (menuAction) {
      case "📚 Каталог":
        return showCategories(chat_id, null, user.state?.country_code, 0, locale);
      case "🔍 Поиск":
        await setState(from.id, { ...user.state, mode: "search" });
        await tg("sendMessage", {
          chat_id,
          text: m.searchTypePrompt,
        });
        return;
      case "🛒 Корзина":
        return showCart(chat_id, user);
      case "📋 Мои заказы":
        return showMyOrders(chat_id, from.id, locale);
      case "📖 Инструкция":
        return sendInstruction(chat_id, locale);
      case "ℹ️ Информация": {
        const base = originFromState();
        const { getCachedBotUrl } = await import("./bot-url.server");
        const [botUrl, referralOn] = await Promise.all([getCachedBotUrl(), hasModule("referral")]);
        await tg("sendMessage", {
          chat_id,
          text: m.infoHeader + m.infoRequiredDocs + legalConsentHtml(base, locale),
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: m.offerBtn, url: `${base}/legal/offer` }],
              [{ text: m.privacyBtn, url: `${base}/legal/privacy` }],
              [{ text: m.requisitesBtn, url: `${base}/legal/requisites` }],
              [{ text: m.aboutBtn, url: `${base}/legal/about` }],
              ...(botUrl && referralOn
                ? [[{ text: m.inviteFriendBtn, url: `${botUrl}?start=ref_${from.id}` }]]
                : []),
            ],
          },
          disable_web_page_preview: true,
        });
        return;
      }
      case "💬 Связаться с автором": {
        const s = await db();
        const { data: setting } = await s
          .from("app_settings")
          .select("value")
          .eq("key", "admin_contact_link")
          .maybeSingle();
        if (setting?.value) {
          await tg("sendMessage", {
            chat_id,
            text: m.contactUsePrefix(setting.value),
            disable_web_page_preview: true,
          });
        } else {
          await tg("sendMessage", { chat_id, text: m.contactsNotSet });
        }
        return;
      }
    }

    // Fallback
    await sendMain(chat_id, undefined, undefined, locale);
  } catch (e: unknown) {
    console.error("[bot] handleUpdate error", e);
  }
}

/** Создать или обновить покупателя Telegram — для Mini App и внешних входов. */
export async function ensureTelegramBotUser(from: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}) {
  return upsertUser(from);
}

/** Изменить количество позиции в корзине из Mini App. */
export async function miniAppUpdateCartQuantity(
  telegram_id: number,
  cart_item_id: string,
  quantity: number,
): Promise<"ok" | "not_found" | "digital_limit" | "out_of_stock" | "invalid" | "error"> {
  const qty = Math.floor(quantity);
  if (qty < 0 || qty > 99) return "invalid";
  const s = await db();
  const { data: row } = await s
    .from("cart_items")
    .select(
      "id, quantity, product_id, product_variant_id, products(fulfillment_kind, stock_quantity)",
    )
    .eq("id", cart_item_id)
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  if (!row?.id) return "not_found";
  const product = row.products as {
    fulfillment_kind?: string;
    stock_quantity?: number | null;
  } | null;
  if (!product) return "not_found";

  if (qty === 0) {
    await s.from("cart_items").delete().eq("id", cart_item_id);
    return "ok";
  }

  const kind = product.fulfillment_kind === "physical" ? "physical" : "digital";
  if (kind === "digital" && qty > 1) return "digital_limit";

  const currentQty = Number(row.quantity) || 0;
  if (qty < currentQty) {
    const { error } = await s.from("cart_items").update({ quantity: qty }).eq("id", cart_item_id);
    return error ? "error" : "ok";
  }
  if (qty === currentQty) return "ok";

  const delta = qty - currentQty;
  for (let i = 0; i < delta; i++) {
    const result = await addToCart(
      telegram_id,
      row.product_id as string,
      (row.product_variant_id as string | null) ?? null,
    );
    if (result === "ok") continue;
    if (result === "digital_limit" && qty === 1) break;
    if (result === "out_of_stock") return "out_of_stock";
    if (result === "digital_limit") return "digital_limit";
    return "error";
  }
  await s.from("cart_items").update({ quantity: qty }).eq("id", cart_item_id);
  return "ok";
}

export async function miniAppSetCountry(
  telegram_id: number,
  country_code: string,
): Promise<boolean> {
  const code = country_code.trim().toUpperCase();
  if (!code) return false;
  const s = await db();
  const { data: method } = await s
    .from("payment_methods")
    .select("country_code, country_name")
    .eq("country_code", code)
    .eq("is_active", true)
    .maybeSingle();
  if (!method) return false;
  const { data: existing } = await s
    .from("bot_users")
    .select("state")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  const prev =
    existing?.state && typeof existing.state === "object" && !Array.isArray(existing.state)
      ? (existing.state as NonNullable<BotUser["state"]>)
      : {};
  const countryChanged = prev.country_code && prev.country_code !== method.country_code;
  const nextState: NonNullable<BotUser["state"]> = {
    ...prev,
    country_code: method.country_code as string,
    country_name: method.country_name as string,
  };
  if (countryChanged) {
    delete nextState.checkout_fulfillment_type;
    delete nextState.checkout_fulfillment_at;
    delete nextState.checkout_min_fulfillment_date;
    delete nextState.checkout_fulfillment_address;
    delete nextState.checkout_fulfillment_note;
    delete nextState.checkout_delivery_zone_id;
    delete nextState.checkout_delivery_zone_name;
    delete nextState.checkout_delivery_fee;
  }
  await setState(telegram_id, nextState);
  return true;
}

export async function miniAppMergeState(
  telegram_id: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const s = await db();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: existing } = await s
      .from("bot_users")
      .select("state, updated_at")
      .eq("telegram_id", telegram_id)
      .maybeSingle();
    if (!existing) return;
    const prev =
      existing.state && typeof existing.state === "object" && !Array.isArray(existing.state)
        ? (existing.state as Record<string, unknown>)
        : {};
    const next = { ...prev, ...patch };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) delete next[key];
    }
    const { data: updated } = await s
      .from("bot_users")
      .update({ state: next as BotUser["state"] })
      .eq("telegram_id", telegram_id)
      .eq("updated_at", existing.updated_at)
      .select("telegram_id")
      .maybeSingle();
    if (updated) return;
  }
  throw new Error(`mini-app state update conflict for telegram_id=${telegram_id}`);
}

export type MiniAppDiscountSummary = {
  subtotal: number;
  promoCode: string | null;
  promoDiscount: number;
  pointsBalance: number;
  usePoints: boolean;
  pointsDiscount: number;
  giftCode: string | null;
  giftDiscount: number;
  total: number;
  couponsEnabled: boolean;
  loyaltyEnabled: boolean;
  giftsEnabled: boolean;
};

export async function miniAppCartDiscountSummary(
  telegram_id: number,
  subtotal: number,
): Promise<MiniAppDiscountSummary> {
  const s = await db();
  const { data: row } = await s
    .from("bot_users")
    .select("state, loyalty_points")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  const state =
    row?.state && typeof row.state === "object" && !Array.isArray(row.state)
      ? (row.state as BotUser["state"])
      : {};
  const couponsEnabled = await hasModule("coupons");
  const loyaltyEnabled = await hasModule("loyalty");
  const giftsEnabled = await hasModule("gift_certificates");

  const promoCode = couponsEnabled ? (state?.promo_code ?? null) : null;
  let promoDiscount = 0;
  if (promoCode) {
    const promo = await findValidPromoCode(promoCode);
    if (promo.ok) promoDiscount = computePromoDiscount(subtotal, promo.promo);
  }

  const pointsBalance = loyaltyEnabled ? Number(row?.loyalty_points ?? 0) : 0;
  const usePoints = loyaltyEnabled && state?.use_points === true;
  const pointsDiscount = usePoints
    ? computePointsDiscount(subtotal - promoDiscount, pointsBalance)
    : 0;

  const giftCode = giftsEnabled ? (state?.gift_certificate_code ?? null) : null;
  let giftDiscount = 0;
  if (giftCode) {
    const gift = await findValidGiftCertificate(giftCode);
    if (gift.ok) {
      giftDiscount = computeGiftCertificateDiscount(
        subtotal - promoDiscount - pointsDiscount,
        gift.certificate.amount,
      );
    }
  }

  return {
    subtotal,
    promoCode,
    promoDiscount,
    pointsBalance,
    usePoints,
    pointsDiscount,
    giftCode,
    giftDiscount,
    total: Math.max(0, subtotal - promoDiscount - pointsDiscount - giftDiscount),
    couponsEnabled,
    loyaltyEnabled,
    giftsEnabled,
  };
}

export async function miniAppUpdateDiscount(
  telegram_id: number,
  action:
    "promo_apply" | "promo_clear" | "gift_apply" | "gift_clear" | "points_use" | "points_clear",
  code?: string,
): Promise<"ok" | "invalid_code" | "module_disabled"> {
  const s = await db();
  const { data: row } = await s
    .from("bot_users")
    .select("state, loyalty_points")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  const state =
    row?.state && typeof row.state === "object" && !Array.isArray(row.state)
      ? { ...(row.state as NonNullable<BotUser["state"]>) }
      : {};

  if (action.startsWith("promo_")) {
    if (!(await hasModule("coupons"))) return "module_disabled";
    if (action === "promo_apply") {
      const normalized = normalizePromoCode(code ?? "");
      const found = await findValidPromoCode(normalized);
      if (!found.ok) return "invalid_code";
      state.promo_code = normalized;
    } else {
      delete state.promo_code;
    }
  } else if (action.startsWith("gift_")) {
    if (!(await hasModule("gift_certificates"))) return "module_disabled";
    if (action === "gift_apply") {
      const normalized = normalizeGiftCertificateCode(code ?? "");
      const found = await findValidGiftCertificate(normalized);
      if (!found.ok) return "invalid_code";
      state.gift_certificate_code = normalized;
    } else {
      delete state.gift_certificate_code;
    }
  } else {
    if (!(await hasModule("loyalty"))) return "module_disabled";
    if (action === "points_use" && Number(row?.loyalty_points ?? 0) <= 0) {
      return "invalid_code";
    }
    if (action === "points_use") state.use_points = true;
    else delete state.use_points;
  }

  await setState(telegram_id, state);
  return "ok";
}

export async function placeOrderForMiniApp(
  telegram_id: number,
  paymentMethod?: "robokassa" | "manual",
): Promise<MiniAppPlaceOrderResult> {
  const s = await db();
  const { data: row } = await s
    .from("bot_users")
    .select("*")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  if (!row) return { ok: false, error: "no_user" };
  const user = row as BotUser;
  const country_code = user.state?.country_code;
  if (!country_code) return { ok: false, error: "no_country" };
  const pendingOrderId = Number(user.state?.pending_order_id);
  if (pendingOrderId) {
    const { data: pending } = await s
      .from("orders")
      .select("status")
      .eq("id", pendingOrderId)
      .eq("telegram_id", telegram_id)
      .maybeSingle();
    if (pending?.status === "awaiting_payment") {
      const { count: cartCount } = await s
        .from("cart_items")
        .select("id", { count: "exact", head: true })
        .eq("telegram_id", telegram_id);
      if (cartCount) {
        return { ok: false, error: "pending_order_conflict" };
      }
      return completeMiniAppPayment(telegram_id, paymentMethod);
    }
  }

  if (!(await claimOrderPlacement(telegram_id))) {
    return { ok: false, error: "in_progress" };
  }

  const locale: Locale = user.state?.locale ?? "ru";
  try {
    const result = await placeOrderInner(
      telegram_id,
      user,
      country_code,
      telegram_id,
      locale,
      copy[locale],
      { miniApp: true, paymentMethod },
    );
    if (result) return result;
    return { ok: false, error: "unknown" };
  } catch (e) {
    console.error("[mini-app] placeOrderForMiniApp failed", e);
    await releaseOrderPlacement(telegram_id, user.state);
    return { ok: false, error: "error" };
  }
}

export type MiniAppPendingPayment = {
  orderId: number;
  displayNo: number;
  amountLabel: string;
};

export async function miniAppPendingPayment(
  telegram_id: number,
): Promise<MiniAppPendingPayment | null> {
  const s = await db();
  const { data: botUser } = await s
    .from("bot_users")
    .select("state")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  const state =
    botUser?.state && typeof botUser.state === "object" && !Array.isArray(botUser.state)
      ? (botUser.state as NonNullable<BotUser["state"]>)
      : {};
  const orderId = Number(state.pending_order_id);
  if (!orderId) return null;
  const { data: order } = await s
    .from("orders")
    .select("id, order_no, display_no, telegram_id, status, total, currency, fulfillment_kind")
    .eq("id", orderId)
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  if (!order || order.status !== "awaiting_payment") return null;
  const { amountDueNow } = await import("./fulfillment.server");
  const amountDue = await amountDueNow({
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const locale: Locale = state.locale ?? "ru";
  return {
    orderId,
    displayNo: order.display_no ?? order.order_no ?? orderId,
    amountLabel: await miniAppAmountLabel(
      amountDue,
      order.currency || "KZT",
      locale,
      Number(order.total),
    ),
  };
}

export async function cancelMiniAppPendingPayment(
  telegram_id: number,
): Promise<"ok" | "not_found" | "already_processed"> {
  const s = await db();
  const { data: botUser } = await s
    .from("bot_users")
    .select("state")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  const state =
    botUser?.state && typeof botUser.state === "object" && !Array.isArray(botUser.state)
      ? (botUser.state as NonNullable<BotUser["state"]>)
      : {};
  const orderId = Number(state.pending_order_id);
  if (!orderId) return "not_found";

  const { data: order } = await s
    .from("orders")
    .select(
      "id, status, promo_code, points_used, gift_certificate_code, order_items(product_id, quantity)",
    )
    .eq("id", orderId)
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  if (!order) return "not_found";
  if (order.status !== "awaiting_payment") return "already_processed";

  // Claim cancellation before restoring money-like resources. A concurrent
  // Robokassa callback can then no longer process this order as awaiting.
  const { data: cancelled } = await s
    .from("orders")
    .update({ status: "rejected", admin_note: "cancelled_by_customer" })
    .eq("id", orderId)
    .eq("status", "awaiting_payment")
    .select("id")
    .maybeSingle();
  if (!cancelled) return "already_processed";

  for (const item of order.order_items ?? []) {
    if (item.product_id) {
      await restoreStock(String(item.product_id), Number(item.quantity) || 0);
    }
  }

  let promo: { id: string; previousUsedCount: number } | null = null;
  if (order.promo_code) {
    const { data } = await s
      .from("promo_codes")
      .select("id, used_count")
      .eq("code", order.promo_code)
      .maybeSingle();
    if (data) {
      promo = {
        id: data.id,
        previousUsedCount: Math.max(0, Number(data.used_count) - 1),
      };
    }
  }
  let giftCertificateId: string | null = null;
  if (order.gift_certificate_code) {
    const { data } = await s
      .from("gift_certificates")
      .select("id")
      .eq("code", order.gift_certificate_code)
      .maybeSingle();
    giftCertificateId = data?.id ?? null;
  }
  await rollbackCheckoutRedemptions({
    telegram_id,
    promo,
    pointsUsed: Number(order.points_used) || 0,
    giftCertificateId,
    orderId,
  });
  await miniAppMergeState(telegram_id, {
    pending_order_id: undefined,
    pending_display_no: undefined,
    mode: "idle",
    proof_auto: undefined,
  });
  return "ok";
}

/**
 * Продолжить оплату уже созданного Mini App заказа.
 *
 * В KZ сначала создаётся заказ и очищается корзина, затем покупатель выбирает
 * Robokassa или реквизиты. Повторный placeOrderInner здесь недопустим:
 * корзина уже пуста, а заказ существует.
 */
export async function completeMiniAppPayment(
  telegram_id: number,
  paymentMethod?: "robokassa" | "manual",
): Promise<MiniAppPlaceOrderResult> {
  if (paymentMethod !== undefined && paymentMethod !== "robokassa" && paymentMethod !== "manual") {
    return { ok: false, error: "invalid_payment_method" };
  }

  const s = await db();
  const { data: botUser } = await s
    .from("bot_users")
    .select("*")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  if (!botUser) return { ok: false, error: "no_user" };
  const user = botUser as BotUser;
  const orderId = Number(user.state?.pending_order_id);
  if (!orderId) return { ok: false, error: "no_pending_order" };

  const { data: order } = await s
    .from("orders")
    .select(
      "id, order_no, display_no, telegram_id, status, total, currency, country_code, fulfillment_kind",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order || Number(order.telegram_id) !== telegram_id) {
    return { ok: false, error: "order_not_found" };
  }
  if (order.status !== "awaiting_payment") {
    return { ok: false, error: "order_already_processed" };
  }

  const displayNo = order.display_no ?? order.order_no ?? orderId;
  const { amountDueNow } = await import("./fulfillment.server");
  const amountDue = await amountDueNow({
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const currency = (order.currency as string) || "KZT";
  const locale: Locale = user.state?.locale ?? "ru";
  const amountLabel = await miniAppAmountLabel(amountDue, currency, locale, Number(order.total));
  const { data: method } = await s
    .from("payment_methods")
    .select("instructions, qr_code_path")
    .eq("country_code", order.country_code || "KZ")
    .maybeSingle();
  const instructions = (method?.instructions as string) || copy[locale].defaultInstructions;
  const rk = await loadRobokassaSettings();
  const cc = String(order.country_code ?? "").toUpperCase();
  if (!paymentMethod && user.state?.mode === "awaiting_proof") {
    paymentMethod = "manual";
  }
  if (!paymentMethod && cc === "KZ" && rk.ready) {
    return { ok: true, type: "choose_payment", amountLabel, orderId };
  }
  const effectivePayment =
    paymentMethod ?? (!rk.ready || isProofAutoOnlyCountry(cc) ? "manual" : "robokassa");

  if (effectivePayment === "manual") {
    const autoDeliver = rk.ready && (isProofAutoOnlyCountry(cc) || cc === "KZ");
    if (autoDeliver) {
      await s.from("orders").update({ admin_note: "proof_auto" }).eq("id", orderId);
    }
    await setState(telegram_id, {
      ...user.state,
      mode: "awaiting_proof",
      pending_order_id: orderId,
      pending_display_no: displayNo,
      proof_auto: autoDeliver,
    });
    const { imageUrl } = await import("./public-image");
    return {
      ok: true,
      type: "manual_proof",
      amountLabel,
      instructions,
      qrImageUrl: method?.qr_code_path ? imageUrl(method.qr_code_path as string) : undefined,
      orderId,
    };
  }

  const paymentUrl = await miniAppRobokassaUrl(orderId, displayNo, amountDue, currency, rk);
  if (!paymentUrl) return { ok: false, error: "robokassa_unavailable" };
  await setState(telegram_id, {
    ...user.state,
    mode: "awaiting_payment",
    pending_order_id: orderId,
    pending_display_no: displayNo,
    proof_auto: false,
  });
  return { ok: true, type: "robokassa", paymentUrl, amountLabel, orderId };
}

/** Добавить товар в корзину из Mini App — та же логика, что в чате. */
export async function miniAppAddToCart(
  telegram_id: number,
  product_id: string,
  product_variant_id?: string | null,
) {
  return addToCart(telegram_id, product_id, product_variant_id);
}

/** Показать корзину в чате после Mini App — оплата продолжается в боте. */
export async function miniAppOpenCartInChat(telegram_id: number) {
  const s = await db();
  const { data: row } = await s
    .from("bot_users")
    .select("*")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  if (!row) return { ok: false as const, reason: "no_user" };

  const { count } = await s
    .from("cart_items")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", telegram_id);
  if (!count) return { ok: false as const, reason: "empty_cart" };

  await showCart(telegram_id, row as BotUser);
  return { ok: true as const };
}
