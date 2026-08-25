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

/** Товар с картинками — снимок ровно тех полей, что показывает карточка (sendProductCard). */
type ProductCard = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string | null;
  country_prices: Json | null;
  product_images: Array<{ image_path: string; sort_order: number }> | null;
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
  state: {
    /**
     * Не полноценная машина состояний — просто типизированный набор
     * известных значений вместо голого string, чтобы опечатка в новом mode
     * ловилась tsc, а не тихо проваливалась в default-ветку где-то в
     * handleUpdate. Список — по факту использования в этом файле.
     */
    mode?:
      "idle" | "search" | "awaiting_contact" | "awaiting_payment" | "awaiting_proof" | "choose_pay";
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
    `📚 Каталог цифровых учебных материалов.\n` +
    `→ Выбор материалов и мгновенная выдача файлов после оплаты\n` +
    `→ Оплата картой / по реквизитам\n` +
    `→ Поддержка автора\n\n` +
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
      short_description:
        "Каталог материалов. Нажимая /start, вы принимаете оферту и политику конфиденциальности.".slice(
          0,
          120,
        ),
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
      greeting: string;
      catalog: string;
      payment: string;
      documents: string;
      hint: string;
    }
  > = {
    ru: {
      hello: "Привет",
      friend: "друг",
      greeting: "Добро пожаловать в магазин.",
      catalog: "Каталог учебных материалов",
      payment: "Оплата и выдача файлов",
      documents: "Документы и реквизиты — в «ℹ️ Информация»",
      hint: "Сначала выберите страну — или откройте «ℹ️ Информация».",
    },
    kk: {
      hello: "Сәлем",
      friend: "дос",
      greeting: "Дүкенге қош келдіңіз!",
      catalog: "Оқу материалдарының каталогы",
      payment: "Төлем және файлдарды алу",
      documents: "Құжаттар мен деректемелер — «ℹ️ Ақпарат» бөлімінде",
      hint: "Алдымен еліңізді таңдаңыз немесе «ℹ️ Ақпарат» бөлімін ашыңыз.",
    },
    en: {
      hello: "Hello",
      friend: "friend",
      greeting: "Welcome to the store!",
      catalog: "Learning materials catalog",
      payment: "Payment and file delivery",
      documents: "Documents and payment details are in “ℹ️ Information”",
      hint: "First choose your country, or open “ℹ️ Information”.",
    },
    uz: {
      hello: "Salom",
      friend: "do‘st",
      greeting: "Do‘konga xush kelibsiz!",
      catalog: "O‘quv materiallari katalogi",
      payment: "To‘lov va fayllarni yetkazib berish",
      documents: "Hujjatlar va to‘lov ma’lumotlari “ℹ️ Ma’lumot” bo‘limida",
      hint: "Avval mamlakatingizni tanlang yoki “ℹ️ Ma’lumot” bo‘limini oching.",
    },
  };
  const c = copy[locale];
  const name = firstName || c.friend;
  const hint = withCountryHint ? `\n\n${c.hint}` : "";
  return (
    `${c.hello}, ${escapeHtml(name)}! ${c.greeting}\n\n` +
    `→ ${c.catalog}\n→ ${c.payment}\n→ ${c.documents}\n\n` +
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
    | "languageSaved",
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
  descPending: string;
  productNotFound: string;
  contactSaved: string;
  cartEmpty: string;
  cartHeader: string;
  removeItem: (name: string) => string;
  total: (amount: string) => string;
  checkoutBtn: string;
  clearBtn: string;
  phonePromptHtml: string;
  shareContactBtn: string;
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
  afterProofAuto: string;
  afterProofManual: string;
  alreadyProcessed: (orderId: number | string) => string;
  robokassaUnavailable: string;
  searchNothingFound: string;
  foundCount: (n: number) => string;
  shownOf: (shown: number, total: number) => string;
  searchSessionExpired: string;
  addedToCart: string;
  productUnavailable: string;
  cartCleared: string;
  countrySaved: (countryName: string) => string;
  noOrdersYet: string;
  orderNotFound: string;
  myOrdersHeader: (list: string) => string;
  statusAwaitingPayment: string;
  statusAwaitingConfirmation: string;
  statusDelivering: string;
  statusDelivered: string;
  statusRejected: string;
  shareContactHint: string;
  phoneParseFail: string;
  sendReceiptPrompt: string;
  fileDownloadFail: string;
  notReceiptLike: (orderId: number | string) => string;
  receiptManualReview: (orderId: number | string) => string;
  receiptVerifiedDelivering: (orderId: number | string) => string;
  deliveryFailedAfterOcr: (orderId: number | string) => string;
  receiptForwardedAwaitingConfirm: (orderId: number | string) => string;
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
  contactsNotSet: string;
  contactUsePrefix: (link: string) => string;
  instructionComingSoon: string;
  instructionDefaultCaption: string;
  instructionVideoFail: string;
  idLabel: (id: number | string) => string;
  rejectedNotice: (orderId: number | string) => string;
  contactAuthorBtn: string;
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
    descPending: "Подробное описание уточняется у продавца.",
    productNotFound: "Товар не найден.",
    contactSaved: "✅ Номер сохранён.",
    cartEmpty: "🛒 Корзина пуста.",
    cartHeader: "🛒 <b>Ваша корзина:</b>\n\n",
    removeItem: (name) => `❌ Убрать «${name}»`,
    total: (amount) => `\n<b>Итого: ${amount}</b>`,
    checkoutBtn: "💳 Оформить заказ",
    clearBtn: "🗑 Очистить",
    phonePromptHtml:
      "Для оформления заказа укажите номер телефона — <b>просто напишите его в этот чат</b>, например:\n<code>+7 900 123-45-67</code>\n\nИли нажмите кнопку ниже, чтобы поделиться контактом автоматически.",
    shareContactBtn: "📱 Поделиться контактом",
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
    afterProofAuto:
      "После оплаты <b>пришлите чек</b> (фото или PDF) в этот чат — бот сразу отправит файлы.",
    afterProofManual:
      "После оплаты <b>пришлите скриншот</b> (фото) в этот чат — продавец проверит и пришлёт файлы.",
    alreadyProcessed: (id) => `Заказ #${id} уже обрабатывается или закрыт.`,
    robokassaUnavailable: "Robokassa временно недоступна. Выберите оплату по реквизитам.",
    searchNothingFound: "Ничего не нашлось. Попробуйте другое слово.",
    foundCount: (n) => `🔍 Найдено материалов: ${n}`,
    shownOf: (s, t) => `Показано ${s} из ${t}`,
    searchSessionExpired: "Сессия поиска устарела. Повторите поиск.",
    addedToCart: "✅ Добавлено в корзину.",
    productUnavailable: "⚠️ Этот материал сейчас недоступен. Выберите другой в каталоге.",
    cartCleared: "🗑 Корзина очищена.",
    countrySaved: (c) => `✅ Ваша страна сохранена: ${c}\nТеперь вы видите корректные цены!`,
    noOrdersYet: "У вас пока нет заказов.",
    orderNotFound: "Заказ не найден.",
    myOrdersHeader: (l) => `📋 Ваши заказы:\n\n${l}`,
    statusAwaitingPayment: "⏳ ожидает оплаты",
    statusAwaitingConfirmation: "🔎 проверяется",
    statusDelivering: "📤 выдаётся",
    statusDelivered: "✅ выдан",
    statusRejected: "❌ отклонён",
    shareContactHint:
      "Нажмите кнопку «📱 Поделиться контактом» внизу экрана или просто напишите номер телефона в чат.",
    phoneParseFail:
      "Не удалось распознать номер. Напишите телефон цифрами, например: <code>+79001234567</code> или <code>89001234567</code>",
    sendReceiptPrompt: "📨 Пришлите, пожалуйста, чек об оплате — фото или файл (например, PDF).",
    fileDownloadFail: "⚠️ Не удалось загрузить файл. Пришлите чек ещё раз — фото или PDF.",
    notReceiptLike: (id) =>
      `⚠️ Это не похоже на чек оплаты.\n\nПришлите, пожалуйста, скриншот перевода / чека с суммой заказа #${id}.`,
    receiptManualReview: (id) =>
      `📨 Чек получен по заказу #${id}, но автоматическая проверка не прошла.\nЗаказ отправлен продавцу на ручную проверку — файлы придут после подтверждения.`,
    receiptVerifiedDelivering: (id) => `📨 Спасибо! Чек проверен. Заказ #${id} — отправляю файлы…`,
    deliveryFailedAfterOcr: (id) =>
      `⚠️ Чек принят, но автоматическая выдача заказа #${id} не завершилась. Продавец проверит и отправит файлы.`,
    receiptForwardedAwaitingConfirm: (id) =>
      `📨 Спасибо! Чек получен. Заказ #${id} отправлен на проверку. Как только продавец подтвердит оплату — бот пришлёт файлы.`,
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
    contactsNotSet: "Контакты автора пока не указаны.",
    contactUsePrefix: (l) => `Для связи с автором используйте следующие контакты:\n${l}`,
    instructionComingSoon:
      "📖 Инструкция скоро появится.\nПока: «Каталог» или «Поиск» → корзина → оплата → чек или Robokassa. Файлы придут после оплаты.",
    instructionDefaultCaption:
      "📖 Как пользоваться ботом: каталог → корзина → оплата → чек. Файлы придут после оплаты (картой или по чеку).",
    instructionVideoFail: "⚠️ Не удалось загрузить видео инструкции. Напишите продавцу.",
    idLabel: (id) => `Ваш Telegram ID: ${id}`,
    rejectedNotice: (id) => `❌ Ваш заказ №${id} отклонён. Если это ошибка — напишите продавцу.`,
    contactAuthorBtn: "💬 Связаться с автором",
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
    descPending: "Толық сипаттаманы сатушыдан нақтылаңыз.",
    productNotFound: "Тауар табылмады.",
    contactSaved: "✅ Нөмір сақталды.",
    cartEmpty: "🛒 Себет бос.",
    cartHeader: "🛒 <b>Сіздің себетіңіз:</b>\n\n",
    removeItem: (name) => `❌ Алып тастау «${name}»`,
    total: (amount) => `\n<b>Барлығы: ${amount}</b>`,
    checkoutBtn: "💳 Тапсырыс беру",
    clearBtn: "🗑 Тазарту",
    phonePromptHtml:
      "Тапсырысты рәсімдеу үшін телефон нөміріңізді көрсетіңіз — <b>оны осы чатқа жазыңыз</b>, мысалы:\n<code>+7 900 123-45-67</code>\n\nНемесе контактіні автоматты түрде бөлісу үшін төмендегі батырманы басыңыз.",
    shareContactBtn: "📱 Контактімен бөлісу",
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
    afterProofAuto:
      "Төлемнен кейін <b>чекті осы чатқа жіберіңіз</b> (фото немесе PDF) — бот файлдарды бірден жібереді.",
    afterProofManual:
      "Төлемнен кейін <b>скриншотты осы чатқа жіберіңіз</b> (фото) — сатушы тексеріп, файлдарды жібереді.",
    alreadyProcessed: (id) => `Тапсырыс #${id} өңделуде немесе жабылған.`,
    robokassaUnavailable: "Robokassa уақытша қолжетімсіз. Деректемелер бойынша төлемді таңдаңыз.",
    searchNothingFound: "Ештеңе табылмады. Басқа сөзбен көріңіз.",
    foundCount: (n) => `🔍 Табылған материалдар: ${n}`,
    shownOf: (s, t) => `Көрсетілді ${s} / ${t}`,
    searchSessionExpired: "Іздеу сессиясы ескірді. Іздеуді қайталаңыз.",
    addedToCart: "✅ Себетке қосылды.",
    productUnavailable: "⚠️ Бұл материал қазір қолжетімді емес. Каталогтан басқасын таңдаңыз.",
    cartCleared: "🗑 Себет тазартылды.",
    countrySaved: (c) => `✅ Еліңіз сақталды: ${c}\nЕнді сіз дұрыс бағаларды көресіз!`,
    noOrdersYet: "Сізде әзірге тапсырыс жоқ.",
    orderNotFound: "Тапсырыс табылмады.",
    myOrdersHeader: (l) => `📋 Сіздің тапсырыстарыңыз:\n\n${l}`,
    statusAwaitingPayment: "⏳ төлем күтілуде",
    statusAwaitingConfirmation: "🔎 тексерілуде",
    statusDelivering: "📤 жіберілуде",
    statusDelivered: "✅ жіберілді",
    statusRejected: "❌ қабылданбады",
    shareContactHint:
      "Экранның төменгі жағындағы «📱 Контактімен бөлісу» батырмасын басыңыз немесе телефон нөмірін чатқа жазыңыз.",
    phoneParseFail:
      "Нөмірді тану мүмкін болмады. Телефонды сандармен жазыңыз, мысалы: <code>+79001234567</code> немесе <code>89001234567</code>",
    sendReceiptPrompt: "📨 Төлем чегін жіберіңіз — фото немесе файл (мысалы, PDF).",
    fileDownloadFail: "⚠️ Файлды жүктеу мүмкін болмады. Чекті қайта жіберіңіз — фото немесе PDF.",
    notReceiptLike: (id) =>
      `⚠️ Бұл төлем чегіне ұқсамайды.\n\n#${id} тапсырысының сомасы көрсетілген аударым/чек скриншотын жіберіңіз.`,
    receiptManualReview: (id) =>
      `📨 #${id} тапсырысы бойынша чек алынды, бірақ автоматты тексеру өтпеді.\nТапсырыс сатушыға қолмен тексеруге жіберілді — файлдар растаудан кейін келеді.`,
    receiptVerifiedDelivering: (id) =>
      `📨 Рақмет! Чек тексерілді. Тапсырыс #${id} — файлдарды жіберудемін…`,
    deliveryFailedAfterOcr: (id) =>
      `⚠️ Чек қабылданды, бірақ #${id} тапсырысын автоматты жіберу аяқталмады. Сатушы тексеріп, файлдарды жібереді.`,
    receiptForwardedAwaitingConfirm: (id) =>
      `📨 Рақмет! Чек алынды. Тапсырыс #${id} тексеруге жіберілді. Сатушы төлемді растаған бойда — бот файлдарды жібереді.`,
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
    contactsNotSet: "Автордың байланыс деректері әлі көрсетілмеген.",
    contactUsePrefix: (l) => `Автормен байланысу үшін мына деректерді пайдаланыңыз:\n${l}`,
    instructionComingSoon:
      "📖 Нұсқаулық жақында қосылады.\nӘзірге: «Каталог» немесе «Іздеу» → себет → төлем → чек немесе Robokassa. Файлдар төлемнен кейін келеді.",
    instructionDefaultCaption:
      "📖 Ботты қалай пайдалану керек: каталог → себет → төлем → чек. Файлдар төлемнен кейін келеді (картамен немесе чекпен).",
    instructionVideoFail: "⚠️ Нұсқаулық видеосын жүктеу мүмкін болмады. Сатушыға жазыңыз.",
    idLabel: (id) => `Сіздің Telegram ID: ${id}`,
    rejectedNotice: (id) =>
      `❌ Сіздің №${id} тапсырысыңыз қабылданбады. Бұл қате болса — сатушыға жазыңыз.`,
    contactAuthorBtn: "💬 Автормен байланысу",
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
    descPending: "Full description available on request from the seller.",
    productNotFound: "Product not found.",
    contactSaved: "✅ Number saved.",
    cartEmpty: "🛒 Your cart is empty.",
    cartHeader: "🛒 <b>Your cart:</b>\n\n",
    removeItem: (name) => `❌ Remove “${name}”`,
    total: (amount) => `\n<b>Total: ${amount}</b>`,
    checkoutBtn: "💳 Checkout",
    clearBtn: "🗑 Clear",
    phonePromptHtml:
      "To place your order, share your phone number — <b>just type it in this chat</b>, for example:\n<code>+7 900 123-45-67</code>\n\nOr tap the button below to share your contact automatically.",
    shareContactBtn: "📱 Share contact",
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
    afterProofAuto:
      "After payment, <b>send the receipt</b> (photo or PDF) in this chat — the bot will send the files right away.",
    afterProofManual:
      "After payment, <b>send a screenshot</b> (photo) in this chat — the seller will verify it and send the files.",
    alreadyProcessed: (id) => `Order #${id} is already being processed or closed.`,
    robokassaUnavailable:
      "Robokassa is temporarily unavailable. Please choose payment by bank details.",
    searchNothingFound: "Nothing found. Try a different word.",
    foundCount: (n) => `🔍 Materials found: ${n}`,
    shownOf: (s, t) => `Showing ${s} of ${t}`,
    searchSessionExpired: "Your search session has expired. Please search again.",
    addedToCart: "✅ Added to cart.",
    productUnavailable:
      "⚠️ This material is currently unavailable. Please pick another one from the catalog.",
    cartCleared: "🗑 Cart cleared.",
    countrySaved: (c) => `✅ Your country is saved: ${c}\nNow you’ll see the correct prices!`,
    noOrdersYet: "You don’t have any orders yet.",
    orderNotFound: "Order not found.",
    myOrdersHeader: (l) => `📋 Your orders:\n\n${l}`,
    statusAwaitingPayment: "⏳ awaiting payment",
    statusAwaitingConfirmation: "🔎 under review",
    statusDelivering: "📤 delivering",
    statusDelivered: "✅ delivered",
    statusRejected: "❌ rejected",
    shareContactHint:
      "Tap the “📱 Share contact” button at the bottom of the screen, or just type your phone number in the chat.",
    phoneParseFail:
      "Couldn’t recognize that number. Please type it as digits, e.g.: <code>+79001234567</code> or <code>89001234567</code>",
    sendReceiptPrompt: "📨 Please send the payment receipt — a photo or a file (e.g. PDF).",
    fileDownloadFail:
      "⚠️ Couldn’t download the file. Please send the receipt again — photo or PDF.",
    notReceiptLike: (id) =>
      `⚠️ This doesn’t look like a payment receipt.\n\nPlease send a screenshot of the transfer/receipt showing the amount for order #${id}.`,
    receiptManualReview: (id) =>
      `📨 Receipt received for order #${id}, but automatic verification failed.\nThe order was sent to the seller for manual review — files will arrive after confirmation.`,
    receiptVerifiedDelivering: (id) =>
      `📨 Thank you! Receipt verified. Order #${id} — sending files…`,
    deliveryFailedAfterOcr: (id) =>
      `⚠️ Receipt accepted, but automatic delivery of order #${id} didn’t complete. The seller will check and send the files.`,
    receiptForwardedAwaitingConfirm: (id) =>
      `📨 Thank you! Receipt received. Order #${id} sent for review. As soon as the seller confirms payment, the bot will send the files.`,
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
    contactsNotSet: "The author’s contact details haven’t been set yet.",
    contactUsePrefix: (l) => `To contact the author, use the following details:\n${l}`,
    instructionComingSoon:
      "📖 The guide is coming soon.\nFor now: “Catalog” or “Search” → cart → payment → receipt or Robokassa. Files arrive after payment.",
    instructionDefaultCaption:
      "📖 How to use the bot: catalog → cart → payment → receipt. Files arrive after payment (by card or receipt).",
    instructionVideoFail: "⚠️ Couldn’t load the instructional video. Please contact the seller.",
    idLabel: (id) => `Your Telegram ID: ${id}`,
    rejectedNotice: (id) =>
      `❌ Your order №${id} has been rejected. If this is a mistake, please contact the seller.`,
    contactAuthorBtn: "💬 Contact the author",
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
    descPending: "Batafsil tavsif sotuvchidan aniqlanadi.",
    productNotFound: "Mahsulot topilmadi.",
    contactSaved: "✅ Raqam saqlandi.",
    cartEmpty: "🛒 Savat bo‘sh.",
    cartHeader: "🛒 <b>Sizning savatingiz:</b>\n\n",
    removeItem: (name) => `❌ Olib tashlash «${name}»`,
    total: (amount) => `\n<b>Jami: ${amount}</b>`,
    checkoutBtn: "💳 Buyurtma berish",
    clearBtn: "🗑 Tozalash",
    phonePromptHtml:
      "Buyurtma berish uchun telefon raqamingizni kiriting — <b>uni shu chatga yozing</b>, masalan:\n<code>+7 900 123-45-67</code>\n\nYoki kontaktni avtomatik ulashish uchun quyidagi tugmani bosing.",
    shareContactBtn: "📱 Kontaktni ulashish",
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
    afterProofAuto:
      "To‘lovdan so‘ng <b>chekni shu chatga yuboring</b> (foto yoki PDF) — bot fayllarni darhol yuboradi.",
    afterProofManual:
      "To‘lovdan so‘ng <b>skrinshotni shu chatga yuboring</b> (foto) — sotuvchi tekshirib, fayllarni yuboradi.",
    alreadyProcessed: (id) => `Buyurtma #${id} allaqachon qayta ishlanmoqda yoki yopilgan.`,
    robokassaUnavailable:
      "Robokassa vaqtincha ishlamayapti. Rekvizitlar bo‘yicha to‘lovni tanlang.",
    searchNothingFound: "Hech narsa topilmadi. Boshqa so‘z bilan urinib ko‘ring.",
    foundCount: (n) => `🔍 Topilgan materiallar: ${n}`,
    shownOf: (s, t) => `Ko‘rsatildi ${s} / ${t}`,
    searchSessionExpired: "Qidiruv sessiyasi eskirdi. Qayta qidiring.",
    addedToCart: "✅ Savatga qo‘shildi.",
    productUnavailable: "⚠️ Bu material hozir mavjud emas. Katalogdan boshqasini tanlang.",
    cartCleared: "🗑 Savat tozalandi.",
    countrySaved: (c) => `✅ Mamlakatingiz saqlandi: ${c}\nEndi to‘g‘ri narxlarni ko‘rasiz!`,
    noOrdersYet: "Sizda hali buyurtmalar yo‘q.",
    orderNotFound: "Buyurtma topilmadi.",
    myOrdersHeader: (l) => `📋 Sizning buyurtmalaringiz:\n\n${l}`,
    statusAwaitingPayment: "⏳ to‘lov kutilmoqda",
    statusAwaitingConfirmation: "🔎 tekshirilmoqda",
    statusDelivering: "📤 yetkazilmoqda",
    statusDelivered: "✅ yetkazildi",
    statusRejected: "❌ rad etildi",
    shareContactHint:
      "Ekranning pastidagi «📱 Kontaktni ulashish» tugmasini bosing yoki telefon raqamini chatga yozing.",
    phoneParseFail:
      "Raqamni aniqlab bo‘lmadi. Telefon raqamini raqamlar bilan yozing, masalan: <code>+79001234567</code> yoki <code>89001234567</code>",
    sendReceiptPrompt: "📨 Iltimos, to‘lov chekini yuboring — foto yoki fayl (masalan, PDF).",
    fileDownloadFail: "⚠️ Faylni yuklab bo‘lmadi. Chekni qayta yuboring — foto yoki PDF.",
    notReceiptLike: (id) =>
      `⚠️ Bu to‘lov chekiga o‘xshamayapti.\n\n#${id} buyurtma summasi ko‘rsatilgan o‘tkazma/chek skrinshotini yuboring.`,
    receiptManualReview: (id) =>
      `📨 #${id} buyurtmasi uchun chek qabul qilindi, lekin avtomatik tekshiruv o‘tmadi.\nBuyurtma sotuvchiga qo‘lda tekshirish uchun yuborildi — fayllar tasdiqlangandan so‘ng keladi.`,
    receiptVerifiedDelivering: (id) =>
      `📨 Rahmat! Chek tekshirildi. Buyurtma #${id} — fayllar yuborilmoqda…`,
    deliveryFailedAfterOcr: (id) =>
      `⚠️ Chek qabul qilindi, lekin #${id} buyurtmasini avtomatik yetkazish yakunlanmadi. Sotuvchi tekshirib, fayllarni yuboradi.`,
    receiptForwardedAwaitingConfirm: (id) =>
      `📨 Rahmat! Chek qabul qilindi. Buyurtma #${id} tekshirishga yuborildi. Sotuvchi to‘lovni tasdiqlashi bilanoq bot fayllarni yuboradi.`,
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
    contactsNotSet: "Muallifning aloqa ma’lumotlari hali ko‘rsatilmagan.",
    contactUsePrefix: (l) =>
      `Muallif bilan bog‘lanish uchun quyidagi ma’lumotlardan foydalaning:\n${l}`,
    instructionComingSoon:
      "📖 Yo‘riqnoma tez orada qo‘shiladi.\nHozircha: «Katalog» yoki «Qidirish» → savat → to‘lov → chek yoki Robokassa. Fayllar to‘lovdan so‘ng keladi.",
    instructionDefaultCaption:
      "📖 Botdan qanday foydalanish kerak: katalog → savat → to‘lov → chek. Fayllar to‘lovdan so‘ng keladi (karta yoki chek orqali).",
    instructionVideoFail: "⚠️ Yo‘riqnoma videosini yuklab bo‘lmadi. Sotuvchiga yozing.",
    idLabel: (id) => `Sizning Telegram ID: ${id}`,
    rejectedNotice: (id) =>
      `❌ Sizning №${id} buyurtmangiz rad etildi. Agar bu xato bo‘lsa, sotuvchiga yozing.`,
    contactAuthorBtn: "💬 Muallif bilan bog‘lanish",
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
]);

function mainMenu(locale: Locale = "ru") {
  const c = botCopy[locale];
  return {
    keyboard: [
      [{ text: c.catalog }, { text: c.search }],
      [{ text: c.cart }, { text: c.myOrders }],
      [{ text: c.instruction }, { text: c.information }],
      [{ text: copy[locale].contactAuthorBtn }],
    ],
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
    reply_markup: mainMenu(locale),
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
    if (text === copy[locale].contactAuthorBtn) return "💬 Связаться с автором";
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
  const nextState = { ...user.state, locale, mode: "idle" as const };
  await setState(from_id, nextState);
  await tg("sendMessage", { chat_id, text: botCopy[locale].languageSaved });
  const base = originFromState();
  const needCountry = !nextState.country_code;
  await tg("sendMessage", {
    chat_id,
    text: welcomeStartHtml(user.first_name, needCountry, locale),
    parse_mode: "HTML",
    reply_markup: legalInlineKeyboard(base, locale),
    disable_web_page_preview: true,
  });
  await sendMain(chat_id, undefined, undefined, locale);
  if (!nextState.country_code) await askCountry(chat_id, from_id, false, locale);
  void syncBotPublicDescription();
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

  const caption = get("instruction_caption") || m.instructionDefaultCaption;
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
      text: m.instructionComingSoon,
      reply_markup: mainMenu(locale),
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
      reply_markup: mainMenu(locale),
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
    reply_markup: mainMenu(locale),
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
    .select("*, product_images(image_path, sort_order)")
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
  const money = await resolvePrice(p, userCountryCode ?? null);
  const displayPrice = money.amount;
  const displayCurrency = money.currency;

  const desc = p.description ? `\n\n${escapeHtml(p.description)}` : `\n\n<i>${m.descPending}</i>`;
  const caption = `📦 <b>${escapeHtml(p.name)}</b>${desc}\n\n💰 <b>${formatMoney(displayPrice, displayCurrency)}</b>`;
  const reply_markup = {
    inline_keyboard: [[{ text: m.addToCartBtn, callback_data: `add:${p.id}` }]],
  };

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
    .select("*, product_images(image_path, sort_order)")
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
    reply_markup: mainMenu(locale),
  });

  if (!user.state?.country_code) {
    await askCountry(chat_id, user.telegram_id, true, locale);
    return;
  }

  await placeOrder(chat_id, updatedUser, user.state.country_code);
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
) {
  if (text.length <= TELEGRAM_MESSAGE_MAX) {
    await tg("sendMessage", {
      chat_id,
      text,
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    return;
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
    await tg("sendMessage", {
      chat_id,
      text: chunks[i],
      parse_mode: "HTML",
      ...(isLast && replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }
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

async function sendCoverPreviews(adminChatId: string, displayNo: number, coverUrls: string[]) {
  if (coverUrls.length === 0) return;
  const shortCaption = `📦 <b>Материалы заказа #${displayNo}</b> (${coverUrls.length} шт.)`;
  for (let offset = 0; offset < coverUrls.length; offset += TELEGRAM_MEDIA_GROUP_MAX) {
    const batch = coverUrls.slice(offset, offset + TELEGRAM_MEDIA_GROUP_MAX);
    try {
      if (batch.length === 1) {
        await tg("sendPhoto", {
          chat_id: adminChatId,
          photo: batch[0],
          caption: offset === 0 ? shortCaption : undefined,
          parse_mode: "HTML",
        });
      } else {
        await tg("sendMediaGroup", {
          chat_id: adminChatId,
          media: batch.map((u, idx) => ({
            type: "photo",
            media: u,
            ...(offset === 0 && idx === 0 ? { caption: shortCaption, parse_mode: "HTML" } : {}),
          })),
        });
      }
    } catch (err) {
      console.error(`[bot] cover preview batch failed for order #${displayNo}`, err);
    }
    if (offset + TELEGRAM_MEDIA_GROUP_MAX < coverUrls.length) await sleep(300);
  }
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
 * Возвращает false, когда добавить не удалось: раньше покупатель видел
 * «✅ Добавлено в корзину» независимо от исхода, включая сбой вставки.
 */
async function addToCart(telegram_id: number, product_id: string): Promise<boolean> {
  const s = await db();

  const { data: product, error: productError } = await s
    .from("products")
    .select("id, is_active")
    .eq("id", product_id)
    .maybeSingle();
  if (productError) {
    console.error("[bot] addToCart: не удалось прочитать товар", product_id, productError);
    return false;
  }
  if (!product?.is_active) return false;

  const { data: existing } = await s
    .from("cart_items")
    .select("id, quantity")
    .eq("telegram_id", telegram_id)
    .eq("product_id", product_id)
    .maybeSingle();

  if (existing) {
    const { error } = await s
      .from("cart_items")
      .update({ quantity: (existing.quantity as number) + 1 })
      .eq("id", existing.id);
    if (error) {
      console.error("[bot] addToCart: не удалось увеличить количество", error);
      return false;
    }
    return true;
  }

  const { error } = await s.from("cart_items").insert({ telegram_id, product_id, quantity: 1 });
  if (error) {
    console.error("[bot] addToCart: не удалось добавить позицию", error);
    return false;
  }
  return true;
}

async function showCart(chat_id: number, user: BotUser) {
  const locale: Locale = user.state?.locale ?? "ru";
  const m = copy[locale];
  const telegram_id = user.telegram_id;
  const s = await db();
  const { data: items } = await s
    .from("cart_items")
    .select("id, quantity, products(id, name, price, currency, country_prices)")
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

    const money = await resolvePrice(p, user.state?.country_code ?? null);
    currency = money.currency;
    const line = Number(money.amount) * Number(it.quantity);
    total += line;
    text += `• ${escapeHtml(p.name)} × ${it.quantity} — ${formatMoney(line, currency)}\n`;
    buttons.push([{ text: m.removeItem(p.name), callback_data: `rem:${it.id}` }]);
  }
  text += m.total(formatMoney(total, currency));
  buttons.push([
    { text: m.checkoutBtn, callback_data: "checkout" },
    { text: m.clearBtn, callback_data: "clear" },
  ]);
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
  // user has contact and country, proceed to language choice or straight to placeOrder
  await proceedToLanguageOrPlace(chat_id, user, user.state.country_code);
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
  const {
    placing_order: _placing_order,
    checkout_lang_choice: _checkout_lang_choice,
    ...rest
  } = (state ?? {}) as NonNullable<BotUser["state"]>;
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
    await placeOrderInner(chat_id, user, country_code, telegram_id, locale, m);
  } catch (e: unknown) {
    console.error(`[bot] placeOrder failed for telegram_id=${telegram_id}`, e);
    await releaseOrderPlacement(telegram_id, user.state);
    await tg("sendMessage", {
      chat_id,
      text: "⚠️ Не удалось оформить заказ. Попробуйте ещё раз через минуту — если не получится, напишите продавцу.",
    }).catch(() => {});
  }
}

async function placeOrderInner(
  chat_id: number,
  user: BotUser,
  country_code: string,
  telegram_id: number,
  locale: Locale,
  m: (typeof copy)["ru"],
) {
  // Разовый выбор языка ДО оформления (см. proceedToLanguageOrPlace) — снят
  // сразу же, чтобы не протух в состоянии и не повлиял на следующий заказ:
  // все сообщения ниже (startManualProofPath и т.д.) берут за основу именно
  // user.state.
  const deliveryLangChoice: DeliveryLangChoice | null = user.state?.checkout_lang_choice ?? null;
  if (user.state?.checkout_lang_choice !== undefined) {
    const { checkout_lang_choice: _checkout_lang_choice, ...rest } = user.state;
    user = { ...user, state: rest };
  }

  const s = await db();
  const { data: method } = await s
    .from("payment_methods")
    .select("*")
    .eq("country_code", country_code)
    .maybeSingle();

  if (!method) {
    // Сохранённая страна покупателя (state.country_code переживает сессии,
    // см. setState) больше не соответствует ни одному способу оплаты —
    // продавец мог удалить её (payment-methods.functions.ts: удаление без
    // проверки зависимостей). Раньше это тихо проглатывалось: `method`
    // становился null, и заказ всё равно создавался — с заглушкой
    // `defaultInstructions` вместо реальных реквизитов, которую заплатить
    // было нельзя (Блок 2.4). Просим выбрать страну заново вместо того,
    // чтобы плодить безнадёжный заказ.
    await releaseOrderPlacement(telegram_id, user.state);
    await setState(telegram_id, { ...user.state, country_code: undefined });
    await tg("sendMessage", { chat_id, text: m.countryNoLongerAvailable });
    await askCountry(chat_id, telegram_id, true, locale);
    return;
  }

  const { data: items } = await s
    .from("cart_items")
    .select(
      "id, quantity, products(id, name, price, currency, file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz, country_prices, product_material_files(language, file_path, file_name, sort_order))",
    )
    .eq("telegram_id", telegram_id);
  if (!items?.length) {
    await tg("sendMessage", { chat_id, text: m.cartEmpty });
    await releaseOrderPlacement(telegram_id, user.state);
    return;
  }

  /**
   * Считаем общим расчётом — тем же, что показывал цены в каталоге и в корзине.
   *
   * Раньше здесь была третья копия тех же правил, и заказ мог разойтись с той
   * ценой, которую покупатель видел. Заодно цена за штуку считается один раз и
   * попадает и в итог, и в снимок позиции ниже.
   */
  const { resolvePrice } = await import("./pricing.server");
  const priced = new Map<string, number>();
  let total = 0;
  let currency = method?.currency || "KZT";
  for (const it of items) {
    if (!it.products) continue;
    const money = await resolvePrice(it.products, country_code);
    // "Все языки" — цена за позицию ×N, где N — сколько языков реально есть
    // у ЭТОГО товара (product-materials.ts deliveryPriceMultiplier).
    const multiplier = deliveryPriceMultiplier(
      deliveryLangChoice,
      availableMaterialLanguages(it.products).length,
    );
    const amount = money.amount * multiplier;
    currency = money.currency;
    priced.set(String(it.products.id), amount);
    total += amount * Number(it.quantity);
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
    })
    .select("*")
    .single();
  if (error || !order) {
    await tg("sendMessage", { chat_id, text: m.orderCreateFailed });
    await releaseOrderPlacement(telegram_id, user.state);
    return;
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
    await s.from("orders").delete().eq("id", order.id);
    await s.from("cart_items").delete().eq("telegram_id", telegram_id);
    await tg("sendMessage", { chat_id, text: m.cartEmpty });
    await releaseOrderPlacement(telegram_id, user.state);
    return;
  }

  const rows = await Promise.all(
    withProduct.map(async (it) => {
      // Ту же цену, что вошла в итог заказа: считать её второй раз незачем, а
      // разойтись они не должны.
      const displayPrice = priced.get(String(it.products?.id)) ?? Number(it.products?.price ?? 0);

      // Снимаем ВСЕ языки, какие у товара реально заведены (было только
      // ru/kk) — иначе купленный материал на en/uz долетит до выдачи пустым.
      const byLang: Record<string, ReturnType<typeof materialsForProduct>> = {};
      for (const lang of availableMaterialLanguages(it.products)) {
        byLang[lang] = materialsForProduct(it.products, lang);
      }

      return {
        order_id: order.id,
        product_id: it.products?.id,
        name_snapshot: it.products?.name,
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
    await s.from("orders").delete().eq("id", order.id);
    await tg("sendMessage", { chat_id, text: m.orderCreateFailed });
    await releaseOrderPlacement(telegram_id, user.state);
    return;
  }

  await s.from("cart_items").delete().eq("telegram_id", telegram_id);

  const rk = await loadRobokassaSettings();
  const cc = String(method?.country_code ?? country_code ?? "").toUpperCase();
  const instructions = (method?.instructions as string) || m.defaultInstructions;

  // Robokassa off (or misconfigured) → all countries: receipt + manual admin confirm
  if (!rk.ready) {
    await startManualProofPath({
      chat_id,
      telegram_id,
      userState: user.state,
      orderId: order.id as number,
      displayNo: order.display_no ?? order.order_no ?? order.id,
      total,
      currency,
      instructions,
      autoDeliver: false,
      locale,
      qrCodePath: method?.qr_code_path,
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
      total,
      currency,
      instructions,
      autoDeliver: true,
      locale,
      qrCodePath: method?.qr_code_path,
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
      total,
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
    total,
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
      "id, order_no, display_no, telegram_id, status, total, currency, country_code, country_name",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) throw new Error("Заказ не найден");
  if (order.status !== "awaiting_payment") {
    throw new Error(`Напомнить можно только заказам «Ждёт оплаты» (сейчас: ${order.status})`);
  }

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

  await tg("sendMessage", {
    chat_id,
    text: m.paymentReminder(displayNo, formatMoney(total, currency)),
    parse_mode: "HTML",
    reply_markup: mainMenu(locale),
  });

  const rk = await loadRobokassaSettings();

  if (!rk.ready) {
    await startManualProofPath({
      chat_id,
      telegram_id,
      userState,
      orderId,
      displayNo,
      total,
      currency,
      instructions,
      autoDeliver: false,
      reminder: true,
      locale,
      qrCodePath: method?.qr_code_path,
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
      total,
      currency,
      instructions,
      autoDeliver: true,
      reminder: true,
      locale,
      qrCodePath: method?.qr_code_path,
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
      total,
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
    total,
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

  const afterProof = params.autoDeliver ? m.afterProofAuto : m.afterProofManual;

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

async function notifyAdminNewOrder(
  orderId: number,
  proofFileId: string | null,
  proofKind: "photo" | "document" | null,
  options?: { autoDelivered?: boolean; reviewReason?: string },
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
  const displayNo = order.order_no ?? order.id;
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
  const summaryText =
    (autoDelivered
      ? `🆕 <b>Заказ #${displayNo}</b> — автовыдача по чеку\n\n`
      : reviewReason
        ? `🆕 <b>Заказ #${displayNo}</b> — нужна проверка чека\n\n`
        : `🆕 <b>Новый заказ #${displayNo}</b>\n\n`) +
    `👤 ${escapeHtml(order.display_name as string)}${order.username ? ` (@${escapeHtml(order.username)})` : ""}
📞 ${escapeHtml((order.contact as string) || "—")}
🌍 ${escapeHtml((order.country_name as string) || "—")}
📦 Позиций: ${items.length}

💰 <b>Итого: ${order.total} ${order.currency}</b>` +
    (autoDelivered
      ? `\n\n⚡ Файлы выданы автоматически после проверки чека (OCR).`
      : reviewReason
        ? `\n\n⚠️ <b>Причина:</b> ${escapeHtml(reviewReason)}`
        : "");

  const itemsMessage =
    items.length > 0
      ? `📋 <b>Состав заказа #${displayNo}</b>\n\n${items.map((i) => `• ${escapeHtml(i.name_snapshot)} × ${i.quantity} — ${i.price_snapshot} ${order.currency}`).join("\n")}`
      : "";

  const reply_markup = autoDelivered
    ? undefined
    : {
        inline_keyboard: [
          [
            { text: "✅ Подтвердить и выдать", callback_data: `confirm:${order.id}` },
            { text: "❌ Отклонить", callback_data: `reject:${order.id}` },
          ],
        ],
      };

  for (const adminChatId of adminIds) {
    // 1) Главное: краткое уведомление с кнопками — отдельно от превью и чека.
    try {
      await tg("sendMessage", {
        chat_id: adminChatId,
        text: summaryText,
        parse_mode: "HTML",
        ...(reply_markup ? { reply_markup } : {}),
      });
    } catch (err) {
      console.error(`[bot] failed to notify admin ${adminChatId} (summary)`, err);
    }

    // 2) Полный список позиций — отдельным сообщением (без лимита caption 1024).
    if (itemsMessage) {
      try {
        await sendLongHtmlMessage(adminChatId, itemsMessage);
      } catch (err) {
        console.error(`[bot] failed to notify admin ${adminChatId} (items list)`, err);
      }
    }

    // 3) Чек оплаты — короткая подпись, без длинного списка товаров.
    const proofCaption = `🧾 <b>Чек оплаты — заказ #${displayNo}</b>`;
    try {
      if (proofFileId && proofKind === "document") {
        await tg("sendDocument", {
          chat_id: adminChatId,
          document: proofFileId,
          caption: proofCaption,
          parse_mode: "HTML",
        });
      } else if (proofFileId) {
        await tg("sendPhoto", {
          chat_id: adminChatId,
          photo: proofFileId,
          caption: proofCaption,
          parse_mode: "HTML",
        });
      } else {
        await tg("sendMessage", {
          chat_id: adminChatId,
          text: `${proofCaption}\n\n⚠️ <b>Чек не удалось получить автоматически</b> — запросите у покупателя.`,
          parse_mode: "HTML",
        });
      }
    } catch (err) {
      console.error(`[bot] failed to notify admin ${adminChatId} (proof)`, err);
    }

    // 4) Превью обложек — опционально, батчами по 10 (лимит Telegram).
    try {
      await sendCoverPreviews(adminChatId, displayNo as number, coverUrls);
    } catch (err) {
      console.error(`[bot] failed to notify admin ${adminChatId} (covers)`, err);
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
    .select("*, product_images(image_path, sort_order)")
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
  const visible = (data ?? []).filter((p) => {
    const catIds = (p.category_ids as string[] | null) ?? [];
    return catIds.length === 0 || catIds.some((id) => !hiddenIds.has(id));
  });

  // Запоминаем запрос для пагинации (callback_data ограничена 64 байтами,
  // поэтому сам запрос в payload не кладём, а храним в state).
  await setState(telegram_id, { ...user.state, mode: "idle", last_search: query });

  if (!visible.length) {
    await tg("sendMessage", { chat_id, text: m.searchNothingFound });
    return;
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

async function showMyOrders(chat_id: number, telegram_id: number, locale: Locale = "ru") {
  const m = copy[locale];
  const s = await db();
  const { data } = await s
    .from("orders")
    .select("id, order_no, status, total, currency, created_at")
    .eq("telegram_id", telegram_id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (!data?.length) {
    await tg("sendMessage", { chat_id, text: m.noOrdersYet });
    return;
  }
  const statusMap: Record<string, string> = {
    awaiting_payment: m.statusAwaitingPayment,
    awaiting_confirmation: m.statusAwaitingConfirmation,
    delivering: m.statusDelivering,
    delivered: m.statusDelivered,
    rejected: m.statusRejected,
  };
  const text = data
    .map(
      (o) =>
        `#${o.order_no ?? o.id} — ${o.total} ${o.currency} — ${statusMap[o.status as string] || o.status}`,
    )
    .join("\n");
  await tg("sendMessage", { chat_id, text: m.myOrdersHeader(text) });
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
          .select("id, order_no, display_no, telegram_id, status, total, currency, country_code")
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
            total: Number(order.total),
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
          total: Number(order.total),
          currency: (order.currency as string) || "KZT",
          instructions: (method?.instructions as string) || m.defaultInstructions,
          autoDeliver: true,
          locale,
          qrCodePath: method?.qr_code_path,
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
        const added = await addToCart(from_id, data.slice(4));
        await tg("sendMessage", { chat_id, text: added ? m.addedToCart : m.productUnavailable });
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
        return proceedToLanguageOrPlace(chat_id, user, data.slice(8));

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
        if (cq.message?.message_id) {
          await tg("editMessageReplyMarkup", {
            chat_id,
            message_id: cq.message.message_id,
            reply_markup: { inline_keyboard: [] },
          });
        }
        // Админу показываем сквозной номер этого бота, а не внутренний id.
        const { data: ordRow } = await (
          await db()
        )
          .from("orders")
          .select("order_no")
          .eq("id", orderId)
          .maybeSingle();
        const shownNo = ordRow?.order_no ?? orderId;
        await tg("sendMessage", { chat_id, text: `⏳ Выдаю заказ #${shownNo}...` });
        const { deliverOrder } = await import("./orders.server");
        try {
          const result = await deliverOrder(orderId);
          if (result.alreadyDelivered) {
            await tg("sendMessage", {
              chat_id,
              text: `ℹ️ Заказ #${shownNo} уже выдаётся или выдан.`,
            });
          } else if ("pending" in result && result.pending) {
            await tg("sendMessage", {
              chat_id,
              text: `📤 Заказ #${shownNo}: отправлено ${result.sent} из ${result.total}. Продолжаю рассылку — нажмите «Продолжить выдачу» в панели или подождите крон.`,
            });
          } else if (result.manualRequired) {
            await tg("sendMessage", {
              chat_id,
              text: `⚠️ Заказ #${shownNo} обработан, но часть материалов нужно выслать вручную — проверьте панель.`,
            });
          } else {
            await tg("sendMessage", { chat_id, text: `✅ Заказ #${shownNo} выдан.` });
          }
        } catch (e: unknown) {
          await tg("sendMessage", { chat_id, text: `Ошибка: ${errorMessage(e)}` });
        }
        return;
      }
      if (data.startsWith("reject:")) {
        if (!(await requireShopAdmin(from_id, chat_id))) return;
        const orderId = Number(data.slice(7));
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
    if (msg.text === "/start") {
      await setState(from.id, { ...user.state, mode: "idle" });

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
      const { hasModule } = await import("./modules/modules.server");
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
        .select("id, display_no, status, admin_note, country_code, telegram_id, total, currency")
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
        orderRow.status === "delivering"
      ) {
        await tg("sendMessage", {
          chat_id,
          text: m.alreadyProcessed(displayNo),
          reply_markup: mainMenu(locale),
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
        const verify: ReceiptVerifyResult = (await hasModule("receipt_ocr"))
          ? await verifyPaymentReceipt({
              bytes: dl.bytes,
              mime: dl.mime || (fileExt === "pdf" ? "application/pdf" : "image/jpeg"),
              expectedAmount: Number(orderRow.total),
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
            text: m.receiptManualReview(displayNo),
            reply_markup: mainMenu(locale),
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
          text: m.receiptVerifiedDelivering(displayNo),
          reply_markup: mainMenu(locale),
        });

        try {
          const { deliverOrder } = await import("./orders.server");
          await deliverOrder(orderId);
          await notifyAdminNewOrder(orderId, proofFileId, proofKind, { autoDelivered: true });
        } catch (e: unknown) {
          console.error("[bot] auto-deliver after proof failed", orderId, e);
          await supabaseAdmin
            .from("orders")
            .update({ status: "awaiting_confirmation" })
            .eq("id", orderId);
          await tg("sendMessage", {
            chat_id,
            text: m.deliveryFailedAfterOcr(displayNo),
          });
          await notifyAdminNewOrder(orderId, proofFileId, proofKind, {
            reviewReason: "Ошибка выдачи после успешного OCR",
          });
        }
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
            ? m.receiptForwardedAwaitingConfirm(displayNo)
            : m.receiptForwardedNoStorage(displayNo),
          reply_markup: mainMenu(locale),
        });
        await notifyAdminNewOrder(orderId, proofFileId, proofKind);
      } else {
        await tg("sendMessage", {
          chat_id,
          text: m.receiptSaveFailed(displayNo),
          reply_markup: mainMenu(locale),
        });
        await notifyAdminNewOrder(orderId, null, null);
      }
      return;
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
