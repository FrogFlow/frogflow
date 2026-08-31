import {
  sendZernioInboxMessage,
  type ZernioDmButton,
  type ZernioWebhookMessagePayload,
} from "./zernio.server";
import { isZernioPlatform, PLATFORM_LABEL, type ZernioPlatform } from "./zernio-platform";
import { imageUrl } from "./public-image";
import crypto from "node:crypto";
import { logger, truncate } from "./logger.server";
import { localeNames, SUPPORTED_LOCALES, type Locale } from "./i18n";
import type { Json, TablesUpdate } from "@/integrations-supabase/types";
import type { DirectMode } from "./direct-flow";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

// The legacy cart/order schema uses bot_users.telegram_id as its customer key.
// Reserve negative, deterministic IDs for Zernio channels so a Direct or
// WhatsApp customer can safely use the same cart and order tables without
// colliding with Telegram.
//
// Хеш считается от userKey, а тот уже несёт префикс канала (`ig_` / `wa_`),
// так что один и тот же номер в двух каналах даёт разные идентификаторы сам
// собой — формулу под второй канал менять не пришлось.
function zernioCustomerId(userKey: string): number {
  const hex = crypto.createHash("sha256").update(userKey).digest("hex").slice(0, 13);
  return -parseInt(hex, 16);
}

/**
 * Текст выбора языка для нового покупателя Instagram Direct.
 *
 * У Direct нет команды `/start`, а значит нет и естественной точки, где, как в
 * Telegram-боте, предложить выбор языка. Решение: показываем этот список первым
 * же ответом новому отправителю — до чего бы то ни было ещё — и тем же текстом
 * отвечаем на явный повторный вызов («язык» / «тіл» / «til» / «language», см.
 * matchDirectCommand в direct-flow.ts).
 *
 * Текст пишем сразу на всех четырёх языках: до выбора язык покупателя ещё не
 * известен, показывать его на одном языке было бы гаданием. Кнопки здесь не
 * годятся — у Instagram их максимум три на сообщение, а языков четыре (то же
 * ограничение, что не даёт показать кнопками список стран, см. matchCountry в
 * direct-flow.ts). Пронумерованный текст работает и в папке «Запросы
 * сообщений», куда попадает весь трафик от неподписчиков — то есть
 * практически все новые покупатели из Direct.
 */
function languagePickerText(): string {
  const lines = SUPPORTED_LOCALES.map((locale, index) => `${index + 1}. ${localeNames[locale]}`);
  return (
    "Выберите язык / Тілді таңдаңыз / Tilni tanlang / Choose language:\n\n" +
    `${lines.join("\n")}\n\n` +
    "Ответьте номером. / Нөмірімен жауап беріңіз. / Raqami bilan javob bering. / Reply with the number."
  );
}

/**
 * Словарь ответов покупателю Instagram Direct.
 *
 * Тот же приём, что у `botCopy` в bot.server.ts, только локально: Direct —
 * отдельный канал со своим сценарием, и держать его словарь при себе, а не в
 * общем i18n.ts, соответствует тому, как Telegram-бот держит свой.
 *
 * Часть подсказок называет конкретное слово, которое нужно написать боту —
 * «отмена», «убрать 018». Эти слова разбирают isCancel и parseRemoveCommand в
 * direct-flow.ts, а их список — русский и трогать его здесь нельзя (это была
 * бы смена логики, а не перевод). Поэтому в переводах вместо русских слов
 * подсказки используют то, что эти же функции и так понимают вне зависимости
 * от языка: «/stop» есть прямо в списке CANCEL_WORDS, а «-018» (дефис перед
 * номером) parseRemoveCommand принимает наравне с «убрать 018» — это просто
 * другой из уже поддерживаемых вариантов записи той же команды, а не новый.
 */
type OrderStatusKey =
  "awaiting_confirmation" | "awaiting_payment" | "delivering" | "delivered" | "rejected";

interface DirectCopy {
  languageSaved: string;
  greetingFull: (name: string) => string;
  greetingShort: string;
  catalogIntro: string;
  catalogNumberHint: string;
  catalogBotLink: (link: string) => string;
  searchNoResults: (query: string, link: string) => string;
  searchFoundCount: (n: number) => string;
  /**
   * Дальше — тексты каталога-списка. Он есть только в WhatsApp: в Instagram
   * на сообщение три кнопки и нет списков, поэтому там каталог остаётся
   * текстовым, со ссылкой на Telegram-бота (catalogBotLink выше).
   *
   * Ссылки на Telegram здесь нет намеренно. В Instagram она осмысленна — бот
   * не может ни показать каталог целиком, ни отдать файл. WhatsApp умеет и
   * то и другое, и уводить оттуда покупателя, который уже готов платить, —
   * значит терять его на лишнем шаге.
   */
  catalogEmpty: string;
  catalogPick: string;
  catalogSectionCategories: string;
  catalogSectionProducts: string;
  catalogMore: string;
  catalogBack: string;
  catalogOpenBtn: string;
  /** Ничего не найдено — вариант без ссылки на другой бот. */
  searchNoResultsHere: (query: string) => string;
  btnCatalog: string;
  btnAddToCart: string;
  /** Товар с вариантами (Ниши, Блок D) в выдаче поиска Instagram — ведёт на полную карточку вместо прямого добавления, там варианты и цена. */
  btnChooseVariant: string;
  btnCart: string;
  btnCheckout: string;
  productUnavailable: string;
  productNoFiles: (name: string) => string;
  productMixedCart: (name: string) => string;
  cartEmptyHint: string;
  /** Заголовок «В заказе:» перед списком строк корзины на шаге выбора страны. */
  orderCartHeader: string;
  cartHeader: (count: number) => string;
  cartTotal: (total: number, currency: string) => string;
  cartHintMulti: string;
  cartHintSingle: string;
  noOrders: string;
  ordersHeader: string;
  orderLine: (no: number | string, total: number, currency: string, statusLabel: string) => string;
  orderStatus: Record<OrderStatusKey, string>;
  checkoutGiveUp: string;
  checkoutNeedNumber: string;
  noPaymentMethods: string;
  noRequisitesForCountry: string;
  cartEmptiedRestart: string;
  mixedCurrencySplit: string;
  rememberedCountryNote: (name: string) => string;
  /**
   * Чекаут физического заказа (Ниши, Блок 8.3) — идут между выбором страны
   * и amountDue/sendProofHint, только для physical-корзины.
   */
  fulfillmentTypePrompt: string;
  fulfillmentTypePickupBtn: string;
  fulfillmentTypeDeliveryBtn: string;
  /** Промах текстового fallback на шаге выбора способа — своя, у Telegram нет: там способ только кнопкой. */
  fulfillmentTypeHint: string;
  fulfillmentDatePrompt: (minDate: string) => string;
  fulfillmentDateInvalid: string;
  fulfillmentDateTooEarly: (minDate: string) => string;
  /** Заголовок над кнопками зон, когда их ≤3 (Ниши, Блок B) — нумерованный список для остальных случаев печатает renderDeliveryZonePrompt. */
  deliveryZonePrompt: string;
  /** Промах текстового fallback на шаге выбора зоны — тот же приём, что countryHint. */
  deliveryZoneHint: string;
  /** Промах текстового fallback на шаге выбора варианта товара (Ниши, Блок D) — свыше трёх вариантов, где кнопок уже не хватает. */
  variantChoiceHint: string;
  fulfillmentAddressPrompt: string;
  fulfillmentNotePrompt: string;
  fulfillmentNoteSkipBtn: string;
  amountDue: (amount: number, currency: string) => string;
  sendProofHint: string;
  cancelled: string;
  complaintAck: string;
  removeNothing: string;
  removeNotFound: (number: string, list: string) => string;
  removedCartEmpty: (name: string) => string;
  removed: (name: string) => string;
  awaitingProofHint: string;
  receiptProcessing: string;
  receiptSaveFailed: string;
  orderCreateFailed: string;
  receiptReceivedKnownEmail: (displayNo: number | string, email: string) => string;
  receiptReceivedAskEmailOptional: (displayNo: number | string, email: string) => string;
  receiptReceivedNeedEmail: (displayNo: number | string) => string;
  receiptReceivedWhatsApp: (displayNo: number | string) => string;
  countryHint: string;
  emailStepGotReceipt: string;
  emailHint: string;
  emailSaved: (email: string) => string;
  strayAttachmentAck: string;
  ambiguousProduct: (number: string, names: string) => string;
  productNotFound: (number: string) => string;
  addedSingle: (name: string, priceLine: string) => string;
  addedMulti: (name: string, priceLine: string, count: number, list: string) => string;
  addedFooter: string;
  affirmativeReply: string;
  dismissalReply: string;
}

const directCopy: Record<Locale, DirectCopy> = {
  ru: {
    languageSaved: "✅ Язык сохранён.",
    greetingFull: (name) =>
      `Здравствуйте, ${name}! 👋\n\n` +
      "Передал ваш вопрос продавцу — он ответит здесь же.\n\n" +
      "Если хотите что-то купить прямо сейчас, напишите номер товара из публикации — например «196».",
    greetingShort: "Передал ваш вопрос продавцу — он ответит здесь же.",
    catalogIntro: "Здесь можно оформить заказ по номеру материала.",
    catalogNumberHint:
      "Напишите номер из публикации — например «018», — и я подскажу, как оплатить.",
    catalogBotLink: (link) =>
      `А чтобы посмотреть весь каталог, поискать по теме и получить файлы, заходите в наш бот: ${link}`,
    searchNoResults: (query, link) =>
      `По запросу «${query}» ничего не найдено. Попробуйте другое слово или откройте каталог в нашем боте: ${link}`,
    searchFoundCount: (n) => `🔎 Нашли ${n} вариантов:`,
    catalogEmpty: "Каталог пока пуст — товары ещё не добавлены. Напишите продавцу, он подскажет.",
    catalogPick: "Выберите из каталога:",
    catalogSectionCategories: "Разделы",
    catalogSectionProducts: "Товары",
    catalogMore: "➡️ Показать ещё",
    catalogBack: "⬆️ Назад",
    catalogOpenBtn: "Открыть каталог",
    searchNoResultsHere: (query) =>
      `По запросу «${query}» ничего не найдено. Попробуйте другое слово или откройте каталог.`,
    btnCatalog: "Каталог",
    btnAddToCart: "Добавить в корзину",
    btnChooseVariant: "Выбрать вариант",
    btnCart: "Корзина",
    btnCheckout: "Оформить заказ",
    productUnavailable: "Этот материал больше недоступен.",
    productNoFiles: (name) =>
      `«${name}» сейчас недоступен для скачивания. Продавец подскажет, когда он появится.`,
    productMixedCart: (name) =>
      `«${name}» нельзя добавить вместе с тем, что уже в заказе, — разные типы товара. Оформите текущий заказ или очистите корзину.`,
    cartEmptyHint:
      "В заказе пока ничего нет. Напишите номер материала из публикации — например «018».",
    orderCartHeader: "В заказе:",
    cartHeader: (count) => `В заказе ${count === 1 ? "материал" : `${count} материала`}:`,
    cartTotal: (total, currency) => `Итого: ${total} ${currency}`,
    cartHintMulti: "Можно добавить ещё номер или убрать лишнее — напишите «убрать 018».\n",
    cartHintSingle: "Можно добавить ещё — напишите следующий номер.\n",
    noOrders: "У вас пока нет заказов. 📋",
    ordersHeader: "📋 Ваши заказы:\n\n",
    orderLine: (no, total, currency, statusLabel) =>
      `Заказ #${no} — ${total} ${currency} [${statusLabel}]\n`,
    orderStatus: {
      awaiting_confirmation: "⏳ Проверяем оплату",
      awaiting_payment: "⏳ Ожидает оплаты",
      delivering: "📤 Отправляем материалы",
      delivered: "✅ Материалы отправлены на почту",
      rejected: "❌ Отклонён",
    },
    checkoutGiveUp:
      "Похоже, я не помогаю — не буду мешать. Продавец увидит переписку и ответит сам.",
    checkoutNeedNumber:
      "Чтобы оформить заказ, сначала напишите номер материала из публикации — например «018».\n\n" +
      "Я посчитаю сумму и пришлю реквизиты.",
    noPaymentMethods: "Реквизиты для оплаты пока не заведены. Продавец свяжется с вами.",
    noRequisitesForCountry:
      "Для этой страны реквизиты пока не заведены. Продавец свяжется с вами и подскажет, как оплатить.",
    cartEmptiedRestart: "Корзина опустела. Напишите номер материала, и начнём заново.",
    mixedCurrencySplit:
      "В заказе материалы в разных валютах — оформите их по отдельности.\n\n" +
      "Напишите «отмена», а потом номер одного материала.",
    rememberedCountryNote: (name) =>
      `Реквизиты для ${name} — если страна другая, напишите «отмена».\n\n`,
    fulfillmentTypePrompt: "Как хотите получить заказ?",
    fulfillmentTypePickupBtn: "🚶 Самовывоз",
    fulfillmentTypeDeliveryBtn: "🚚 Доставка",
    fulfillmentTypeHint:
      "Не понял способ получения. Напишите «самовывоз» или «доставка» — либо нажмите кнопку выше.",
    fulfillmentDatePrompt: (minDate) =>
      `Когда сможете получить заказ? Не раньше ${minDate}. Напишите дату в формате ДД.ММ.ГГГГ.`,
    fulfillmentDateInvalid: "Не разобрал дату. Формат — ДД.ММ.ГГГГ, например «05.09.2026».",
    fulfillmentDateTooEarly: (minDate) =>
      `Раньше ${minDate} не получится — столько нужно на изготовление. Напишите другую дату.`,
    deliveryZonePrompt: "Выберите район доставки:",
    deliveryZoneHint:
      "Не понял район доставки. Ответьте номером из списка или названием — например «1» или «Центр».",
    variantChoiceHint: "Не понял вариант. Ответьте номером из списка или названием — например «1».",
    fulfillmentAddressPrompt: "Куда доставить? Напишите адрес.",
    fulfillmentNotePrompt:
      "Комментарий к заказу (например, надпись на торте)? Если не нужен — нажмите «Без комментария».",
    fulfillmentNoteSkipBtn: "Без комментария",
    amountDue: (amount, currency) => `К оплате: ${amount} ${currency}\n`,
    sendProofHint: "После оплаты пришлите чек сюда — картинкой или файлом.",
    cancelled:
      "Отменил, корзина пуста. Напишите номер материала, когда будете готовы — например «018».",
    complaintAck:
      "Вижу, что вопрос по оплате. Это решает продавец — я его уже позвал, " +
      "он ответит вам здесь же.\n\nБольше отвечать не буду, чтобы не мешать.",
    removeNothing: "Убирать пока нечего — в заказе ничего нет.",
    removeNotFound: (number, list) =>
      `Материала с номером ${number} в заказе нет. Сейчас в нём:\n\n${list}\n\n` +
      "Чтобы убрать всё, напишите «отмена».",
    removedCartEmpty: (name) =>
      `Убрал «${name}». В заказе больше ничего нет — напишите номер материала, когда будете готовы.`,
    removed: (name) => `Убрал «${name}».`,
    awaitingProofHint:
      "Жду чек об оплате — пришлите его сюда картинкой или файлом.\n\nЕсли передумали, напишите «отмена».",
    receiptProcessing: "Уже обрабатываю ваш чек — секунду.",
    receiptSaveFailed:
      "Чек не удалось сохранить. Пришлите его, пожалуйста, ещё раз — картинкой или файлом.",
    orderCreateFailed:
      "Не получилось оформить заказ. Напишите номер материала ещё раз, пожалуйста.",
    receiptReceivedKnownEmail: (displayNo, email) =>
      `Чек получил, заказ №${displayNo} принят. Отправим материалы на ${email} после проверки.`,
    receiptReceivedAskEmailOptional: (displayNo, email) =>
      `Чек получил, заказ №${displayNo} принят. Проверим оплату и пришлём материалы на ${email}.\n\n` +
      "Если нужен другой адрес — напишите его сюда. По остальным вопросам ответит продавец.",
    receiptReceivedNeedEmail: (displayNo) =>
      `Чек получил, заказ №${displayNo} принят.\n\n` +
      "На какую почту прислать материалы? Instagram не умеет пересылать документы, поэтому файлы уходят письмом.\n\n" +
      "Пожалуйста, внимательно проверьте адрес перед отправкой: без лишних пробелов и ошибок. " +
      "Если адрес указан неверно, материал может не прийти.",
    receiptReceivedWhatsApp: (displayNo) =>
      `Чек получил, заказ №${displayNo} принят. После проверки оплаты материалы придут сюда, в WhatsApp.`,
    countryHint:
      "Не понял страну. Ответьте номером из списка или названием — например «1» или «Казахстан».\n\n" +
      "Чтобы выйти, напишите «отмена».",
    emailStepGotReceipt:
      "Чек получил, он уже у продавца. Осталось одно: напишите почту, " +
      "на которую отправить материалы — например anna@mail.ru\n\n" +
      "Пожалуйста, внимательно проверьте адрес перед отправкой: без лишних пробелов и ошибок. " +
      "Если адрес указан неверно, материал может не прийти.",
    emailHint:
      "Это не похоже на адрес почты. Напишите его целиком, например anna@mail.ru\n\n" +
      "Чтобы выйти, напишите «отмена».",
    emailSaved: (email) =>
      `Записал: ${email}\n\n` +
      "Проверим оплату и пришлём материалы на этот адрес.\n\n" +
      "Если появятся вопросы — просто напишите здесь, дальше отвечает продавец.",
    strayAttachmentAck:
      "Вижу вложение. Если это чек об оплате — передал продавцу, он проверит и ответит здесь же.\n\n" +
      "Если хотите заказать материал через меня, напишите его номер из публикации.",
    ambiguousProduct: (number, names) =>
      `Под номером ${number} у нас несколько материалов:\n\n${names}\n\n` +
      "Напишите точное название нужного или уточните номер у продавца.",
    productNotFound: (number) =>
      `Товар с номером ${number} не нашёл. Проверьте номер в публикации — ` +
      "или напишите, что ищете, и продавец подскажет.",
    addedSingle: (name, priceLine) => `Добавил «${name}» — ${priceLine}.`,
    addedMulti: (name, priceLine, count, list) =>
      `Добавил «${name}» — ${priceLine}.\n\nВ заказе ${count}:\n${list}`,
    addedFooter: "Можно добавить ещё — просто напишите следующий номер. Или оформляйте заказ.",
    affirmativeReply:
      "Отлично! Напишите номер товара из публикации — например «196», — и я подскажу, как оплатить.",
    dismissalReply: "Хорошо! Если что-то понадобится — просто напишите сюда. 🙂",
  },
  kk: {
    languageSaved: "✅ Тіл сақталды.",
    greetingFull: (name) =>
      `Сәлеметсіз бе, ${name}! 👋\n\n` +
      "Сұрағыңызды сатушыға жеткіздім — дәл осында жауап береді.\n\n" +
      "Егер қазір бірдеңе сатып алғыңыз келсе, жарияланымдағы тауар нөмірін жазыңыз — мысалы «196».",
    greetingShort: "Сұрағыңызды сатушыға жеткіздім — дәл осында жауап береді.",
    catalogIntro: "Мұнда материал нөмірі бойынша тапсырыс беруге болады.",
    catalogNumberHint:
      "Жарияланымдағы нөмірді жазыңыз — мысалы «018», — қалай төлеу керегін айтамын.",
    catalogBotLink: (link) =>
      `Толық каталогты көру, тақырып бойынша іздеу және файлдарды алу үшін біздің боттан өтіңіз: ${link}`,
    searchNoResults: (query, link) =>
      `«${query}» бойынша ештеңе табылмады. Басқа сөзбен көріңіз немесе боттағы каталогты ашыңыз: ${link}`,
    searchFoundCount: (n) => `🔎 ${n} нұсқа таптық:`,
    catalogEmpty: "Каталог әзірге бос — тауарлар қосылмаған. Сатушыға жазыңыз.",
    catalogPick: "Каталогтан таңдаңыз:",
    catalogSectionCategories: "Бөлімдер",
    catalogSectionProducts: "Тауарлар",
    catalogMore: "➡️ Тағы көрсету",
    catalogBack: "⬆️ Артқа",
    catalogOpenBtn: "Каталогты ашу",
    searchNoResultsHere: (query) =>
      `«${query}» бойынша ештеңе табылмады. Басқа сөзбен көріңіз немесе каталогты ашыңыз.`,
    btnCatalog: "Каталог",
    btnAddToCart: "Себетке қосу",
    btnChooseVariant: "Нұсқа таңдау",
    btnCart: "Себет",
    btnCheckout: "Тапсырысты рәсімдеу",
    productUnavailable: "Бұл материал енді қолжетімсіз.",
    productNoFiles: (name) =>
      `«${name}» қазір жүктеуге қолжетімсіз. Ол қашан пайда болатынын сатушы айтады.`,
    productMixedCart: (name) =>
      `«${name}» қазірден бар тапсырыспен бірге қосылмайды — тауар түрлері бөлек. Ағымдағы тапсырысты рәсімдеңіз немесе себетті тазалаңыз.`,
    cartEmptyHint:
      "Тапсырыста әзірге ештеңе жоқ. Жарияланымдағы материал нөмірін жазыңыз — мысалы «018».",
    orderCartHeader: "Тапсырыста:",
    cartHeader: (count) => `Тапсырыста ${count} материал:`,
    cartTotal: (total, currency) => `Барлығы: ${total} ${currency}`,
    cartHintMulti: "Тағы нөмір қосуға немесе артығын алып тастауға болады — «-018» деп жазыңыз.\n",
    cartHintSingle: "Тағы қосуға болады — келесі нөмірді жазыңыз.\n",
    noOrders: "Сізде әзірге тапсырыс жоқ. 📋",
    ordersHeader: "📋 Сіздің тапсырыстарыңыз:\n\n",
    orderLine: (no, total, currency, statusLabel) =>
      `Тапсырыс #${no} — ${total} ${currency} [${statusLabel}]\n`,
    orderStatus: {
      awaiting_confirmation: "⏳ Төлемді тексерудеміз",
      awaiting_payment: "⏳ Төлем күтілуде",
      delivering: "📤 Материалдарды жіберудеміз",
      delivered: "✅ Материалдар поштаға жіберілді",
      rejected: "❌ Қабылданбады",
    },
    checkoutGiveUp:
      "Байқаймын, көмектесе алмай тұрмын — бөгет жасамайын. Сатушы жазысуды көріп, өзі жауап береді.",
    checkoutNeedNumber:
      "Тапсырыс беру үшін алдымен жарияланымдағы материал нөмірін жазыңыз — мысалы «018».\n\n" +
      "Соманы есептеп, төлем деректемелерін жіберемін.",
    noPaymentMethods: "Төлем деректемелері әлі енгізілмеген. Сатушы сізбен байланысады.",
    noRequisitesForCountry:
      "Бұл ел үшін төлем деректемелері әлі енгізілмеген. Сатушы сізбен байланысып, қалай төлеу керегін айтады.",
    cartEmptiedRestart: "Себет бос қалды. Материал нөмірін жазыңыз, қайтадан бастайық.",
    mixedCurrencySplit:
      "Тапсырыста әртүрлі валютадағы материалдар бар — оларды бөлек рәсімдеңіз.\n\n" +
      "«/stop» деп жазыңыз, содан кейін бір материалдың нөмірін жазыңыз.",
    rememberedCountryNote: (name) =>
      `${name} үшін деректемелер — ел басқа болса, «/stop» деп жазыңыз.\n\n`,
    fulfillmentTypePrompt: "Тапсырысты қалай алғыңыз келеді?",
    fulfillmentTypePickupBtn: "🚶 Өзі алып кету",
    fulfillmentTypeDeliveryBtn: "🚚 Жеткізу",
    fulfillmentTypeHint:
      "Алу тәсілін түсінбедім. «алып кету» немесе «жеткізу» деп жазыңыз — немесе жоғарыдағы батырманы басыңыз.",
    fulfillmentDatePrompt: (minDate) =>
      `Тапсырысты қашан ала аласыз? ${minDate}-ден ерте емес. Күнді КК.АА.ЖЖЖЖ форматында жазыңыз.`,
    fulfillmentDateInvalid: "Күнді таный алмадым. Формат — КК.АА.ЖЖЖЖ, мысалы «05.09.2026».",
    fulfillmentDateTooEarly: (minDate) =>
      `${minDate}-ден ерте болмайды — дайындауға сонша уақыт керек. Басқа күн жазыңыз.`,
    deliveryZonePrompt: "Жеткізу ауданын таңдаңыз:",
    deliveryZoneHint:
      "Жеткізу ауданын түсінбедім. Тізімдегі нөмірмен немесе атауымен жауап беріңіз — мысалы «1» немесе «Орталық».",
    variantChoiceHint:
      "Нұсқаны түсінбедім. Тізімдегі нөмірмен немесе атауымен жауап беріңіз — мысалы «1».",
    fulfillmentAddressPrompt: "Қайда жеткізу керек? Мекенжайды жазыңыз.",
    fulfillmentNotePrompt:
      "Тапсырысқа түсініктеме (мысалы, тортқа жазу)? Қажет болмаса — «Түсініктемесіз» батырмасын басыңыз.",
    fulfillmentNoteSkipBtn: "Түсініктемесіз",
    amountDue: (amount, currency) => `Төлеуге: ${amount} ${currency}\n`,
    sendProofHint: "Төлегеннен кейін чекті осында жіберіңіз — суретпен немесе файлмен.",
    cancelled: "Болдырмадым, себет бос. Дайын болғанда материал нөмірін жазыңыз — мысалы «018».",
    complaintAck:
      "Бұл төлем бойынша сұрақ екенін көріп тұрмын. Мұны сатушы шешеді — оны шақырдым, " +
      "дәл осында жауап береді.\n\nОдан әрі жауап бермеймін, бөгет жасамау үшін.",
    removeNothing: "Алып тастайтын ештеңе жоқ — тапсырыста бос.",
    removeNotFound: (number, list) =>
      `Тапсырыста ${number} нөмірлі материал жоқ. Қазір онда:\n\n${list}\n\n` +
      "Барлығын алып тастау үшін «/stop» деп жазыңыз.",
    removedCartEmpty: (name) =>
      `«${name}» алып тастадым. Тапсырыста басқа ештеңе жоқ — дайын болғанда материал нөмірін жазыңыз.`,
    removed: (name) => `«${name}» алып тастадым.`,
    awaitingProofHint:
      "Төлем чегін күтудемін — оны осында суретпен немесе файлмен жіберіңіз.\n\n" +
      "Ойыңыз өзгерсе, «/stop» деп жазыңыз.",
    receiptProcessing: "Чегіңізді өңдеп жатырмын — сәл күтіңіз.",
    receiptSaveFailed:
      "Чекті сақтау мүмкін болмады. Оны қайтадан жіберіңізші — суретпен немесе файлмен.",
    orderCreateFailed: "Тапсырысты рәсімдеу шықпады. Материал нөмірін қайта жазыңызшы.",
    receiptReceivedKnownEmail: (displayNo, email) =>
      `Чекті алдым, №${displayNo} тапсырыс қабылданды. Тексерістен кейін материалдарды ${email} мекенжайына жібереміз.`,
    receiptReceivedAskEmailOptional: (displayNo, email) =>
      `Чекті алдым, №${displayNo} тапсырыс қабылданды. Төлемді тексеріп, материалдарды ${email} мекенжайына жібереміз.\n\n` +
      "Басқа мекенжай керек болса — осында жазыңыз. Басқа сұрақтарға сатушы жауап береді.",
    receiptReceivedNeedEmail: (displayNo) =>
      `Чекті алдым, №${displayNo} тапсырыс қабылданды.\n\n` +
      "Материалдарды қай поштаға жіберу керек? Instagram құжаттарды жібере алмайды, сондықтан файлдар поштамен жіберіледі.\n\n" +
      "Жібермес бұрын e-mail мекенжайын мұқият тексеріңіз: артық бос орынсыз және қатесіз жазыңыз. " +
      "Мекенжай қате болса, материал келмеуі мүмкін.",
    receiptReceivedWhatsApp: (displayNo) =>
      `Чекті алдым, №${displayNo} тапсырыс қабылданды. Төлем тексерілгеннен кейін материалдар осы WhatsApp чатына жіберіледі.`,
    countryHint:
      "Елді түсінбедім. Тізімдегі нөмірмен немесе атауымен жауап беріңіз — мысалы «1» немесе «Қазақстан».\n\n" +
      "Шығу үшін «/stop» деп жазыңыз.",
    emailStepGotReceipt:
      "Чекті алдым, ол сатушыда. Бір-ақ нәрсе қалды: материалдарды жіберетін поштаны жазыңыз " +
      "— мысалы anna@mail.ru",
    emailHint:
      "Бұл пошта мекенжайына ұқсамайды. Толық жазыңыз, мысалы anna@mail.ru\n\n" +
      "Шығу үшін «/stop» деп жазыңыз.",
    emailSaved: (email) =>
      `Жаздым: ${email}\n\n` +
      "Төлемді тексеріп, материалдарды осы мекенжайға жібереміз.\n\n" +
      "Сұрақтар туындаса — осында жазыңыз, әрі қарай сатушы жауап береді.",
    strayAttachmentAck:
      "Тіркеме көрдім. Егер бұл төлем чегі болса — сатушыға жеткіздім, ол тексеріп, дәл осында жауап береді.\n\n" +
      "Материалды мен арқылы тапсырыс бергіңіз келсе, оның нөмірін жазыңыз.",
    ambiguousProduct: (number, names) =>
      `${number} нөмірінде бізде бірнеше материал бар:\n\n${names}\n\n` +
      "Керегінің дәл атауын жазыңыз немесе нөмірді сатушыдан нақтылаңыз.",
    productNotFound: (number) =>
      `${number} нөмірлі тауар табылмады. Жарияланымдағы нөмірді тексеріңіз — ` +
      "немесе не іздеп жатқаныңызды жазыңыз, сатушы көмектеседі.",
    addedSingle: (name, priceLine) => `«${name}» қостым — ${priceLine}.`,
    addedMulti: (name, priceLine, count, list) =>
      `«${name}» қостым — ${priceLine}.\n\nТапсырыста ${count}:\n${list}`,
    addedFooter: "Тағы қосуға болады — келесі нөмірді жазыңыз. Немесе тапсырысты рәсімдеңіз.",
    affirmativeReply:
      "Тамаша! Жарияланымдағы тауар нөмірін жазыңыз — мысалы «196», — қалай төлеу керегін айтамын.",
    dismissalReply: "Жарайды! Бірдеңе керек болса — осында жазыңыз. 🙂",
  },
  en: {
    languageSaved: "✅ Language saved.",
    greetingFull: (name) =>
      `Hi, ${name}! 👋\n\n` +
      "I've passed your question to the seller — they'll reply right here.\n\n" +
      'If you\'d like to order something right now, send the item number from the post — for example "196".',
    greetingShort: "I've passed your question to the seller — they'll reply right here.",
    catalogIntro: "Here you can place an order using the material's number.",
    catalogNumberHint:
      'Send the number from the post — for example "018" — and I\'ll tell you how to pay.',
    catalogBotLink: (link) =>
      `To browse the full catalog, search by topic, and get the files, check out our bot: ${link}`,
    searchNoResults: (query, link) =>
      `Nothing found for "${query}". Try another word, or open the catalog in our bot: ${link}`,
    searchFoundCount: (n) => `🔎 Found ${n} matching items:`,
    catalogEmpty:
      "The catalog is empty for now — no items yet. Message the seller and they'll help.",
    catalogPick: "Pick from the catalog:",
    catalogSectionCategories: "Sections",
    catalogSectionProducts: "Items",
    catalogMore: "➡️ Show more",
    catalogBack: "⬆️ Back",
    catalogOpenBtn: "Open catalog",
    searchNoResultsHere: (query) =>
      `Nothing found for "${query}". Try another word, or open the catalog.`,
    btnCatalog: "Catalog",
    btnAddToCart: "Add to cart",
    btnChooseVariant: "Choose variant",
    btnCart: "Cart",
    btnCheckout: "Place order",
    productUnavailable: "This material is no longer available.",
    productNoFiles: (name) =>
      `"${name}" isn't available for download right now. The seller will let you know when it's back.`,
    productMixedCart: (name) =>
      `"${name}" can't be added together with what's already in your order — different product types. Place the current order first or clear the cart.`,
    cartEmptyHint:
      "There's nothing in your order yet. Send the material's number from the post — for example \"018\".",
    orderCartHeader: "Your order:",
    cartHeader: (count) => `Your order has ${count} ${count === 1 ? "material" : "materials"}:`,
    cartTotal: (total, currency) => `Total: ${total} ${currency}`,
    cartHintMulti: 'You can add another number or remove one — send "-018" to remove.\n',
    cartHintSingle: "You can add another — just send the next number.\n",
    noOrders: "You don't have any orders yet. 📋",
    ordersHeader: "📋 Your orders:\n\n",
    orderLine: (no, total, currency, statusLabel) =>
      `Order #${no} — ${total} ${currency} [${statusLabel}]\n`,
    orderStatus: {
      awaiting_confirmation: "⏳ Checking your payment",
      awaiting_payment: "⏳ Awaiting payment",
      delivering: "📤 Sending materials",
      delivered: "✅ Materials sent by email",
      rejected: "❌ Declined",
    },
    checkoutGiveUp:
      "Looks like I'm not helping — I'll step aside. The seller will see this chat and reply themselves.",
    checkoutNeedNumber:
      'To place an order, first send the material\'s number from the post — for example "018".\n\n' +
      "I'll work out the total and send the payment details.",
    noPaymentMethods: "Payment details aren't set up yet. The seller will contact you.",
    noRequisitesForCountry:
      "Payment details for this country aren't set up yet. The seller will contact you and explain how to pay.",
    cartEmptiedRestart: "Your cart is empty now. Send a material's number to start again.",
    mixedCurrencySplit:
      "Your order has materials priced in different currencies — please order them separately.\n\n" +
      'Send "/stop", then the number of a single material.',
    rememberedCountryNote: (name) =>
      `Payment details for ${name} — if that's not your country, send "/stop".\n\n`,
    fulfillmentTypePrompt: "How would you like to receive your order?",
    fulfillmentTypePickupBtn: "🚶 Pickup",
    fulfillmentTypeDeliveryBtn: "🚚 Delivery",
    fulfillmentTypeHint:
      'Didn\'t catch that. Reply "pickup" or "delivery" — or tap the button above.',
    fulfillmentDatePrompt: (minDate) =>
      `When can you receive the order? Not earlier than ${minDate}. Send the date as DD.MM.YYYY.`,
    fulfillmentDateInvalid: 'Couldn\'t read that date. Format is DD.MM.YYYY, e.g. "05.09.2026".',
    fulfillmentDateTooEarly: (minDate) =>
      `Not earlier than ${minDate} — that's how long it takes to make. Please send another date.`,
    deliveryZonePrompt: "Pick a delivery zone:",
    deliveryZoneHint:
      'Didn\'t recognize that delivery zone. Reply with the number from the list or the name — e.g. "1" or "Downtown".',
    variantChoiceHint:
      'Didn\'t recognize that variant. Reply with the number from the list or the name — e.g. "1".',
    fulfillmentAddressPrompt: "Where should we deliver? Send the address.",
    fulfillmentNotePrompt:
      'Any note for the order (e.g. a cake inscription)? If not needed, tap "No note".',
    fulfillmentNoteSkipBtn: "No note",
    amountDue: (amount, currency) => `Total due: ${amount} ${currency}\n`,
    sendProofHint: "After paying, send the receipt here — as a photo or a file.",
    cancelled:
      "Cancelled — your cart is empty. Send a material's number when you're ready — for example \"018\".",
    complaintAck:
      "I can see this is about a payment. That's for the seller to sort out — I've already called them in, " +
      "and they'll reply right here.\n\nI won't reply further, so as not to get in the way.",
    removeNothing: "There's nothing to remove — your order is empty.",
    removeNotFound: (number, list) =>
      `There's no material numbered ${number} in your order. Right now it has:\n\n${list}\n\n` +
      'To clear everything, send "/stop".',
    removedCartEmpty: (name) =>
      `Removed "${name}". Your order is now empty — send a material's number when you're ready.`,
    removed: (name) => `Removed "${name}".`,
    awaitingProofHint:
      'Waiting for your payment receipt — send it here as a photo or a file.\n\nChanged your mind? Send "/stop".',
    receiptProcessing: "Already processing your receipt — one moment.",
    receiptSaveFailed: "Couldn't save the receipt. Please send it again — as a photo or a file.",
    orderCreateFailed: "Couldn't place the order. Please send the material's number again.",
    receiptReceivedKnownEmail: (displayNo, email) =>
      `Got the receipt, order #${displayNo} is in. We'll send the materials to ${email} after checking.`,
    receiptReceivedAskEmailOptional: (displayNo, email) =>
      `Got the receipt, order #${displayNo} is in. We'll check the payment and send the materials to ${email}.\n\n` +
      "If you need a different address, send it here. For anything else, the seller will reply.",
    receiptReceivedNeedEmail: (displayNo) =>
      `Got the receipt, order #${displayNo} is in.\n\n` +
      "Which email should we send the materials to? Instagram can't forward documents, so files go out by email.\n\n" +
      "Please check the address carefully before sending: no extra spaces or typos. " +
      "If the address is incorrect, the materials may not arrive.",
    receiptReceivedWhatsApp: (displayNo) =>
      `Got the receipt, order #${displayNo} is in. After the payment is checked, the materials will be sent here in WhatsApp.`,
    countryHint:
      'Didn\'t catch the country. Reply with the number from the list or the name — for example "1" or "Kazakhstan".\n\n' +
      'To exit, send "/stop".',
    emailStepGotReceipt:
      "Got the receipt, the seller already has it. One thing left: send the email " +
      "to send the materials to — for example anna@mail.ru",
    emailHint:
      "That doesn't look like an email address. Send it in full, for example anna@mail.ru\n\n" +
      'To exit, send "/stop".',
    emailSaved: (email) =>
      `Saved: ${email}\n\n` +
      "We'll check the payment and send the materials to this address.\n\n" +
      "If you have questions, just write here — the seller takes it from here.",
    strayAttachmentAck:
      "I see an attachment. If it's a payment receipt, I've passed it to the seller — they'll check it and reply right here.\n\n" +
      "If you'd like to order a material through me, send its number from the post.",
    ambiguousProduct: (number, names) =>
      `There are several materials under number ${number}:\n\n${names}\n\n` +
      "Send the exact name of the one you want, or ask the seller to confirm the number.",
    productNotFound: (number) =>
      `Couldn't find an item numbered ${number}. Please check the number in the post — ` +
      "or tell me what you're looking for and the seller will help.",
    addedSingle: (name, priceLine) => `Added "${name}" — ${priceLine}.`,
    addedMulti: (name, priceLine, count, list) =>
      `Added "${name}" — ${priceLine}.\n\nYour order has ${count}:\n${list}`,
    addedFooter: "You can add more — just send the next number. Or go ahead and place the order.",
    affirmativeReply:
      'Great! Send the item number from the post — for example "196" — and I\'ll tell you how to pay.',
    dismissalReply: "All good! If you need anything, just write here. 🙂",
  },
  uz: {
    languageSaved: "✅ Til saqlandi.",
    greetingFull: (name) =>
      `Salom, ${name}! 👋\n\n` +
      "Savolingizni sotuvchiga yetkazdim — shu yerda javob beradi.\n\n" +
      "Agar hozir biror narsa buyurtma qilmoqchi bo‘lsangiz, e’londagi mahsulot raqamini yozing — masalan, «196».",
    greetingShort: "Savolingizni sotuvchiga yetkazdim — shu yerda javob beradi.",
    catalogIntro: "Bu yerda material raqami orqali buyurtma berish mumkin.",
    catalogNumberHint:
      "E’londagi raqamni yozing — masalan, «018», — qanday to‘lash kerakligini aytaman.",
    catalogBotLink: (link) =>
      `To‘liq katalogni ko‘rish, mavzu bo‘yicha qidirish va fayllarni olish uchun botimizga o‘ting: ${link}`,
    searchNoResults: (query, link) =>
      `«${query}» bo‘yicha hech narsa topilmadi. Boshqa so‘z bilan urinib ko‘ring yoki botimizdagi katalogni oching: ${link}`,
    searchFoundCount: (n) => `🔎 ${n} ta variant topildi:`,
    catalogEmpty: "Katalog hozircha bo'sh — mahsulotlar qo'shilmagan. Sotuvchiga yozing.",
    catalogPick: "Katalogdan tanlang:",
    catalogSectionCategories: "Bo'limlar",
    catalogSectionProducts: "Mahsulotlar",
    catalogMore: "➡️ Yana ko'rsatish",
    catalogBack: "⬆️ Orqaga",
    catalogOpenBtn: "Katalogni ochish",
    searchNoResultsHere: (query) =>
      `"${query}" bo'yicha hech narsa topilmadi. Boshqa so'z bilan urinib ko'ring yoki katalogni oching.`,
    btnCatalog: "Katalog",
    btnAddToCart: "Savatga qo‘shish",
    btnChooseVariant: "Variant tanlash",
    btnCart: "Savat",
    btnCheckout: "Buyurtma berish",
    productUnavailable: "Bu material endi mavjud emas.",
    productNoFiles: (name) =>
      `«${name}» hozircha yuklab olish uchun mavjud emas. U qachon paydo bo‘lishini sotuvchi aytadi.`,
    productMixedCart: (name) =>
      `«${name}»ni buyurtmadagi boshqa mahsulot bilan birga qo‘shib bo‘lmaydi — tovar turlari boshqa. Avval joriy buyurtmani rasmiylashtiring yoki savatni tozalang.`,
    cartEmptyHint:
      "Buyurtmada hozircha hech narsa yo‘q. E’londagi material raqamini yozing — masalan, «018».",
    orderCartHeader: "Buyurtmada:",
    cartHeader: (count) => `Buyurtmada ${count} ta material:`,
    cartTotal: (total, currency) => `Jami: ${total} ${currency}`,
    cartHintMulti:
      "Yana raqam qo‘shishingiz yoki ortiqchasini olib tashlashingiz mumkin — «-018» deb yozing.\n",
    cartHintSingle: "Yana qo‘shishingiz mumkin — keyingi raqamni yozing.\n",
    noOrders: "Sizda hozircha buyurtma yo‘q. 📋",
    ordersHeader: "📋 Sizning buyurtmalaringiz:\n\n",
    orderLine: (no, total, currency, statusLabel) =>
      `Buyurtma #${no} — ${total} ${currency} [${statusLabel}]\n`,
    orderStatus: {
      awaiting_confirmation: "⏳ To‘lovni tekshirmoqdamiz",
      awaiting_payment: "⏳ To‘lov kutilmoqda",
      delivering: "📤 Materiallarni yubormoqdamiz",
      delivered: "✅ Materiallar pochtaga yuborildi",
      rejected: "❌ Rad etildi",
    },
    checkoutGiveUp:
      "Chamasi, yordam berolmayapman — xalaqit bermayman. Sotuvchi yozishmani ko‘rib, o‘zi javob beradi.",
    checkoutNeedNumber:
      "Buyurtma berish uchun avval e’londagi material raqamini yozing — masalan, «018».\n\n" +
      "Summani hisoblab, to‘lov rekvizitlarini yuboraman.",
    noPaymentMethods: "To‘lov rekvizitlari hali kiritilmagan. Sotuvchi siz bilan bog‘lanadi.",
    noRequisitesForCountry:
      "Bu davlat uchun to‘lov rekvizitlari hali kiritilmagan. Sotuvchi siz bilan bog‘lanib, qanday to‘lashni aytadi.",
    cartEmptiedRestart: "Savat bo‘shab qoldi. Material raqamini yozing, qaytadan boshlaymiz.",
    mixedCurrencySplit:
      "Buyurtmada turli valyutadagi materiallar bor — ularni alohida rasmiylashtiring.\n\n" +
      "«/stop» deb yozing, keyin bitta material raqamini yozing.",
    rememberedCountryNote: (name) =>
      `${name} uchun rekvizitlar — davlat boshqa bo‘lsa, «/stop» deb yozing.\n\n`,
    fulfillmentTypePrompt: "Buyurtmani qanday olishni xohlaysiz?",
    fulfillmentTypePickupBtn: "🚶 O‘zi olib ketish",
    fulfillmentTypeDeliveryBtn: "🚚 Yetkazib berish",
    fulfillmentTypeHint:
      "Olish usulini tushunmadim. «olib ketish» yoki «yetkazib berish» deb yozing — yoki yuqoridagi tugmani bosing.",
    fulfillmentDatePrompt: (minDate) =>
      `Buyurtmani qachon olishingiz mumkin? ${minDate} dan erta emas. Sanani KK.OO.YYYY formatida yozing.`,
    fulfillmentDateInvalid: "Sanani tanib bo‘lmadi. Format — KK.OO.YYYY, masalan «05.09.2026».",
    fulfillmentDateTooEarly: (minDate) =>
      `${minDate} dan erta bo‘lmaydi — tayyorlash uchun shuncha vaqt kerak. Boshqa sana yozing.`,
    deliveryZonePrompt: "Yetkazib berish zonasini tanlang:",
    deliveryZoneHint:
      "Yetkazib berish zonasini tushunmadim. Ro‘yxatdagi raqami yoki nomi bilan javob bering — masalan «1» yoki «Markaz».",
    variantChoiceHint:
      "Variantni tushunmadim. Ro‘yxatdagi raqami yoki nomi bilan javob bering — masalan «1».",
    fulfillmentAddressPrompt: "Qayerga yetkazib berish kerak? Manzilni yozing.",
    fulfillmentNotePrompt:
      "Buyurtmaga izoh (masalan, tortga yozuv)? Kerak bo‘lmasa — «Izohsiz» tugmasini bosing.",
    fulfillmentNoteSkipBtn: "Izohsiz",
    amountDue: (amount, currency) => `To‘lov uchun: ${amount} ${currency}\n`,
    sendProofHint: "To‘lovdan so‘ng chekni shu yerga yuboring — surat yoki fayl sifatida.",
    cancelled:
      "Bekor qildim, savat bo‘sh. Tayyor bo‘lganingizda material raqamini yozing — masalan, «018».",
    complaintAck:
      "Bu to‘lov bo‘yicha savol ekanini ko‘ryapman. Buni sotuvchi hal qiladi — men uni allaqachon chaqirdim, " +
      "shu yerda javob beradi.\n\nXalaqit bermaslik uchun boshqa javob bermayman.",
    removeNothing: "Olib tashlaydigan hech narsa yo‘q — buyurtma bo‘sh.",
    removeNotFound: (number, list) =>
      `Buyurtmada ${number} raqamli material yo‘q. Hozir unda:\n\n${list}\n\n` +
      "Hammasini olib tashlash uchun «/stop» deb yozing.",
    removedCartEmpty: (name) =>
      `«${name}» olib tashladim. Buyurtmada boshqa hech narsa yo‘q — tayyor bo‘lganingizda material raqamini yozing.`,
    removed: (name) => `«${name}» olib tashladim.`,
    awaitingProofHint:
      "To‘lov chekini kutyapman — uni shu yerga surat yoki fayl sifatida yuboring.\n\n" +
      "Fikringiz o‘zgarsa, «/stop» deb yozing.",
    receiptProcessing: "Chekingizni qayta ishlayapman — bir soniya.",
    receiptSaveFailed:
      "Chekni saqlab bo‘lmadi. Iltimos, uni yana yuboring — surat yoki fayl sifatida.",
    orderCreateFailed:
      "Buyurtmani rasmiylashtirib bo‘lmadi. Material raqamini qaytadan yozing, iltimos.",
    receiptReceivedKnownEmail: (displayNo, email) =>
      `Chek qabul qilindi, №${displayNo} buyurtma qabul qilindi. Tekshirgach materiallarni ${email} manziliga yuboramiz.`,
    receiptReceivedAskEmailOptional: (displayNo, email) =>
      `Chek qabul qilindi, №${displayNo} buyurtma qabul qilindi. To‘lovni tekshirib, materiallarni ${email} manziliga yuboramiz.\n\n` +
      "Boshqa manzil kerak bo‘lsa — shu yerga yozing. Boshqa savollarga sotuvchi javob beradi.",
    receiptReceivedNeedEmail: (displayNo) =>
      `Chek qabul qilindi, №${displayNo} buyurtma qabul qilindi.\n\n` +
      "Materiallarni qaysi pochtaga yuborish kerak? Instagram hujjatlarni yuborolmaydi, shuning uchun fayllar pochta orqali yuboriladi.\n\n" +
      "Yuborishdan oldin e-mail manzilini diqqat bilan tekshiring: ortiqcha bo‘sh joysiz va xatosiz kiriting. " +
      "Manzil noto‘g‘ri bo‘lsa, material yetib kelmasligi mumkin.",
    receiptReceivedWhatsApp: (displayNo) =>
      `Chek qabul qilindi, №${displayNo} buyurtma qabul qilindi. To‘lov tekshirilgach, materiallar shu WhatsApp chatiga yuboriladi.`,
    countryHint:
      "Davlatni tushunmadim. Ro‘yxatdagi raqam yoki nomi bilan javob bering — masalan, «1» yoki «Qozog‘iston».\n\n" +
      "Chiqish uchun «/stop» deb yozing.",
    emailStepGotReceipt:
      "Chek qabul qilindi, u sotuvchida. Bitta narsa qoldi: materiallarni yuborish uchun pochtangizni yozing " +
      "— masalan, anna@mail.ru",
    emailHint:
      "Bu pochta manziliga o‘xshamayapti. To‘liq yozing, masalan anna@mail.ru\n\n" +
      "Chiqish uchun «/stop» deb yozing.",
    emailSaved: (email) =>
      `Yozib oldim: ${email}\n\n` +
      "To‘lovni tekshirib, materiallarni shu manzilga yuboramiz.\n\n" +
      "Savollar bo‘lsa — shu yerga yozing, keyin sotuvchi javob beradi.",
    strayAttachmentAck:
      "Ilova ko‘rinmoqda. Agar bu to‘lov cheki bo‘lsa — sotuvchiga yetkazdim, u tekshirib shu yerda javob beradi.\n\n" +
      "Agar men orqali material buyurtma qilmoqchi bo‘lsangiz, uning raqamini yozing.",
    ambiguousProduct: (number, names) =>
      `${number} raqami ostida bizda bir nechta material bor:\n\n${names}\n\n` +
      "Kerakli materialning aniq nomini yozing yoki raqamni sotuvchidan aniqlashtiring.",
    productNotFound: (number) =>
      `${number} raqamli mahsulot topilmadi. E’londagi raqamni tekshiring — ` +
      "yoki nima izlayotganingizni yozing, sotuvchi yordam beradi.",
    addedSingle: (name, priceLine) => `«${name}» qo‘shdim — ${priceLine}.`,
    addedMulti: (name, priceLine, count, list) =>
      `«${name}» qo‘shdim — ${priceLine}.\n\nBuyurtmada ${count} ta:\n${list}`,
    addedFooter:
      "Yana qo‘shishingiz mumkin — keyingi raqamni yozing. Yoki buyurtmani rasmiylashtiring.",
    affirmativeReply:
      "Ajoyib! E’londagi mahsulot raqamini yozing — masalan, «196», — qanday to‘lashni aytaman.",
    dismissalReply: "Bo‘pti! Biror narsa kerak bo‘lsa — shu yerga yozing. 🙂",
  },
};

/**
 * Ответ покупателю в Direct.
 *
 * Все ответы бота идут через эту точку, а не напрямую в sendZernioInboxMessage,
 * ровно по одной причине: два одинаковых сообщения подряд отправляться не
 * должны (см. sendDirectReply). В живой переписке человек получил «Корзина
 * пуста» дважды и «Передал ваш вопрос продавцу» дважды — четыре сообщения, из
 * которых половина была дословным повтором.
 */
async function reply(
  user: { user_key: string; platform?: string | null },
  conversationId: string,
  accountId: string,
  text: string,
  buttons?: ZernioDmButton[],
  force = false,
  interactive?: Json,
) {
  const flow = await import("./direct-purchase.server");
  return flow.sendDirectReply({
    conversationId,
    accountId,
    userKey: user.user_key,
    text,
    buttons,
    interactive,
    platform: platformOf(user),
    force,
  });
}

/**
 * Канал покупателя из его записи в `bot_users`.
 *
 * Читается из строки, а не передаётся отдельным параметром через полтора
 * десятка функций сценария: запись пользователя и так есть в каждой из них, и
 * платформа — такое же её свойство, как язык или страна. Instagram по
 * умолчанию — так выглядят все записи, заведённые до появления WhatsApp.
 */
function platformOf(user: { platform?: string | null }): ZernioPlatform {
  return isZernioPlatform(user.platform) ? user.platform : "instagram";
}

/**
 * Префикс ключей автоответчика в `app_settings` по каналу.
 *
 * Инстаграмный префикс исторический и намеренно не переименован: под ним уже
 * лежат настройки у работающих клиентов, а переименование ключа означало бы
 * миграцию данных ради косметики — и молча сброшенные настройки у того, кто
 * её не применил.
 */
const SETTINGS_PREFIX: Record<ZernioPlatform, string> = {
  instagram: "instagram_direct_bot_",
  whatsapp: "whatsapp_bot_",
};

/**
 * Метка «эта строка списка — ответ на текущий шаг сценария, а не команда».
 *
 * Понадобилась вместе со списками WhatsApp. Нажатие строки приходит как
 * postback с пустым текстом, а шаги сценария (язык, страна) читают именно
 * текст — без метки выбор языка списком просто проваливался бы в разбор
 * команд, не совпадал ни с BUY/CART/CHECKOUT/CATALOG и молча терялся.
 *
 * Отдельный префикс, а не «считать текстом любой нераспознанный postback»:
 * так исключено, чтобы кнопка чужой автоматизации Zernio случайно оказалась
 * ответом на вопрос бота.
 */
const STEP_PREFIX = "STEP:";

export type WhatsAppListRow = { id: string; title: string; description?: string };

/**
 * Сколько строк помещается в один список WhatsApp.
 *
 * Лимит Meta, а не наш: документация Zernio его не повторяет, потому что
 * передаёт объект `interactive` в Cloud API дословно. Проектируем под 10 строк
 * на всё сообщение — если по факту Meta допускает больше, страница на 10
 * строк всё равно останется рабочей; обратное неверно, а молча обрезанный
 * каталог выглядит как «половина товаров пропала».
 */
export const WA_LIST_MAX_ROWS = 10;

/**
 * Сколько из них отдаём под содержимое.
 *
 * Две строки держим под навигацию — «Назад» и «Показать ещё». Обе нужны
 * одновременно: во вложенной категории, где товаров больше страницы.
 */
export const WA_LIST_PAGE_SIZE = WA_LIST_MAX_ROWS - 2;

/** Лимиты Meta на строку списка. Перебор она молча режет. */
const WA_ROW_TITLE_MAX = 24;
const WA_ROW_DESC_MAX = 72;

/**
 * До скольких товаров раздел показывается карточками с фото вместо списка.
 *
 * Каждая карточка — отдельное сообщение, так что порог упирается не в API, а
 * в терпение покупателя: пять подряд ещё читаются как витрина, десять уже
 * выглядят как спам в чате, которым продавец пользуется и для живой
 * переписки.
 */
export const WA_PHOTO_GALLERY_MAX = 5;

/**
 * Подпись строки: сначала хвост названия, потом цена.
 *
 * Картинку в строку списка положить нельзя — у Meta в этом типе сообщения
 * такого поля нет вовсе. Зато есть 72 символа описания, и они пропадали
 * впустую: там стояла одна цена. На живом каталоге это выглядело так, что
 * четыре разных товара показывались как «034. Декор на дверь к 1», «035.
 * Декор на дверь к 1», «036…» — заголовок обрывался ровно там, где названия
 * ещё совпадали, и различить позиции было нечем.
 *
 * Теперь в описание уходит та часть названия, которая не поместилась в
 * заголовок, — то самое место, где товары и расходятся. Цена дописывается
 * следом, если остаётся место: она есть и в карточке, а вот отличить одну
 * позицию от другой больше неоткуда.
 */
/**
 * Родитель категории — спросить у самой категории, а не вывести из соседей.
 *
 * Соблазн взять `parent_id` у детей текущей категории обманчив: у них он и
 * есть текущая категория, так что «Назад» вело бы на тот же уровень. Здесь
 * это уже было один раз.
 */
async function parentCategoryOf(
  s: Awaited<ReturnType<typeof db>>,
  categoryId: string,
): Promise<string | null> {
  const { data } = await s
    .from("categories")
    .select("parent_id")
    .eq("id", categoryId)
    .maybeSingle();
  return data?.parent_id ?? null;
}

export function rowSubtitle(name: string, price: string): string {
  const tail = name.length > WA_ROW_TITLE_MAX ? name.slice(WA_ROW_TITLE_MAX).trim() : "";
  if (!tail) return price;

  const withPrice = `${tail} · ${price}`;
  if (withPrice.length <= WA_ROW_DESC_MAX) return withPrice;

  // Не влезло вместе — хвост названия важнее цены: цену покупатель увидит в
  // карточке, а понять, чем товары отличаются, там будет уже поздно.
  return tail.slice(0, WA_ROW_DESC_MAX);
}

/**
 * Список WhatsApp вместо кнопок.
 *
 * У Instagram Direct на сообщение максимум три кнопки — из-за этого и выбор
 * языка, и выбор страны там сделаны нумерованным текстом («ответьте цифрой»).
 * WhatsApp даёт списки, и выбор строки приходит обратно тем же `interactiveId`,
 * что и нажатие кнопки, — поэтому весь разбор ниже по течению остаётся общим.
 *
 * Meta режет длины молча, обрезаем сами: заголовок строки 24 символа,
 * описание 72, текст кнопки 20, заголовок секции 24.
 *
 * Секции принимаются массивом, потому что на одном уровне каталога бывают и
 * разделы, и товары, и валить их в одну кучу — значит заставлять покупателя
 * различать их по эмодзи. Пустые секции выбрасываются: Meta на секцию без
 * строк отвечает ошибкой.
 */
export function whatsappList(params: {
  body: string;
  buttonLabel: string;
  sections: Array<{ title: string; rows: WhatsAppListRow[] }>;
  header?: string;
}): Json {
  // Общий лимит — на всё сообщение, а не на секцию, поэтому бюджет строк
  // расходуется по порядку секций.
  let budget = WA_LIST_MAX_ROWS;
  const sections: Array<{ title: string; rows: WhatsAppListRow[] }> = [];
  for (const section of params.sections) {
    if (budget <= 0) break;
    const rows = section.rows.slice(0, budget).map((row) => ({
      id: row.id,
      title: row.title.slice(0, 24),
      ...(row.description ? { description: row.description.slice(0, 72) } : {}),
    }));
    if (rows.length === 0) continue;
    budget -= rows.length;
    sections.push({ title: section.title.slice(0, 24), rows });
  }

  return {
    type: "list",
    ...(params.header ? { header: { type: "text", text: params.header.slice(0, 60) } } : {}),
    body: { text: params.body.slice(0, 1024) },
    action: { button: params.buttonLabel.slice(0, 20), sections },
  } as unknown as Json;
}

/**
 * Создать или обновить покупателя из канала Zernio (Instagram или WhatsApp).
 */
export async function upsertZernioUser(
  userKey: string,
  conversationId?: string,
  accountId?: string,
  username?: string,
  firstName?: string,
  metadata?: Record<string, Json>,
  platform: ZernioPlatform = "instagram",
) {
  const s = await db();
  const { data: existing } = await s
    .from("bot_users")
    .select("*")
    .eq("user_key", userKey)
    .maybeSingle();

  if (existing) {
    const updates: TablesUpdate<"bot_users"> = {
      updated_at: new Date().toISOString(),
    };
    if (conversationId) updates.zernio_conversation_id = conversationId;
    if (accountId) updates.zernio_account_id = accountId;
    if (username) updates.username = username;
    if (firstName) updates.first_name = firstName;
    if (metadata) {
      // `metadata` в базе — jsonb, то есть с точки зрения типов это Json:
      // строка, число и массив там столь же допустимы, как объект. Разворачивать
      // спредом можно только объект, поэтому всё остальное (включая null и
      // случайно записанный скаляр) считаем «накопленного нет» и начинаем с
      // пустого — иначе на такой строке падал бы весь разбор входящего сообщения.
      const prev = existing.metadata;
      const base = prev && typeof prev === "object" && !Array.isArray(prev) ? prev : {};
      updates.metadata = { ...base, ...metadata };
    }

    await s.from("bot_users").update(updates).eq("user_key", userKey);
    // `isNewUser: false` — сигнал для handleZernioMessage, что это не первое
    // сообщение от отправителя, а значит выбор языка ему уже предлагали (или
    // предлагать не нужно — запись старше самой этой возможности).
    return { ...existing, ...updates, isNewUser: false };
  }

  const newUser = {
    telegram_id: zernioCustomerId(userKey),
    user_key: userKey,
    platform,
    zernio_conversation_id: conversationId,
    zernio_account_id: accountId,
    username: username || null,
    first_name: firstName || (platform === "whatsapp" ? "Гость WhatsApp" : "Инста-гость"),
    email: null,
    state: {},
    metadata: metadata || {},
  };

  const { data: inserted, error } = await s.from("bot_users").insert(newUser).select().single();
  if (error) {
    console.error("[zernio-bot] error upserting user:", error);
    return { ...newUser, isNewUser: true };
  }
  // Запись только что создана — handleZernioMessage покажет ей выбор языка
  // раньше чего бы то ни было ещё, ровно один раз в жизни этого отправителя.
  return { ...inserted, isNewUser: true };
}

/** Строка bot_users, как её возвращает upsertZernioUser — покупатель Instagram Direct. */
type ZernioBotUser = Awaited<ReturnType<typeof upsertZernioUser>>;

/**
 * Показать выбор языка: и новому покупателю, и по явному запросу («язык» /
 * «тіл» / «til» / «language», см. matchDirectCommand). Оба случая должны
 * привести к одному и тому же следующему шагу — ждать ответ на этот выбор,
 * — поэтому идут через одну функцию.
 *
 * `force: true`, потому что список языков могли уже показывать (например,
 * человек ответил не тем, что мы поняли, и переспросил словом «язык») — это
 * осознанный повторный вызов, а не повтор одного и того же вебхук-события,
 * который стоит подавить (см. sendDirectReply).
 */
async function sendLanguagePicker(conversationId: string, accountId: string, user: ZernioBotUser) {
  const flow = await import("./direct-purchase.server");
  await flow.setDirectState(user.user_key, { mode: "awaiting_locale" });

  /**
   * В WhatsApp тот же выбор показывается списком, а не нумерованным текстом.
   *
   * Нумерованный текст в Instagram — вынужденная мера: там три кнопки на
   * сообщение, а языков четыре. В WhatsApp список вмещает десять строк, так
   * что просить человека «ответьте цифрой» больше незачем. Разбор ответа
   * остаётся общим: выбор строки приходит тем же `interactiveId`, а
   * `matchLocalePick` понимает и цифру, и название языка — так что даже если
   * покупатель ответит текстом, шаг отработает как раньше.
   */
  if (platformOf(user) === "whatsapp") {
    await reply(
      user,
      conversationId,
      accountId,
      "Выберите язык / Тілді таңдаңыз / Tilni tanlang / Choose language",
      undefined,
      true,
      whatsappList({
        body: "Выберите язык / Тілді таңдаңыз / Tilni tanlang / Choose language",
        buttonLabel: "Выбрать язык",
        sections: [
          {
            title: "Язык",
            rows: SUPPORTED_LOCALES.map((locale, index) => ({
              // STEP: — ответ на текущий шаг сценария, а не команда (см. STEP_PREFIX).
              // Внутри номер, а не код языка: matchLocalePick разбирает именно его,
              // так что ответ списком и ответ текстом попадают в одну ветку.
              id: `${STEP_PREFIX}${index + 1}`,
              title: localeNames[locale],
            })),
          },
        ],
      }),
    );
    return;
  }

  await reply(user, conversationId, accountId, languagePickerText(), undefined, true);
}

/**
 * Обработать входящее личное сообщение (DM) из Instagram Direct.
 * Соответствует спецификации Zernio Webhooks: payload.message, payload.conversation, payload.account
 */
export async function handleZernioMessage(payload: ZernioWebhookMessagePayload) {
  const { parseZernioMessage } = await import("./zernio-message");
  const {
    conversationId,
    accountId,
    platform,
    userKey,
    senderUsername,
    senderName,
    senderPhone,
    text,
    metadata,
    postbackPayload,
    nativeOrder,
  } = parseZernioMessage(payload);

  if (!conversationId || !accountId) {
    console.warn("[zernio-bot] message.received missing conversationId or accountId:", payload);
    return;
  }

  const s = await db();

  /**
   * Все настройки автоответчика — одним запросом.
   *
   * Их было три подряд, каждая за своим ключом, и на каждое входящее сообщение
   * приходилось три обращения к базе вместо одного. Ключи лежат в одной
   * таблице у одного арендатора, так что выбрать их сразу ничего не стоит.
   */
  /**
   * Ключи настроек свои у каждого канала: у клиента может быть куплен
   * Instagram и не куплен WhatsApp, а слова-триггеры и приветствие в директе и
   * в мессенджере — разные тексты для разной аудитории. Префикс и задаёт это
   * разделение (`instagram_direct_bot_*` / `whatsapp_bot_*`).
   */
  const settingsPrefix = SETTINGS_PREFIX[platform];
  const settingKeys = [
    "enabled",
    "excluded_phones",
    "features",
    "ignore_excluded_contacts",
    "scope",
    "script",
    "start_prompt",
    "start_prompt_enabled",
    "triggers",
  ].map((suffix) => `${settingsPrefix}${suffix}`);

  const { data: settingRows } = await s
    .from("app_settings")
    .select("key, value")
    .eq("bot_id", process.env.BOT_ID?.trim() || "")
    .in("key", settingKeys);

  const setting = (suffix: string) =>
    (settingRows ?? []).find((row) => row.key === `${settingsPrefix}${suffix}`)?.value?.trim() ||
    "";

  if (setting("enabled") === "false") {
    console.log(
      `[zernio-bot] ${PLATFORM_LABEL[platform]} assistant is disabled; event recorded without a reply`,
    );
    return;
  }

  if (platform === "whatsapp" && setting("ignore_excluded_contacts") === "true") {
    const { isExcludedWhatsAppSender } = await import("./whatsapp-contact-exclusions");
    if (
      isExcludedWhatsAppSender({
        senderPhone,
        senderId: payload.message?.sender?.id,
        excludedPhones: setting("excluded_phones"),
      })
    ) {
      logger.info("zernio.whatsapp_excluded_contact", { userKey });
      return;
    }
  }

  let features = { catalog: true, search: true, cart: true, checkout: true };
  try {
    features = { ...features, ...JSON.parse(setting("features") || "{}") };
  } catch {
    /* defaults */
  }

  /**
   * Магазин в переписке — отдельно продаваемый модуль, и тумблер обязан его
   * выключать.
   *
   * До этой проверки `dm_shop` числился доступным в прайсе и в панели, но в
   * коде не спрашивался нигде: магазин в Direct гейтился только ключом
   * `instagram`. То есть модуль продавался, а его тумблер не делал ничего —
   * выключенным он выглядел выключенным только в панели. Здесь это чинится
   * сразу для обоих каналов.
   *
   * Выключенный модуль гасит именно торговлю: каталог, поиск, корзину и
   * оформление. Автоответчик при этом продолжает работать — он входит в
   * `instagram` / `whatsapp`, а не в магазин.
   */
  const { hasModule } = await import("./modules/modules.server");
  const shopModule = platform === "whatsapp" ? "wa_shop" : "dm_shop";
  if (!(await hasModule(shopModule))) {
    features = { catalog: false, search: false, cart: false, checkout: false };
  }

  /**
   * Область ответов. По умолчанию — только покупки.
   *
   * Отвечая, бот неизбежно помечает переписку прочитанной: управлять этим у
   * Instagram нельзя, в API такого нет. Для продавца это значило, что он
   * перестал видеть в приложении, кому нужно ответить, — приходилось смотреть
   * ник в админке и вручную искать человека в Instagram. Поэтому по обычной
   * переписке бот теперь молчит: непрочитанное остаётся непрочитанным.
   */
  const answersEverything = setting("scope") === "all";

  // userKey — устойчивый идентификатор для корреляции, логируется как есть.
  // username и текст сообщения — PII, только усечёнными; см. политику в
  // logger.server.ts.
  logger.info("zernio.dm_received", {
    userKey,
    senderUsername: truncate(senderUsername, 40),
    text: truncate(text, 80),
  });

  // Обновляем/создаем пользователя
  const user = await upsertZernioUser(
    userKey,
    conversationId,
    accountId,
    senderUsername,
    senderName,
    metadata,
    platform,
  );

  // A CMD button in a Zernio automation carries its command in the postback
  // payload, while `message.text` contains the visible label (for example,
  // «старт»). Treat a `/start` payload exactly like a manually typed command.
  const isStartPostback = postbackPayload?.trim().toLowerCase() === "/start";
  const effectiveText = isStartPostback ? "/start" : text;
  const plainText = effectiveText.trim().toLowerCase();
  const isStartCommand = plainText === "/start";
  const startFlow = await import("./direct-purchase.server");
  const directState = startFlow.readDirectState(user.state);

  const { resolveWhatsAppStartPrompt, whatsappActivationAction } =
    await import("./whatsapp-activation");
  const hasIncomingContent = Boolean(
    text.trim() ||
    postbackPayload ||
    nativeOrder ||
    payload.message?.attachments?.some(
      (attachment) =>
        attachment.type !== "template" && Boolean(attachment.url || attachment.payload),
    ),
  );
  const activationAction = whatsappActivationAction({
    platform,
    state: directState,
    isStartCommand,
    hasIncomingContent,
    startPromptEnabled: setting("start_prompt_enabled") !== "false",
  });

  if (activationAction === "start") {
    await startFlow.restartDirectFlow(user.user_key);
    await sendLanguagePicker(conversationId, accountId, user);
    return;
  }
  if (activationAction === "prompt") {
    if (await startFlow.claimWhatsAppStartPrompt(user.user_key)) {
      const sent = await reply(
        user,
        conversationId,
        accountId,
        resolveWhatsAppStartPrompt(setting("start_prompt")),
        undefined,
        true,
      );
      if (!sent) await startFlow.releaseWhatsAppStartPrompt(user.user_key);
    }
    return;
  }
  if (activationAction === "wait") return;

  const triggerWords = parseTriggerWords(setting("triggers"));

  /**
   * Чем новый покупатель будит бота.
   *
   * В Instagram это только `/start` — сознательное решение (коммит «require
   * start before Direct store activation»): бот не должен вклиниваться в
   * обычную переписку продавца. Менять это здесь нечем и незачем.
   *
   * WhatsApp до этого места доходит только после отдельного activation gate
   * выше: первое произвольное сообщение получает одну подсказку, а `/start`
   * сразу переводит диалог на выбор языка.
   */
  const wakesNewCustomer = isStartCommand;

  /**
   * Первое сообщение от нового отправителя — раньше чего бы то ни было ещё.
   *
   * У Instagram Direct нет команды `/start`, а значит нет и естественной
   * точки, где, как в Telegram-боте, спросить язык. Заводим её сами: как
   * только `upsertZernioUser` завела запись впервые, показываем выбор языка и
   * останавливаемся — весь остальной разбор этого события подождёт следующего
   * сообщения. Проверка нарочно ничего не знает про текст, вложение или
   * постбэк: даже если самое первое событие от человека — вложение или нажатая
   * кнопка автоматизации воронки, язык важнее и должен быть выбран раньше.
   */
  if (!directState.locale && !directState.mode) {
    if (!wakesNewCustomer) return;
    await sendLanguagePicker(conversationId, accountId, user);
    return;
  }

  const lower = effectiveText.toLowerCase();

  /**
   * Пошаговая покупка. Стоит раньше всех прочих разборов: пока диалог на шаге
   * сценария, реплика покупателя — это ответ на заданный вопрос, а не команда
   * и не поисковый запрос. Раньше состояния не было вовсе, и «Казахстан» в
   * ответ на «из какой вы страны» уходило искать товар с таким названием.
   */
  // Чеком считаем только картинку или файл — см. pickReceiptAttachment: там же
  // и разбор того, почему голосовое сообщение чеком быть не должно.
  const { pickExpectedReceiptAttachment, pickReceiptAttachment } = await import("./direct-flow");
  const attachments = payload.message?.attachments;
  const expectsReceipt =
    directState.mode === "awaiting_proof" ||
    directState.mode === "processing_proof" ||
    directState.mode === "awaiting_email";
  const attachmentUrl =
    (expectsReceipt
      ? pickExpectedReceiptAttachment(attachments)
      : pickReceiptAttachment(attachments)) ?? undefined;

  /**
   * Пустое событие — не сообщение, и отвечать на него нечем.
   *
   * Instagram присылает эхо шаблонов: direction incoming, текста нет, вложение
   * типа template без ссылки и с пустыми elements. Таких событий в логах 513 из
   * 8265, и каждое доходило до разбора свободной реплики — то есть в режиме
   * «отвечать на всё» человек мог получить приветствие и «передал ваш вопрос
   * продавцу» с пустым вопросом, ни о чём никого не спросив.
   */
  if (!text.trim() && postbackPayload === null && !attachmentUrl) {
    console.log(`[zernio-bot] пустое событие от ${userKey} — отвечать нечем`);
    return;
  }

  /**
   * Покупатель прислал корзину из нативного каталога WhatsApp.
   *
   * Свой каталог у нас собственный (товары ведутся в админке, а не в Commerce
   * Manager у Meta), так что оформить такую корзину напрямую нечем: в ней
   * артикулы Meta, которых в нашей базе нет. Но промолчать нельзя — человек
   * только что нажал «Отправить заказ» и ждёт ответа. Показываем каталог и
   * зовём продавца.
   */
  if (nativeOrder) {
    console.log(
      `[zernio-bot] нативная корзина Meta от ${userKey}: ${nativeOrder.items.length} поз., каталог ${nativeOrder.catalogId}`,
    );
    await sendCatalogMenu(conversationId, accountId, user);
    await startFlow.notifyAdminAboutNativeCart({
      senderName,
      senderUsername,
      items: nativeOrder.items,
      note: nativeOrder.note,
    });
    return;
  }

  /**
   * Нажатие кнопки разбирается раньше шага сценария — и всегда, в любом режиме.
   *
   * Кнопка появляется в переписке только потому, что её отправили мы: в
   * ответе бота или в автоматизации воронки. Человек по ней осознанно
   * постучался — сигнала «хочу к боту» однозначнее не бывает.
   *
   * Почему именно раньше шага. Вместе с нажатием приходит и текст — видимая
   * подпись кнопки («Оформить заказ», «⛺ ЛАГЕРЬ И ВНЕУРОЧКА»). Пока нажатия
   * не распознавались вовсе, порядок был безразличен. Теперь — нет: покупатель
   * на шаге «из какой вы страны», нажав «Оформить заказ», отдал бы шагу эту
   * подпись, она не совпала бы ни с одной страной, засчитался бы промах, а
   * после второго промаха разговор ушёл бы продавцу (MAX_STEP_MISSES).
   *
   * Исключение — метка STEP:, она и есть ответ на текущий шаг и уходит в
   * сценарий ниже.
   */
  const isStepAnswer = postbackPayload?.startsWith(STEP_PREFIX) ?? false;
  if (postbackPayload !== null && !isStepAnswer && !isStartPostback) {
    console.log(`[zernio-bot] postback from ${userKey}: "${postbackPayload}"`);

    // «В корзину» — та же торговля, что и сама корзина, и гаснет вместе с ней.
    // Без этой проверки выключенный магазин всё равно принимал бы товары в
    // корзину, показать которую уже нельзя.
    if (features.cart && postbackPayload.startsWith("BUY:")) {
      // "BUY:<productId>" — товар без вариантов; "BUY:<productId>:<variantId>"
      // — выбранный вариант (Ниши, Блок D, кнопка на карточке товара).
      const [buyProductId, buyVariantId] = postbackPayload.slice(4).split(":");
      await addProductToCart(conversationId, accountId, user, buyProductId, buyVariantId || null);
      return;
    }
    if (features.cart && postbackPayload === "CART") {
      await sendCart(conversationId, accountId, user);
      return;
    }
    if (features.checkout && postbackPayload === "CHECKOUT") {
      await startInstagramCheckout(conversationId, accountId, user);
      return;
    }
    // Способ получения физического заказа (Ниши, Блок 8.3) — тап по кнопке.
    // Тот же диспетчер обслуживает и WhatsApp, и Instagram: parseZernioMessage
    // уже свёл оба нативных механизма (postback/button_reply) в одно поле
    // postbackPayload. Гейт на features.checkout — как у CHECKOUT: устаревший
    // тап при выключенном чекауте не должен падать с ошибкой.
    if (features.checkout && postbackPayload.startsWith("fulfilltype:")) {
      const typeRaw = postbackPayload.slice("fulfilltype:".length);
      if (typeRaw === "pickup" || typeRaw === "delivery") {
        await askFulfillmentDate(conversationId, accountId, user, typeRaw);
      }
      return;
    }
    if (features.checkout && postbackPayload === "fulfillnote:skip") {
      await finishFulfillmentAndShowPayment(conversationId, accountId, user, null);
      return;
    }
    // Зона доставки (Ниши, Блок B) — тап по кнопке, когда зон ≤3.
    if (features.checkout && postbackPayload.startsWith("zone:")) {
      const zoneId = postbackPayload.slice("zone:".length);
      const flow = await import("./direct-purchase.server");
      const { activeDeliveryZones } = await import("./fulfillment.server");
      const zones = await activeDeliveryZones();
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone) {
        // Зона исчезла/скрыта между показом кнопок и тапом — переспрашиваем шаг.
        await proceedToDeliveryZoneOrAddress(conversationId, accountId, user);
        return;
      }
      await flow.setDirectState(user.user_key, {
        checkout_delivery_zone_id: zone.id,
        checkout_delivery_zone_name: zone.name,
        checkout_delivery_fee: Number(zone.price),
        mode: "awaiting_address",
      });
      const locale = flow.directLocale(flow.readDirectState(user.state));
      await reply(user, conversationId, accountId, directCopy[locale].fulfillmentAddressPrompt);
      return;
    }
    if (features.catalog && postbackPayload === "CATALOG") {
      await sendCatalogMenu(conversationId, accountId, user);
      return;
    }
    if (features.catalog) {
      const level = parseCatalogPayload(postbackPayload);
      if (level) {
        await sendWhatsAppCatalogLevel(
          conversationId,
          accountId,
          user,
          level.parentId,
          level.offset,
        );
        return;
      }
      if (postbackPayload.startsWith(PROD_PREFIX)) {
        await sendWhatsAppProductCard(
          conversationId,
          accountId,
          user,
          postbackPayload.slice(PROD_PREFIX.length),
        );
        return;
      }
    }

    /**
     * Чужая кнопка — например `ACT::…` от родной автоматизации Zernio, такие
     * в журнале есть. Отвечает на неё та автоматизация, которая её и
     * прислала; наше дело — не принять её подпись за реплику покупателя.
     */
    if (postbackPayload) return;
  }

  /**
   * Ответ на шаг сценария, пришедший строкой списка, а не текстом.
   *
   * У такого события текста нет вовсе — выбор лежит в postback с меткой
   * STEP:. Подставляем его как реплику покупателя, чтобы шаг разобрал ответ
   * тем же кодом, что и напечатанный вручную.
   */
  const flowText = isStepAnswer ? postbackPayload!.slice(STEP_PREFIX.length) : effectiveText;

  const handledByFlow = await handlePurchaseFlow({
    conversationId,
    accountId,
    user,
    text: flowText,
    attachmentUrl,
    answersEverything,
  });
  if (handledByFlow) return;

  /**
   * Слово-вызов: им человек сам звонит боту.
   *
   * В тихом режиме бот молчит по обычной переписке, и нужен способ его
   * позвать. Список задаёт продавец — он лучше знает, что пишут в его
   * переписках, а значит и какие слова у него не встречаются в обычном
   * разговоре. Сравнение по целому сообщению, а не по вхождению: «а магазин
   * у вас где?» боту не адресовано, а «Магазин» — адресовано.
   */
  const plain = lower.trim().replace(/[.!?]+$/, "");
  const { matchDirectCommand } = await import("./direct-flow");
  const command = matchDirectCommand(effectiveText);

  /**
   * Корзина, оформление и «мои заказы» отвечают в любом режиме.
   *
   * Это не болтовня, а обслуживание собственной покупки: человек хочет
   * посмотреть, что набрал, оплатить или узнать, где его материалы. Оставлять
   * такие вопросы продавцу — значит грузить его тем, на что бот отвечает
   * точнее и мгновенно.
   *
   * Команда опознаётся по целому сообщению (см. matchDirectCommand), поэтому
   * «а где мой заказ, я оплатила вчера» командой не считается и уйдёт
   * продавцу, как и должно.
   */
  if (features.cart && command === "cart") {
    await sendCart(conversationId, accountId, user);
    return;
  }
  if (features.checkout && command === "checkout") {
    await startInstagramCheckout(conversationId, accountId, user);
    return;
  }
  if (command === "orders") {
    await sendOrders(conversationId, accountId, user);
    return;
  }
  /**
   * Смена языка — тоже обслуживание себя, а не болтовня, и отвечает в любом
   * режиме, как корзина и оформление чуть выше. Внутри шага сценария (страна,
   * чек, почта) слово-команда не ловится вовсе — так же, как не ловятся здесь
   * «корзина» и «оформить»: до этого места разбор просто не доходит, реплику
   * уже забирает шаг (см. handlePurchaseFlow).
   */
  if (command === "language") {
    await sendLanguagePicker(conversationId, accountId, user);
    return;
  }

  if (triggerWords.includes(plain)) {
    await sendCatalogMenu(conversationId, accountId, user);
    return;
  }

  /**
   * Дальше идут ответы на всё подряд — команды, поиск, свободные вопросы.
   * В режиме «только покупки» мы сюда не заходим: выше уже отработало всё, что
   * относится к заказу и к осознанному обращению к боту, а остальное — обычная
   * переписка продавца с людьми, и лезть в неё незачем.
   */
  if (!answersEverything) {
    console.log(`[zernio-bot] режим «только покупки»: сообщение от ${userKey} оставлено продавцу`);
    return;
  }

  if (features.catalog && command === "catalog") {
    await sendCatalogMenu(conversationId, accountId, user);
    return;
  }

  /**
   * Поиск остаётся, но только по явной просьбе.
   *
   * Раньше в него проваливалась любая реплика, и это ломало разговор. Сам по
   * себе поиск полезен — покупатель может не знать номера, — поэтому он никуда
   * не делся, просто теперь его надо попросить: «поиск пазлы».
   */
  const searchMatch = lower.match(/^(?:поиск|найти|найди)\s+(.{2,})$/);
  if (features.search && searchMatch) {
    await sendInteractiveProductResults(conversationId, accountId, user, searchMatch[1].trim());
    return;
  }

  /**
   * Свободная реплика — это вопрос, а не поисковый запрос.
   *
   * Здесь была главная поломка Direct: в поиск товаров уходил любой текст
   * длиннее одного символа. «Здравствуйте», «а скидка есть?» и ответ на
   * авто-DM из воронки одинаково превращались в запрос к каталогу и получали
   * «ничего не нашлось» — человек упирался в стену на первой же фразе.
   *
   * Теперь поиском занимается только то, что похоже на номер товара (это
   * разбирает handlePurchaseFlow выше). Сюда доходит именно вопрос: отвечаем
   * заготовленным текстом и зовём продавца — ответить живому человеку он
   * может из админки.
   */
  const flow = await import("./direct-purchase.server");
  const questionState = flow.readDirectState(user.state);
  const copy = directCopy[flow.directLocale(questionState)];
  const now = Date.now();

  /**
   * Здороваемся один раз за разговор.
   *
   * Раньше полное приветствие уходило на каждую реплику: человек писал «не
   * нужно», а в ответ снова получал «Здравствуйте! …напишите номер товара», и
   * так по кругу. Теперь первое сообщение — приветствие, дальше короткое
   * подтверждение, что вопрос передан.
   */
  const greetedRecently =
    Boolean(questionState.greeted_at) &&
    now - Date.parse(questionState.greeted_at!) < 12 * 60 * 60 * 1000;

  /**
   * Продавца зовём не чаще раза в час на собеседника: переписка из пяти реплик
   * не должна превращаться в пять одинаковых уведомлений в Telegram.
   */
  const notifiedRecently =
    Boolean(questionState.notified_at) &&
    now - Date.parse(questionState.notified_at!) < 60 * 60 * 1000;

  if (!notifiedRecently) {
    await flow.notifyAdminAboutQuestion({
      question: text,
      senderName,
      senderUsername,
      platform: platformOf(user),
    });
  }

  const stamp = new Date().toISOString();
  await flow.setDirectState(user.user_key, {
    ...questionState,
    greeted_at: greetedRecently ? questionState.greeted_at : stamp,
    notified_at: notifiedRecently ? questionState.notified_at : stamp,
  });

  await reply(
    user,
    conversationId,
    accountId,
    greetedRecently ? copy.greetingShort : setting("script") || copy.greetingFull(senderName),
  );
}

/**
 * Отправить главное меню и список категорий
 */
/**
 * Меню в ответ на команду.
 *
 * Было хуже, чем бесполезно, и это видно по живой переписке. Меню печатало
 * нумерованный список разделов и просило «написать название категории или тему
 * для поиска», но:
 *
 *  • названия категорий бот не понимал вовсе, а обычный текст перестал уходить
 *    в поиск (для него теперь нужно «поиск …») — то есть инструкция врала;
 *  • номера разделов сталкивались с номерами товаров. Человек отвечал «1»,
 *    имея в виду первый раздел, а бот находил товар «001» и начинал оформление
 *    заказа на него. Ровно это и произошло при проверке;
 *  • кнопка «Корзина» вела в старый путь с оплатой через Robokassa, тогда как
 *    заказы теперь оформляются по чеку с выдачей на почту.
 *
 * Теперь меню говорит ровно то, что бот действительно умеет: принять номер
 * товара. Разбирать каталог удобнее в Telegram-боте — туда и ведём.
 */
async function sendCatalogMenu(conversationId: string, accountId: string, user: ZernioBotUser) {
  const flow = await import("./direct-purchase.server");
  const state = flow.readDirectState(user.state);
  const copy = directCopy[flow.directLocale(state)];

  /**
   * В WhatsApp каталог — настоящий список с заходом по разделам.
   *
   * Инстаграмная витрина ниже текстовая по необходимости: там три кнопки на
   * сообщение и нет списков, поэтому единственный способ выбрать — попросить
   * прислать номер из публикации.
   */
  if (platformOf(user) === "whatsapp") {
    await sendWhatsAppCatalogLevel(conversationId, accountId, user, null, 0);
    return;
  }

  const botLink = await telegramBotLink();
  const lines = [copy.catalogIntro, "", copy.catalogNumberHint];

  if (botLink) {
    lines.push("", copy.catalogBotLink(botLink));
  }

  // «/start», «купить» и прочие слова-вызовы — явное повторное обращение
  // человека. После «стоп» он должен получить меню даже если его текст
  // полностью совпадает с последним ответом менее чем десять минут назад.
  await reply(user, conversationId, accountId, lines.join("\n"), undefined, true);
}

/** Строка каталога: `CAT:<id|root>:<offset>` — уровень, `PROD:<id>` — карточка. */
const CAT_PREFIX = "CAT:";
const PROD_PREFIX = "PROD:";
const CAT_ROOT = "root";

/** Разбор `CAT:<id|root>:<offset>`. Возвращает null, если это не наша строка. */
export function parseCatalogPayload(
  payload: string,
): { parentId: string | null; offset: number } | null {
  if (!payload.startsWith(CAT_PREFIX)) return null;
  // Идентификатор категории — UUID без двоеточий, так что split безопасен.
  const [, rawId, rawOffset] = payload.split(":");
  if (!rawId) return null;
  const offset = Number(rawOffset ?? 0);
  return {
    parentId: rawId === CAT_ROOT ? null : rawId,
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
  };
}

/**
 * Один уровень каталога одним списком.
 *
 * Устроен так же, как каталог телеграм-бота (`showCategories` в
 * bot.server.ts): вложенные категории по `parent_id`, товары уровня по
 * `category_ids`, в корне — товары без категории вовсе. Запросы намеренно
 * повторяют тамошние, чтобы витрина в двух каналах показывала одно и то же:
 * `category_ids` здесь авторитетна, а `category_id` — синхронизируемый
 * пережиток, который бот не читает.
 *
 * Постраничность обязательна: у самого крупного клиента 387 товаров и 50
 * категорий, а в список WhatsApp помещается десять строк на всё сообщение.
 */
async function sendWhatsAppCatalogLevel(
  conversationId: string,
  accountId: string,
  user: ZernioBotUser,
  parentId: string | null,
  offset: number,
) {
  const flow = await import("./direct-purchase.server");
  const state = flow.readDirectState(user.state);
  const copy = directCopy[flow.directLocale(state)];
  const s = await db();

  const categoriesQuery = s
    .from("categories")
    .select("id, name, parent_id")
    .eq("is_visible", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const { data: categories } = parentId
    ? await categoriesQuery.eq("parent_id", parentId)
    : await categoriesQuery.is("parent_id", null);

  const productsQuery = s
    .from("products")
    .select("id, name, price, currency, country_prices")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const { data: products } = parentId
    ? await productsQuery.contains("category_ids", JSON.stringify([parentId]))
    : await productsQuery.eq("category_ids", "[]");

  const cats = categories ?? [];
  const prods = products ?? [];

  /**
   * Совсем пусто — так и сказать.
   *
   * Раньше этот случай проваливался в текстовую инструкцию «напишите номер из
   * публикации», и покупатель пустого магазина получал совет искать номер там,
   * где ничего нет.
   */
  if (cats.length === 0 && prods.length === 0) {
    if (parentId) {
      // Пустая категория — не тупик: вернём человека на уровень выше.
      await sendWhatsAppCatalogLevel(conversationId, accountId, user, null, 0);
      return;
    }
    await reply(user, conversationId, accountId, copy.catalogEmpty, undefined, true);
    return;
  }

  /**
   * Маленький раздел показываем карточками с фото, а не строчками.
   *
   * В строке списка картинки нет и быть не может — у Meta в этом типе
   * сообщения такого поля нет вовсе. А на живом каталоге нашлись товары, у
   * которых совпадают и название, и описание, и различает их только
   * фотография: строчкой такие не различить ничем.
   *
   * Порог низкий намеренно. Карточка — отдельное сообщение, и пять подряд в
   * мессенджере, где продавец ещё и живьём переписывается, это предел
   * терпимого; на большем список выигрывает у ленты сообщений. Подкатегории
   * тоже блокируют этот путь: их в карточках не покажешь, а терять раздел
   * нельзя.
   */
  if (cats.length === 0 && prods.length > 0 && prods.length <= WA_PHOTO_GALLERY_MAX) {
    // «Назад» с карточки — на уровень выше, а не в этот же раздел: карточки
    // сейчас и есть он сам.
    const upper = parentId ? await parentCategoryOf(s, parentId) : null;
    for (const product of prods) {
      await sendWhatsAppProductCard(conversationId, accountId, user, product.id, upper ?? CAT_ROOT);
    }
    return;
  }

  // Категории и товары нумеруются одной сквозной страницей: иначе на уровне с
  // девятью разделами товары не показались бы никогда.
  const entries = [
    ...cats.map((category) => ({ kind: "category" as const, row: category })),
    ...prods.map((product) => ({ kind: "product" as const, row: product })),
  ];
  const page = entries.slice(offset, offset + WA_LIST_PAGE_SIZE);
  const hasMore = offset + WA_LIST_PAGE_SIZE < entries.length;

  const country = state.country_code ?? null;
  const categoryRows: WhatsAppListRow[] = [];
  const productRows: WhatsAppListRow[] = [];

  for (const entry of page) {
    if (entry.kind === "category") {
      categoryRows.push({
        id: `${CAT_PREFIX}${entry.row.id}:0`,
        title: String(entry.row.name),
      });
      continue;
    }
    const money = await flow.resolveProductPrice(entry.row, country);
    productRows.push({
      // Карточка, а не сразу в корзину: в строке помещается 24 символа, а
      // названия у клиентов бывают за сотню — без карточки покупатель выбирал
      // бы товар по обрубку.
      id: `${PROD_PREFIX}${entry.row.id}`,
      title: String(entry.row.name),
      description: rowSubtitle(String(entry.row.name), `${money.amount} ${money.currency}`),
    });
  }

  const navRows: WhatsAppListRow[] = [];
  if (hasMore) {
    navRows.push({
      id: `${CAT_PREFIX}${parentId ?? CAT_ROOT}:${offset + WA_LIST_PAGE_SIZE}`,
      title: copy.catalogMore,
    });
  }
  if (parentId || offset > 0) {
    /**
     * Наверх — к родителю ТЕКУЩЕЙ категории, и его надо спросить отдельно.
     *
     * Соблазн взять `cats[0].parent_id` обманчив: `cats` — это дети текущей
     * категории, значит их `parent_id` и есть `parentId`. «Назад» тогда ведёт
     * на тот же самый уровень, то есть никуда.
     */
    const parentOfCurrent = parentId ? await parentCategoryOf(s, parentId) : null;
    navRows.push({
      id: `${CAT_PREFIX}${parentOfCurrent ?? CAT_ROOT}:0`,
      title: copy.catalogBack,
    });
  }

  await reply(
    user,
    conversationId,
    accountId,
    copy.catalogPick,
    undefined,
    true,
    whatsappList({
      body: copy.catalogPick,
      buttonLabel: copy.catalogOpenBtn,
      sections: [
        { title: copy.catalogSectionCategories, rows: categoryRows },
        { title: copy.catalogSectionProducts, rows: productRows },
        { title: "…", rows: navRows },
      ],
    }),
  );
}

/**
 * Карточка товара: фото, полное название, цена, описание и кнопка в корзину.
 *
 * Нужна именно из-за лимита строки списка в 24 символа — карточка первое
 * место, где покупатель видит название целиком.
 */
async function sendWhatsAppProductCard(
  conversationId: string,
  accountId: string,
  user: ZernioBotUser,
  productId: string,
  /**
   * Куда ведёт «Назад». По умолчанию — в категорию товара, откуда его и
   * выбирали в списке.
   *
   * Задаётся явно там, где эта догадка неверна: в витрине маленького раздела
   * карточки и есть сам раздел, и «Назад» в него вернуло бы человека ровно
   * туда, где он уже стоит. Там передаётся уровень выше.
   */
  backToOverride?: string,
) {
  const flow = await import("./direct-purchase.server");
  const state = flow.readDirectState(user.state);
  const copy = directCopy[flow.directLocale(state)];
  const s = await db();

  const { data: product } = await s
    .from("products")
    .select(
      "id, name, description, price, currency, country_prices, category_ids, is_active, product_images(image_path, sort_order), product_variants(id, name, price, sort_order)",
    )
    .eq("id", productId)
    .eq("is_active", true)
    .maybeSingle();

  if (!product) {
    await reply(user, conversationId, accountId, copy.productUnavailable);
    return;
  }

  // Варианты (Ниши, Блок D) — простой список «1 кг»/«2 кг»: кнопка на
  // каждый вариант вместо одной «В корзину». Zernio ограничивает три
  // кнопки на сообщение — ≤3 варианта помещаются кнопками (без «Назад»,
  // чтобы уместить все варианты разом), больше — тот же
  // numbered-list-с-текстовым-fallback приём, что уже решает точно такую
  // же проблему для выбора зоны доставки/страны.
  const variants = (product.product_variants ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  // Первая картинка по sort_order — как в карточке телеграм-бота.
  const images = (product.product_images ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const photo = images[0]?.image_path ? imageUrl(images[0].image_path) : null;

  // Назад — в первую категорию товара, а если её нет, в корень каталога.
  const categoryIds = Array.isArray(product.category_ids) ? product.category_ids : [];
  const backTo = backToOverride ?? (typeof categoryIds[0] === "string" ? categoryIds[0] : CAT_ROOT);
  const backButton: ZernioDmButton = {
    type: "postback",
    title: copy.catalogBack,
    payload: `${CAT_PREFIX}${backTo}:0`,
  };

  const { sendZernioInboxMessage } = await import("./zernio.server");

  if (variants.length > 3) {
    const priced = await Promise.all(
      variants.map(async (v) => ({
        v,
        money: await flow.resolveProductPrice(product, state.country_code ?? null, v),
      })),
    );
    const currency = priced[0]?.money.currency ?? product.currency ?? "KZT";
    const description = product.description
      ? `\n\n${String(product.description).slice(0, 600)}`
      : "";
    const text =
      `📦 *${product.name}*${description}\n\n` +
      flow.renderVariantPrompt(
        priced.map(({ v, money }) => ({ name: v.name, price: money.amount })),
        currency,
        flow.directLocale(state),
      );
    await flow.setDirectState(user.user_key, {
      mode: "awaiting_variant_choice",
      pending_variant_product_id: product.id,
    });
    if (photo) {
      await sendZernioInboxMessage(conversationId, accountId, "", {
        attachmentUrl: photo,
        attachmentType: "image",
        platform: "whatsapp",
      });
    }
    await reply(user, conversationId, accountId, text);
    return;
  }

  const buttons: ZernioDmButton[] =
    variants.length > 0
      ? await Promise.all(
          variants.map(async (v) => {
            const money = await flow.resolveProductPrice(product, state.country_code ?? null, v);
            return {
              type: "postback" as const,
              title: `${v.name} — ${money.amount} ${money.currency}`,
              payload: `BUY:${product.id}:${v.id}`,
            };
          }),
        )
      : [{ type: "postback", title: copy.btnAddToCart, payload: `BUY:${product.id}` }, backButton];

  const money =
    variants.length === 0
      ? await flow.resolveProductPrice(product, state.country_code ?? null)
      : null;
  const description = product.description ? `\n\n${String(product.description).slice(0, 600)}` : "";
  const text = money
    ? `📦 *${product.name}*\n💰 ${money.amount} ${money.currency}${description}`
    : `📦 *${product.name}*${description}`;

  if (photo) {
    /**
     * Фото и кнопки одним сообщением: Zernio собирает из вложения заголовок
     * интерактивного сообщения с кнопками. Если конкретный аккаунт так не
     * умеет, откатываемся на «фото отдельно, текст с кнопками следом» — тем
     * же приёмом, что применён для QR-кода реквизитов в bot.server.ts.
     */
    const combined = await sendZernioInboxMessage(conversationId, accountId, text, {
      attachmentUrl: photo,
      attachmentType: "image",
      buttons,
      platform: "whatsapp",
    });
    if (combined.ok) return;

    await sendZernioInboxMessage(conversationId, accountId, "", {
      attachmentUrl: photo,
      attachmentType: "image",
      platform: "whatsapp",
    });
  }

  await reply(user, conversationId, accountId, text, buttons, true);
}

/**
 * Поиск и отправка товаров в DM
 */
async function sendInteractiveProductResults(
  conversationId: string,
  accountId: string,
  user: ZernioBotUser,
  query: string,
) {
  const flow = await import("./direct-purchase.server");
  const state = flow.readDirectState(user.state);
  const copy = directCopy[flow.directLocale(state)];

  const isWhatsApp = platformOf(user) === "whatsapp";

  const s = await db();
  const { data: products } = await s
    .from("products")
    // country_prices нужен для расчёта цены: в выдаче поиска показывалась
    // базовая цена товара, а она у клиента намеренно завышена. product_variants
    // (Ниши, Блок D) — узнать, есть ли у товара варианты (id достаточно, сами
    // варианты выбираются на полной карточке).
    .select(
      "id, name, price, currency, country_prices, description, is_active, product_variants(id)",
    )
    .eq("is_active", true)
    .or(`name.ilike.%${query}%,description.ilike.%${query}%,keywords.ilike.%${query}%`)
    // В WhatsApp выдача помещается в один список — берём столько же, сколько
    // и страница каталога. В Instagram каждый товар уходит отдельным
    // сообщением, и пять — предел разумного.
    .limit(isWhatsApp ? WA_LIST_PAGE_SIZE : 5);

  if (!products?.length) {
    await reply(
      user,
      conversationId,
      accountId,
      // В WhatsApp каталог открывается тут же, звать в другой бот незачем.
      isWhatsApp
        ? copy.searchNoResultsHere(query)
        : copy.searchNoResults(query, (await telegramBotLink()) ?? ""),
      [{ type: "postback", title: copy.btnCatalog, payload: "CATALOG" }],
    );
    return;
  }

  /**
   * В WhatsApp результаты — один список, а не пачка сообщений.
   *
   * Пять отдельных сообщений подряд в мессенджере, где человек переписывается
   * с живым продавцом, выглядят как спам; список занимает одно сообщение и
   * ведёт в ту же карточку товара, что и каталог.
   */
  if (isWhatsApp) {
    const country = state.country_code ?? null;
    const rows: WhatsAppListRow[] = [];
    for (const product of products) {
      const money = await flow.resolveProductPrice(product, country);
      rows.push({
        id: `${PROD_PREFIX}${product.id}`,
        title: String(product.name),
        description: rowSubtitle(String(product.name), `${money.amount} ${money.currency}`),
      });
    }

    await reply(
      user,
      conversationId,
      accountId,
      copy.searchFoundCount(products.length),
      undefined,
      true,
      whatsappList({
        body: copy.searchFoundCount(products.length),
        buttonLabel: copy.catalogOpenBtn,
        sections: [{ title: copy.catalogSectionProducts, rows }],
      }),
    );
    return;
  }

  // Список идёт отдельными сообщениями с кнопками у каждого товара — через
  // защиту от повторов их не гоняем: тексты и так все разные.
  await sendZernioInboxMessage(conversationId, accountId, copy.searchFoundCount(products.length));
  const country = state.country_code ?? null;
  for (const product of products) {
    const description = product.description ? `\n${String(product.description).slice(0, 180)}` : "";
    // Товар с вариантами (Ниши, Блок D) — здесь неоткуда взять, какой вариант
    // выбрать (это отдельное сообщение без кнопок на каждый вариант, лимит
    // Zernio — три на сообщение, а тут уже занято «Корзиной»), поэтому ведём
    // на полную карточку (PROD_PREFIX → sendWhatsAppProductCard), где выбор
    // варианта уже решён кнопками/пронумерованным списком.
    const hasVariants = (product.product_variants?.length ?? 0) > 0;
    if (hasVariants) {
      await sendZernioInboxMessage(conversationId, accountId, `📌 ${product.name}${description}`, {
        buttons: [
          {
            type: "postback",
            title: copy.btnChooseVariant,
            payload: `${PROD_PREFIX}${product.id}`,
          },
          { type: "postback", title: copy.btnCart, payload: "CART" },
        ],
      });
      continue;
    }
    const money = await flow.resolveProductPrice(product, country);
    await sendZernioInboxMessage(
      conversationId,
      accountId,
      `📌 ${product.name}\n💰 ${money.amount} ${money.currency}${description}`,
      {
        buttons: [
          { type: "postback", title: copy.btnAddToCart, payload: `BUY:${product.id}` },
          { type: "postback", title: copy.btnCart, payload: "CART" },
        ],
      },
    );
  }
}

/**
 * Добавление по кнопке «Купить» из автоматизации воронки.
 *
 * Ведёт в ту же корзину, что и номер материала: путей оформления должно быть
 * ровно столько, сколько путей выдачи, то есть один. Прежняя версия
 * увеличивала количество при повторном нажатии — для цифрового материала это
 * бессмысленно, второй экземпляр того же файла человеку не нужен.
 */
async function addProductToCart(
  conversationId: string,
  accountId: string,
  user: ZernioBotUser,
  productId: string,
  variantId?: string | null,
) {
  const flow = await import("./direct-purchase.server");
  const copy = directCopy[flow.directLocale(flow.readDirectState(user.state))];
  const s = await db();
  const { data: product } = await s
    .from("products")
    .select("id, name, is_active")
    .eq("id", productId)
    .maybeSingle();

  if (!product?.is_active) {
    await reply(user, conversationId, accountId, copy.productUnavailable);
    return;
  }
  if (!(await flow.productHasFiles(product.id))) {
    await reply(user, conversationId, accountId, copy.productNoFiles(product.name));
    return;
  }
  if (!(await flow.cartAllowsProduct(user, product.id))) {
    await reply(user, conversationId, accountId, copy.productMixedCart(product.name));
    return;
  }

  // addToCart сама проверяет, что variantId реально принадлежит этому
  // товару (Ниши, Блок D) — не дублируем проверку здесь.
  await flow.addToCart(user, product.id, variantId ?? null);
  // Товар в корзине — счётчик непонятых реплик обнуляем: человек явно понял,
  // что от него нужно, и прежние промахи к делу больше не относятся.
  await flow.setDirectState(user.user_key, { misses: 0, mode: undefined });
  await sendCart(conversationId, accountId, user);
}

/** Показывает корзину и кнопку оформления. */
async function sendCart(conversationId: string, accountId: string, user: ZernioBotUser) {
  const flow = await import("./direct-purchase.server");
  const state = flow.readDirectState(user.state);
  const copy = directCopy[flow.directLocale(state)];
  const cart = await flow.readCart(user);

  if (cart.length === 0) {
    await reply(user, conversationId, accountId, copy.cartEmptyHint);
    return;
  }

  const total = await flow.priceCart(cart, state.country_code ?? null);
  await reply(
    user,
    conversationId,
    accountId,
    `${copy.cartHeader(cart.length)}\n\n` +
      `${flow.renderCart(total.lines)}\n\n` +
      (cart.length > 1 && !total.mixedCurrency
        ? copy.cartTotal(total.total, total.currency) + "\n\n"
        : "") +
      (cart.length > 1 ? copy.cartHintMulti : copy.cartHintSingle),
    [{ type: "postback", title: copy.btnCheckout, payload: "CHECKOUT" }],
  );
}
async function sendOrders(conversationId: string, accountId: string, user: ZernioBotUser) {
  const flow = await import("./direct-purchase.server");
  const copy = directCopy[flow.directLocale(flow.readDirectState(user.state))];
  const s = await db();
  const { data: orders } = await s
    .from("orders")
    .select("*")
    .eq("telegram_id", user.telegram_id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!orders || orders.length === 0) {
    await reply(user, conversationId, accountId, copy.noOrders);
    return;
  }

  /**
   * Названия статусов для покупателя.
   *
   * Прежний набор был из другой жизни: «paid» и «cancelled» в базе не
   * встречаются вовсе, зато не было awaiting_confirmation — а именно в нём
   * заказ и проводит время, пока продавец сверяет чек. Покупатель видел просто
   * технический код и не понимал, ждать ему или писать.
   */
  const statusMap = copy.orderStatus;

  let msg = copy.ordersHeader;
  orders.forEach((o) => {
    const label = statusMap[o.status as OrderStatusKey] || o.status;
    msg += copy.orderLine(o.order_no ?? o.id, o.total, o.currency, label);
  });

  await reply(user, conversationId, accountId, msg);
}

/**
 * Обработать входящий комментарий к публикации/Reels (Comment-to-DM).
 * Соответствует спецификации Zernio Webhooks: payload.comment, payload.post, payload.account
 */
/**
 * Переход к оплате: спрашиваем страну, дальше сценарий с чеком.
 *
 * Здесь была ловушка. Прежняя версия оформляла заказ через корзину и Robokassa,
 * ставила статус awaiting_payment и **не спрашивала почту** — а заказы из
 * Instagram выдаются письмом. Дальше тупик был в любом случае: подтверждение
 * продавцом падало с «не указана почта покупателя», а автовыдача после
 * Robokassa пыталась отправить документ вложением в Instagram, чего Instagram
 * не принимает. Попасть туда можно было прямо сейчас — кнопкой «Оформить
 * заказ» из старых автоматизаций воронки.
 *
 * Теперь путь один: корзина → страна → реквизиты → чек → почта → подтверждение
 * продавцом → материалы письмом.
 */
async function startInstagramCheckout(
  conversationId: string,
  accountId: string,
  user: ZernioBotUser,
) {
  const flow = await import("./direct-purchase.server");
  const cart = await flow.readCart(user);

  /**
   * Оформлять нечего — и это не повод отвечать одно и то же.
   *
   * В живой переписке покупательница получила «Корзина пуста» на жалобу о
   * неполученном материале, нажала «Оформить заказ» — и получила тот же текст
   * второй раз. Разбор команд уже исправлен, но сама тупиковая ветка осталась:
   * кнопка живёт в старых автоматизациях воронки, и по ней приходят люди с
   * пустой корзиной.
   *
   * Поэтому здесь одна подсказка, а на второй раз — продавец. Если человек
   * дважды не понял, чего от него хотят, третья попытка бота не поможет.
   */
  if (cart.length === 0) {
    const state = flow.readDirectState(user.state);
    const copy = directCopy[flow.directLocale(state)];

    // Разговор уже у продавца — кнопку человек мог нажать от растерянности, и
    // очередная подсказка от бота ему сейчас не нужна.
    if (flow.handedToHuman(state)) {
      console.log(`[zernio-bot] «Оформить» при пустой корзине от ${user.user_key} — молчим`);
      return;
    }

    const attempts = (state.misses ?? 0) + 1;

    if (attempts >= flow.MAX_STEP_MISSES) {
      await flow.clearDirectFlow(user.user_key);
      await reply(user, conversationId, accountId, copy.checkoutGiveUp);
      await flow.notifyAdminAboutQuestion({
        question: "Нажимает «Оформить заказ», но в корзине ничего нет — не может выбрать материал.",
        senderName: user.first_name || "покупатель",
        senderUsername: user.username || "",
        platform: platformOf(user),
      });
      return;
    }

    await flow.setDirectState(user.user_key, { misses: attempts });
    await reply(user, conversationId, accountId, copy.checkoutNeedNumber);
    return;
  }

  const options = await flow.listCountries();
  const state = flow.readDirectState(user.state);
  const locale = flow.directLocale(state);
  if (options.length === 0) {
    await reply(user, conversationId, accountId, directCopy[locale].noPaymentMethods);
    return;
  }

  /**
   * Страну помним между заказами и второй раз не спрашиваем.
   *
   * Она не меняется, а каждый лишний вопрос на пути к оплате — это место, где
   * человек передумает. Постоянный покупатель теперь идёт короче: номер →
   * «Оформить» → реквизиты. Название страны бот проговаривает, чтобы можно было
   * возразить, и напоминает про «отмена», если она всё-таки другая.
   */
  const remembered = state.country_code
    ? options.find((option) => option.code === state.country_code)
    : undefined;

  if (remembered) {
    await proceedToFulfillmentOrPayment(conversationId, accountId, user, remembered, true);
    return;
  }

  /**
   * Пока страна неизвестна, цены считаются по домашней стране продавца — так
   * покупатель видит настоящую цену, а не завышенную базовую. Если он назовёт
   * другую страну, сумма пересчитается в её валюте на следующем шаге.
   */
  await flow.setDirectState(user.user_key, { mode: "awaiting_country" });
  const shown = await flow.priceCart(cart, null);
  const cartText = `${directCopy[locale].orderCartHeader}\n${flow.renderCart(shown.lines)}`;

  /**
   * Страна — вторая точка, где Instagram вынужден просить «ответьте номером»:
   * стран у продавца больше трёх, а кнопок на сообщение три. В WhatsApp это
   * список. Номер в payload, а не код страны: `matchCountry` разбирает и
   * номер, и название, так что выбор списком и ответ текстом сходятся в одну
   * ветку.
   */
  if (platformOf(user) === "whatsapp" && options.length) {
    await reply(
      user,
      conversationId,
      accountId,
      cartText,
      undefined,
      false,
      whatsappList({
        body: `${cartText}\n\nОткуда вы? От страны зависят реквизиты и валюта.`,
        buttonLabel: "Выбрать страну",
        sections: [
          {
            title: "Страна",
            rows: options.map((option, index) => ({
              id: `${STEP_PREFIX}${index + 1}`,
              title: option.name,
            })),
          },
        ],
      }),
    );
    return;
  }

  await reply(
    user,
    conversationId,
    accountId,
    `${cartText}\n\n` + flow.renderCountryPrompt(options, locale),
  );
}

/**
 * Реквизиты и итог по корзине. Общий шаг для обоих путей: когда страну только
 * что назвали и когда взяли из памяти.
 */
async function sendDirectPaymentDetails(params: {
  conversationId: string;
  accountId: string;
  user: ZernioBotUser;
  country: { code: string; name: string };
  remembered: boolean;
}) {
  const { conversationId, accountId, user, country, remembered } = params;
  const flow = await import("./direct-purchase.server");
  const state = flow.readDirectState(user.state);
  const say = (message: string) => reply(user, conversationId, accountId, message);
  const copy = directCopy[flow.directLocale(state)];

  const requisites = await flow.paymentInstructionsFor(country.code);
  if (!requisites) {
    await say(copy.noRequisitesForCountry);
    await flow.clearDirectFlow(user.user_key);
    return;
  }

  const cart = await flow.readCart(user);
  if (cart.length === 0) {
    await say(copy.cartEmptiedRestart);
    await flow.clearDirectFlow(user.user_key);
    return;
  }

  // Цены — в валюте выбранной страны: покупателю из России сумма и реквизиты
  // должны совпадать по валюте, иначе он платит непонятно сколько.
  const {
    lines: pricedLines,
    total: cartTotal,
    currency,
    mixedCurrency,
  } = await flow.priceCart(cart, country.code);
  if (mixedCurrency) {
    // Складывать разные валюты нельзя: сумма получилась бы бессмысленной.
    await say(copy.mixedCurrencySplit);
    return;
  }
  // Комиссия зоны доставки (Ниши, Блок B) — обязательно ДО заморозки: сумма,
  // которую видит и по которой платит покупатель, должна совпадать с той,
  // что попадёт в orders.total через createOrderFromCart (см. frozen_cart).
  const deliveryFee = state.checkout_delivery_fee ?? 0;
  const amount = cartTotal + deliveryFee;

  await flow.setDirectState(user.user_key, {
    mode: "awaiting_proof",
    country_code: country.code,
    // Замораживаем именно эту сумму — по ней покупатель платит, и по ней же
    // потом сверяет чек OCR (Блок 2.6). См. DirectState.frozen_cart.
    // mixedCurrency всегда false здесь: раньше по коду уже отбит ранний
    // выход на true.
    frozen_cart: { lines: pricedLines, total: amount, currency, mixedCurrency: false },
  });

  await say(
    `${flow.renderCart(pricedLines)}\n\n` +
      (remembered ? copy.rememberedCountryNote(country.name) : "") +
      `${requisites.instructions}\n\n` +
      copy.amountDue(amount, currency) +
      copy.sendProofHint,
  );
}

/**
 * Развилка чекаута для физических товаров (Ниши, Блок 8.3) — вставлена
 * между выбором страны и sendDirectPaymentDetails. Цифровая корзина идёт по
 * прежнему пути без единого изменения; физическая — спрашивает способ и
 * дату получения (и адрес, если доставка) до показа реквизитов.
 *
 * Важное отличие от Telegram (bot.server.ts, proceedToFulfillmentOrPlace):
 * там заказ создаётся в конце чекаута, до оплаты, поэтому собранные поля
 * просто пишутся в insert. Здесь заказ создаётся не отдельным шагом
 * «Оформить», а в реакции на уже присланный чек (createOrderFromCart,
 * см. awaiting_proof в handlePurchaseFlow) — значит данные о получении
 * нужно собрать ДО показа реквизитов, иначе `orders.fulfillment_at`
 * останется NULL у обязательного по смыслу поля (см. MIGRATION-49).
 */
async function proceedToFulfillmentOrPayment(
  conversationId: string,
  accountId: string,
  user: ZernioBotUser,
  country: { code: string; name: string },
  remembered: boolean,
) {
  const flow = await import("./direct-purchase.server");
  const { cartFulfillmentKind, fulfillmentOptionsEnabled } = await import("./fulfillment.server");

  // Страна нужна дальше, на finishFulfillmentAndShowPayment, до которого
  // пройдёт несколько реплик покупателя — запоминаем её сразу, а не
  // полагаемся на то, что это сделает sendDirectPaymentDetails в конце.
  await flow.setDirectState(user.user_key, { country_code: country.code });

  if ((await cartFulfillmentKind(user.telegram_id)) !== "physical") {
    await sendDirectPaymentDetails({ conversationId, accountId, user, country, remembered });
    return;
  }

  const locale = flow.directLocale(flow.readDirectState(user.state));
  const copy = directCopy[locale];
  const { pickup, delivery } = await fulfillmentOptionsEnabled();

  if (pickup && delivery) {
    await flow.setDirectState(user.user_key, { mode: "awaiting_fulfillment_type" });
    await reply(user, conversationId, accountId, copy.fulfillmentTypePrompt, [
      { type: "postback", title: copy.fulfillmentTypePickupBtn, payload: "fulfilltype:pickup" },
      { type: "postback", title: copy.fulfillmentTypeDeliveryBtn, payload: "fulfilltype:delivery" },
    ]);
    return;
  }
  // Продавец сам не оставил выбора (или отключил оба варианта — тогда
  // самовывоз безопаснее считать умолчанием, чем ломать чекаут), тем же
  // приёмом, что и в Telegram (bot.server.ts, proceedToFulfillmentOrPlace).
  const only: "pickup" | "delivery" = delivery ? "delivery" : "pickup";
  await askFulfillmentDate(conversationId, accountId, user, only);
}

async function askFulfillmentDate(
  conversationId: string,
  accountId: string,
  user: ZernioBotUser,
  type: "pickup" | "delivery",
) {
  const flow = await import("./direct-purchase.server");
  const { maxLeadTimeDaysInCart, todayInAppTZ, addDaysToIsoDate, isoDateToDisplay } =
    await import("./fulfillment.server");
  const minIso = addDaysToIsoDate(todayInAppTZ(), await maxLeadTimeDaysInCart(user.telegram_id));
  await flow.setDirectState(user.user_key, {
    mode: "awaiting_fulfillment_date",
    checkout_fulfillment_type: type,
  });
  const locale = flow.directLocale(flow.readDirectState(user.state));
  await reply(
    user,
    conversationId,
    accountId,
    directCopy[locale].fulfillmentDatePrompt(isoDateToDisplay(minIso)),
  );
}

/**
 * Шаг выбора зоны доставки (Ниши, Блок B) — между датой и адресом, только
 * когда выбрана доставка. Если у продавца нет ни одной активной зоны — шаг
 * пропускается целиком, сразу спрашиваем адрес (обратная совместимость).
 * ≤3 зоны — постбэк-кнопки (лимит Zernio на кнопку в сообщении), больше —
 * тот же numbered-list-с-текстовым-fallback, что уже решает точно такую же
 * проблему для выбора страны (matchCountry/renderCountryPrompt).
 */
async function proceedToDeliveryZoneOrAddress(
  conversationId: string,
  accountId: string,
  user: ZernioBotUser,
) {
  const flow = await import("./direct-purchase.server");
  const { activeDeliveryZones } = await import("./fulfillment.server");
  const locale = flow.directLocale(flow.readDirectState(user.state));
  const copy = directCopy[locale];
  const zones = await activeDeliveryZones();

  if (!zones.length) {
    await flow.setDirectState(user.user_key, { mode: "awaiting_address" });
    await reply(user, conversationId, accountId, copy.fulfillmentAddressPrompt);
    return;
  }

  await flow.setDirectState(user.user_key, { mode: "awaiting_delivery_zone" });
  if (zones.length <= 3) {
    await reply(
      user,
      conversationId,
      accountId,
      copy.deliveryZonePrompt,
      zones.map((z) => ({ type: "postback" as const, title: z.name, payload: `zone:${z.id}` })),
    );
  } else {
    await reply(user, conversationId, accountId, flow.renderDeliveryZonePrompt(zones, locale));
  }
}

/**
 * Комментарий собран (свободным текстом) или пропущен (кнопка «Без
 * комментария») — join-point обратно в уже рабочий sendDirectPaymentDetails.
 * Страна на этот момент уже осела в state (proceedToFulfillmentOrPayment).
 */
async function finishFulfillmentAndShowPayment(
  conversationId: string,
  accountId: string,
  user: ZernioBotUser,
  note: string | null,
) {
  const flow = await import("./direct-purchase.server");
  const state = flow.readDirectState(user.state);
  await flow.setDirectState(user.user_key, { checkout_fulfillment_note: note ?? undefined });

  const options = await flow.listCountries();
  const country = options.find((option) => option.code === state.country_code);
  if (!country) {
    // Реквизиты сняли уже после выбора страны — тот же путь, что и в
    // sendDirectPaymentDetails на отсутствующие реквизиты.
    const locale = flow.directLocale(state);
    await reply(user, conversationId, accountId, directCopy[locale].noRequisitesForCountry);
    await flow.clearDirectFlow(user.user_key);
    return;
  }

  await sendDirectPaymentDetails({ conversationId, accountId, user, country, remembered: false });
}

/**
 * Автовыдача после онлайн-оплаты — одним путём с ручной.
 *
 * Прежняя версия отправляла материалы вложениями прямо в переписку, с
 * `attachmentType: "file"`. Instagram документов вложением не принимает вовсе —
 * только картинки, видео и аудио, — так что эта выдача не могла работать ни при
 * каких условиях. Заказов через неё не проходило ни одного, поэтому никто и не
 * замечал.
 *
 * Теперь она передаёт заказ общей выдаче, а та для площадки instagram
 * отправляет письмо со ссылками. Если почты у заказа нет (такое возможно только
 * у старых заказов, оформленных до перехода на сценарий с чеком), выдача честно
 * скажет об этом продавцу, а не сделает вид, что всё ушло.
 */
export async function deliverInstagramOrder(orderId: number) {
  const { deliverOrder } = await import("./orders.server");
  return await deliverOrder(orderId);
}

/**
 * Аккаунт Instagram отключился от Zernio.
 *
 * Без этого истёкший или отозванный токен означает, что бот в Direct молча
 * перестаёт отвечать — ни ошибки, ни следа в логах, продавец узнаёт об этом
 * только от расстроенного покупателя. Единственное лекарство — сделать
 * смерть бота видимой, тем же каналом, что и остальные уведомления Direct.
 *
 * Не чаще раза в шесть часов на аккаунт: та же логика, что у
 * `notifyAdminAboutComplaint` — если переподключение не помогло с первого
 * раза, продавцу не нужно по письму на каждую повторную попытку.
 */
export async function handleZernioAccountDisconnected(payload: {
  account?: { accountId?: string; id?: string; _id?: string; username?: string; name?: string };
}) {
  const account = payload?.account ?? {};
  const accountId = String(account.accountId || account.id || account._id || "неизвестен");
  const label = account.username ? `@${account.username}` : account.name || accountId;

  const s = await db();
  const key = "zernio_disconnect_notified";
  const { data: setting } = await s
    .from("app_settings")
    .select("value")
    .eq("bot_id", process.env.BOT_ID?.trim() || "")
    .eq("key", key)
    .maybeSingle();

  let last: { accountId?: string; at?: string } = {};
  try {
    last = setting?.value ? JSON.parse(setting.value) : {};
  } catch {
    /* ignore malformed value, notify as usual */
  }
  const cooledDown =
    last.accountId === accountId &&
    last.at &&
    Date.now() - Date.parse(last.at) < 6 * 60 * 60 * 1000;
  if (cooledDown) {
    console.log(`[zernio-bot] account.disconnected для ${accountId} — уже уведомляли недавно`);
    return;
  }

  await s.from("app_settings").upsert({
    bot_id: process.env.BOT_ID?.trim() || "",
    key,
    value: JSON.stringify({ accountId, at: new Date().toISOString() }),
    updated_at: new Date().toISOString(),
  });

  const { data: adminSetting } = await s
    .from("app_settings")
    .select("value")
    .eq("bot_id", process.env.BOT_ID?.trim() || "")
    .eq("key", "admin_chat_id")
    .maybeSingle();
  const raw = adminSetting?.value?.trim();
  if (!raw) return;

  const { tg } = await import("./telegram.server");
  for (const chatId of raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    try {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          `🔌 <b>Instagram-аккаунт отключился</b>\n\n` +
          `${label} отвязался от Zernio — бот в Direct перестал видеть сообщения и отвечать.\n\n` +
          "Переподключите аккаунт в кабинете Zernio, чтобы бот снова заработал.",
        parse_mode: "HTML",
      });
    } catch (e) {
      console.error("[zernio-bot] notify admin about account.disconnected failed", e);
    }
  }
}

/*
 * Обработчика комментариев здесь намеренно нет. Ответы на комментарии и DM по
 * ключевым словам делают родные Comment-to-DM автоматизации Zernio — им наше
 * участие не нужно, и прежний handleZernioComment сводился к console.log.
 * Вместе с ним снята и подписка на `comment.received` (см. комментарий к
 * событиям в registerZernioWebhook): она давала 69 % всего трафика вебхука без
 * единого полезного действия.
 */

/**
 * Шаги сценария покупки. Возвращает true, если реплика обработана и дальше её
 * разбирать не надо.
 *
 * Порядок здесь и есть весь смысл: сначала смотрим, на каком шаге стоит
 * диалог, и только если ни на каком — пытаемся понять свободную реплику. До
 * появления состояния бот делал наоборот и потому отправлял в поиск товаров
 * и «Здравствуйте», и «Казахстан», и односложный ответ на авто-DM воронки.
 */
// Шаги сбора данных о получении физического заказа (Ниши, Блок 8.3) — на них
// «убрать N» не должно молча сваливаться в редактирование корзины: корзина
// здесь ещё даже не заморожена (frozen_cart появится только в конце,
// в sendDirectPaymentDetails), так что убирать пока нечего.
const FULFILLMENT_STEP_MODES = new Set<DirectMode>([
  "awaiting_fulfillment_type",
  "awaiting_fulfillment_date",
  "awaiting_delivery_zone",
  "awaiting_address",
  "awaiting_fulfillment_note",
]);

async function handlePurchaseFlow(params: {
  conversationId: string;
  accountId: string;
  user: ZernioBotUser;
  text: string;
  attachmentUrl?: string;
  /** false — режим «только покупки»: на всё, кроме заказа, бот молчит. */
  answersEverything: boolean;
}): Promise<boolean> {
  const { conversationId, accountId, user, text, attachmentUrl, answersEverything } = params;
  const flow = await import("./direct-purchase.server");
  const {
    classifyIncoming,
    isCancel,
    isPaymentComplaint,
    matchDirectCommand,
    matchLocalePick,
    matchZone,
  } = await import("./direct-flow");
  const state = flow.readDirectState(user.state);
  const locale = flow.directLocale(state);
  const copy = directCopy[locale];
  const say = (message: string) => reply(user, conversationId, accountId, message);

  // Обработчик чека работает в фоне webhook-а. Если инстанс завершился после
  // атомарного claim, прежний код оставлял `processing_proof` навсегда, и
  // любой повторный чек выглядел как «уже обрабатываю». Свежий lock бережём
  // от дублей, а устаревший (и старые записи без метки времени) снимаем и
  // сразу используем текущее вложение как повторную попытку.
  if (state.mode === "processing_proof") {
    const startedAt = Date.parse(state.proof_processing_started_at || "");
    const lockIsFresh = Number.isFinite(startedAt) && Date.now() - startedAt < 45_000;
    if (lockIsFresh) {
      // Если первый вызов ещё работает, повтор webhook всё равно получает
      // понятное подтверждение вместо полного молчания. Обычная дедупликация
      // не создаст второе сообщение, если первый ack уже ушёл, но повторит его
      // после неудачной отправки (неудача не записывается как last_reply).
      await say(copy.receiptProcessing);
      return true;
    }

    await flow.releaseAwaitingProof(user.user_key);
    if (!attachmentUrl) {
      await say(copy.awaitingProofHint);
      return true;
    }
    return handlePurchaseFlow({
      ...params,
      user: {
        ...user,
        state: { ...state, mode: "awaiting_proof", proof_processing_started_at: undefined },
      },
    });
  }

  /**
   * Ждём ответ на выбор языка — шаг важнее всего остального в сценарии.
   *
   * Показывается либо новым отправителям (см. handleZernioMessage), либо по
   * явному запросу словом «язык» (см. sendLanguagePicker). Ни isCancel, ни
   * isPaymentComplaint здесь не имеют смысла: обе проверки разбирают русский
   * текст, а на этом шаге язык покупателя ещё не выбран.
   */
  if (state.mode === "awaiting_locale" && !attachmentUrl) {
    const picked = matchLocalePick(text);
    if (!picked) {
      const misses = (state.misses ?? 0) + 1;
      if (misses >= flow.MAX_STEP_MISSES) {
        // Не упорствуем: дальше отвечаем по-русски — как отвечали до появления
        // локализации, — а не держим человека на нераспознанном шаге вечно.
        await flow.setDirectState(user.user_key, { locale: "ru" });
        await flow.clearDirectFlow(user.user_key);
        await sendCatalogMenu(conversationId, accountId, user);
        return true;
      }
      await flow.setDirectState(user.user_key, { misses });
      await reply(user, conversationId, accountId, languagePickerText(), undefined, true);
      return true;
    }

    await flow.setDirectState(user.user_key, { locale: picked });
    await flow.clearDirectFlow(user.user_key);
    await say(directCopy[picked].languageSaved);
    await sendCatalogMenu(conversationId, accountId, {
      ...user,
      state: { ...state, locale: picked, mode: undefined, misses: undefined },
    });
    return true;
  }
  /**
   * Вложение на шаге awaiting_locale — почти всегда чек «на опережение».
   *
   * Вложение не бывает ответом на выбор языка, а `matchLocalePick("")` на
   * пустой подписи всё равно не находит совпадения — раньше это просто
   * гоняло человека по кругу «не понял язык», а сам чек нигде не
   * сохранялся. Особенно бьёт по покупателю, которого на этот шаг
   * забросило автоматизацией Zernio поверх уже начатого awaiting_proof
   * (см. whatsapp-activation.ts — «start» сбрасывает любое состояние):
   * человек уверен, что отправляет чек по своему заказу, а на деле его
   * тут же спрашивают заново, на каком языке ему отвечать.
   *
   * Явного `return` здесь нет: обработка проваливается к общей страховке
   * для вложений вне сценария ниже по файлу — она и сохраняет чек, и
   * зовёт продавца.
   */

  /**
   * Выход из сценария — на любом шаге, а не только на ожидании чека.
   *
   * Раньше «отмена» понималась лишь при ожидании чека, а на выборе страны
   * человек оказывался запертым: при проверке отправили «/start» и получили
   * «Не понял страну» — и так по кругу, потому что любая реплика на этом шаге
   * считалась попыткой назвать страну.
   *
   * Слова здесь заданы прямо, а не через настраиваемый список команд: выход
   * должен работать всегда и одинаково, даже если продавец переопределил
   * команды вызова.
   */
  if (state.mode && isCancel(text)) {
    // Корзину чистим вместе с шагом. Иначе набранное оставалось лежать: человек
    // добавлял не тот номер, отменял, добавлял верный — и в заказ попадали оба.
    await flow.clearDirectFlow(user.user_key);
    await flow.clearCart(user);
    await say(copy.cancelled);
    return true;
  }

  /**
   * Вопрос по оплате — сразу человеку, без единой заготовленной фразы.
   *
   * Это исправление настоящей переписки. Покупательница написала: «Я оплатила
   * 400тг вам, вы материал мне не отправили». Бот увидел в этом «оплат»,
   * принял за команду «оформить заказ» и ответил «Корзина пуста — напишите
   * номер материала». Дважды. На «верните мои деньги» — «Передал ваш вопрос
   * продавцу», тоже дважды. Разбор команд по вхождению уже исправлен, но одного
   * этого мало: такая реплика вообще не должна попадать в сценарий продажи.
   *
   * Что здесь важно:
   *  • шаг сценария не сбрасываем. Человек мог жаловаться на прошлый заказ, а
   *    сам стоять на ожидании чека — сбросив шаг, мы потеряли бы и корзину, и
   *    присланный следом чек;
   *  • продавца зовём один раз в шесть часов, зато с фактами: его заказы,
   *    статусы, есть ли чек и почта (см. notifyAdminAboutComplaint);
   *  • в тихом режиме покупателю не отвечаем вовсе — переписка останется
   *    непрочитанной, и продавец увидит её в Instagram сам.
   */
  if (!attachmentUrl && matchDirectCommand(text) === null && isPaymentComplaint(text)) {
    const complainedRecently = flow.handedToHuman(state);

    if (!complainedRecently) {
      await flow.notifyAdminAboutComplaint({
        text,
        senderName: user.first_name || "покупатель",
        senderUsername: user.username || "",
        telegramId: user.telegram_id,
      });
      await flow.setDirectState(user.user_key, { complained_at: new Date().toISOString() });
    }

    // Отвечаем только если бот в этом разговоре уже говорил: молчать после
    // собственных сообщений — значит бросить человека на полуслове.
    if (answersEverything || state.mode) {
      await say(copy.complaintAck);
    } else {
      console.log(`[zernio-bot] жалоба по оплате от ${user.user_key} передана продавцу молча`);
    }
    return true;
  }

  /**
   * «Убрать 018» — передумать по одной позиции, не разбирая заказ целиком.
   *
   * Работает в любом режиме: это обслуживание собственной корзины, а не
   * болтовня. На шаге ожидания чека сумма после удаления меняется, поэтому
   * реквизиты с новым итогом уходят заново — иначе человек заплатил бы по
   * старому счёту.
   */
  const removeNumber = flow.parseRemoveCommand(text);
  if (
    removeNumber &&
    state.mode !== "awaiting_email" &&
    // Выбор варианта товара (Ниши, Блок D) — тоже не про редактирование
    // корзины: товар туда ещё не попал, список показывает варианты, а не
    // позиции корзины.
    state.mode !== "awaiting_variant_choice" &&
    !(state.mode && FULFILLMENT_STEP_MODES.has(state.mode))
  ) {
    const cart = await flow.readCart(user);
    if (cart.length === 0) {
      await say(copy.removeNothing);
      return true;
    }

    const index = flow.pickCartLineToRemove(
      removeNumber,
      cart.map((line) => line.name),
    );
    if (index === null) {
      const shown = await flow.priceCart(cart, state.country_code ?? null);
      await say(copy.removeNotFound(removeNumber, flow.renderCart(shown.lines)));
      return true;
    }

    const removed = cart[index];
    await flow.removeFromCart(user, removed.id);
    const rest = await flow.readCart(user);

    if (rest.length === 0) {
      await flow.clearDirectFlow(user.user_key);
      await say(copy.removedCartEmpty(removed.name));
      return true;
    }

    await say(copy.removed(removed.name));

    // Реквизиты уже отправлены — значит, названная сумма устарела, и её надо
    // назвать заново, вместе с обновлённым составом заказа.
    if (state.mode === "awaiting_proof" && state.country_code) {
      const options = await flow.listCountries();
      const country = options.find((option) => option.code === state.country_code);
      if (country) {
        await sendDirectPaymentDetails({
          conversationId,
          accountId,
          user,
          country,
          remembered: false,
        });
        return true;
      }
    }

    await sendCart(conversationId, accountId, user);
    return true;
  }

  // ── Ждём чек ────────────────────────────────────────────────────────────
  if (state.mode === "awaiting_proof") {
    if (!attachmentUrl) {
      await flow.handleStepMiss({
        user,
        state,
        text,
        hint: copy.awaitingProofHint,
        say,
        locale,
      });
      return true;
    }

    /**
     * Забираем шаг в обработку атомарно — до похода в сеть за вложением.
     *
     * Скачивание чека и загрузка в Storage — это реальное время, и если за
     * него придёт второе вложение (человек прислал чек дважды, живой случай),
     * второй вызов увидит тот же state.mode === "awaiting_proof" и ту же, ещё
     * не очищенную корзину. Без захвата оба создали бы по заказу на одну и ту
     * же покупку. См. claimAwaitingProof в direct-purchase.server.ts.
     */
    const claim = await flow.claimAwaitingProof(user.user_key);
    if (!claim) {
      // Это дубль того же входящего события или второе вложение, пришедшее в
      // тот же момент. Первый вызов уже создаёт заказ; дубль не должен
      // отправлять пользователю ложное «обрабатываю» и запускать ещё одну
      // сетевую загрузку.
      return true;
    }

    // Подтверждаем получение сразу после атомарного захвата. До создания заказа
    // ещё есть несколько запросов к базе, а дальше — CDN, Storage и OCR. Если
    // любой из них задержится, покупатель всё равно должен увидеть ответ, а не
    // решить, что чек потерялся.
    // `force` нужен намеренно: это подтверждение текущего чека, а не повтор
    // одинакового ответа. Его доставка полезна, но не может быть условием
    // создания заказа: исходящие сообщения Zernio иногда временно отвергает,
    // тогда как сам входящий чек уже успешно дошёл до нас. Прерывание здесь
    // оставляло покупателя без ответа и без заказа.
    const receiptAckSent = await reply(
      user,
      conversationId,
      accountId,
      copy.receiptProcessing,
      undefined,
      true,
    );
    if (!receiptAckSent) {
      console.error(
        `[zernio-bot] receipt acknowledgement was not delivered for ${user.user_key}; continuing order creation`,
      );
    }

    let order: Awaited<ReturnType<typeof flow.createOrderFromCart>>;
    try {
      order = await flow.createOrderFromCart({
        user,
        countryCode: claim.country_code!,
        frozenPriced: claim.frozen_cart,
        // Собраны шагами awaiting_fulfillment_* ДО этого момента (Ниши, Блок
        // 8.3) — claim несёт полный DirectState, включая их. Digital-корзина
        // никогда не проходит эти шаги, поэтому checkout_fulfillment_type
        // остаётся не задан, и fulfillment корректно уходит как undefined.
        fulfillment: claim.checkout_fulfillment_type
          ? {
              type: claim.checkout_fulfillment_type,
              at: claim.checkout_fulfillment_at!,
              address: claim.checkout_fulfillment_address,
              note: claim.checkout_fulfillment_note,
            }
          : undefined,
        // Зона доставки (Ниши, Блок B) — та же claim-запись несёт её, если
        // шаг awaiting_delivery_zone был пройден (см. комментарий выше про
        // fulfillment). Её цена уже сложена в frozen_cart.total выше по
        // цепочке (sendDirectPaymentDetails), здесь только сама зона — для
        // снимка delivery_zone_id/_name в orders.
        deliveryZone: claim.checkout_delivery_zone_id
          ? {
              id: claim.checkout_delivery_zone_id,
              name: claim.checkout_delivery_zone_name ?? "",
              fee: claim.checkout_delivery_fee ?? 0,
            }
          : undefined,
      });
    } catch (error) {
      console.error("[zernio-bot] failed to create direct order", error);
      await flow.releaseAwaitingProof(user.user_key);
      await say(copy.orderCreateFailed);
      return true;
    }
    if (!order) {
      // Заказ не создался — возвращаем пользователя на шаг с чеком. До этого
      // уже был взят атомарный lock, и без отката следующий файл выглядел бы
      // как второй чек в вечной обработке.
      await flow.releaseAwaitingProof(user.user_key);
      await say(copy.orderCreateFailed);
      return true;
    }

    const s = await db();
    const displayNo = order.order_no || order.id;
    const email = user.email;
    const platform = platformOf(user);
    // Physical-заказу почта не нужна вовсе — она нужна была только чтобы
    // дослать файлы письмом (см. deliverOrderByEmail, orders.server.ts).
    // Полноценный чекаут физического заказа (дата/адрес) — Ниши, Блок 8.
    const needsEmail = platform === "instagram" && order.fulfillment_kind !== "physical";

    // Техническая блокировка нужна только до создания заказа. Переводим
    // сценарий в нормальный пользовательский шаг до OCR и уведомлений: они
    // могут быть медленными или временно недоступными, но не должны оставлять
    // чат в processing_proof. Вложение уже сохранено, заказ уже создан.
    await flow.setDirectState(user.user_key, {
      mode: "awaiting_email",
      pending_order_id: order.id,
      // Заказ уже создан из этой заморозки — дальше она не нужна и не должна
      // случайно попасть в следующую покупку того же покупателя.
      frozen_cart: undefined,
      ...(email ? { email_optional: true } : {}),
    });

    // Корзину освобождаем только после успешного заказа — иначе при сбое
    // человек потерял бы всё, что набрал. Ошибка очистки не отменяет заказ и
    // не должна останавливать его передачу на ручную проверку.
    try {
      await flow.clearCart(user);
    } catch (error) {
      console.error("[zernio-bot] failed to clear direct cart after order creation", error);
    }

    // Для ручной проверки критично не распознавание картинки, а сам заказ.
    // Поэтому подтверждаем его и спрашиваем e-mail до загрузки вложения:
    // CDN Instagram или Storage могут временно подвиснуть, но не должны
    // заставлять покупателя ждать в тишине.
    const askedForEmailImmediately = needsEmail && !email;
    if (askedForEmailImmediately) {
      await say(copy.receiptReceivedNeedEmail(displayNo));
    }

    // Файл всё равно пробуем сохранить к заказу, но лишь в пределах короткого
    // окна. Если CDN/Storage недоступны, фото остаётся в Direct, а заказ уже
    // создан и ждёт ручной проверки в админке.
    const proofPath = await Promise.race([
      flow.storeReceipt(attachmentUrl, user.user_key, {
        platform: platformOf(user),
        accountId,
      }),
      new Promise<null>((resolve) => setTimeout(resolve, 5_000)),
    ]);
    let created: { total: number | null; currency: string | null } | null = null;
    if (proofPath) {
      const { data } = await s
        .from("orders")
        .update({ payment_proof_path: proofPath.path })
        .eq("id", order.id)
        .select("total, currency")
        .single();
      created = data;
    }

    /**
     * Распознаём чек сразу, пока байты под рукой.
     *
     * Это то, ради чего вообще стоит городить бота: если сумма в чеке сходится,
     * материалы уходят сами и покупатель получает их через минуту, а не когда
     * продавец доберётся до разбора. Не сошлось или не распознали — заказ
     * уходит на ручную проверку с причиной, и продавец решает сам. Ошибка в эту
     * сторону единственно верная: выдать по чужому чеку хуже, чем задержать
     * выдачу на пару часов.
     */
    const verdict = proofPath
      ? await flow.verifyDirectReceipt({
          bytes: proofPath.bytes,
          mime: proofPath.mime,
          expectedAmount: Number(created?.total ?? 0),
          currency: String(created?.currency ?? "KZT"),
          orderId: order.id,
        })
      : {
          autoDeliver: false,
          note: `вложение не удалось быстро сохранить; проверить вручную в ${PLATFORM_LABEL[platform]}`,
        };
    await s
      .from("orders")
      .update({
        admin_note: `${PLATFORM_LABEL[platform]}, чек: ${verdict.note}`.slice(0, 500),
        ...(verdict.proofHash ? { payment_proof_hash: verdict.proofHash } : {}),
      })
      .eq("id", order.id);

    // Instagram требует почту, WhatsApp выдаёт файлы прямо в чат.
    if (verdict.autoDeliver && (!needsEmail || email)) {
      if (email) await s.from("orders").update({ customer_email: email }).eq("id", order.id);
      await flow.clearDirectFlow(user.user_key);
      try {
        if (order.fulfillment_kind === "physical") {
          const { acceptOrder, recordPayment } = await import("./fulfillment.server");
          await acceptOrder(order.id);
          // Не amountDueNow(): чекаут задатка/оплаты-при-получении для Direct
          // не сделан (Ниши, Блок 8.3) — здесь чек всегда присылают на полную
          // сумму, амаунт для сверки в verdict уже посчитан от order.total.
          await recordPayment(order.id, Number(order.total)).catch((e) =>
            console.error("[zernio-bot] recordPayment failed", order.id, e),
          );
        } else {
          const { deliverOrder } = await import("./orders.server");
          await deliverOrder(order.id);
        }
        // Продавец должен знать о продаже, даже когда делать ничего не нужно.
        await flow.notifyAdminAboutDirectOrder(order.id, displayNo, {
          verdict: verdict.note,
          needsAction: false,
        });
        return true; // о письме покупателю сообщает сама выдача
      } catch (e) {
        console.error("[zernio-bot] автовыдача не удалась, отдаём продавцу", e);
        await flow.notifyAdminAboutDirectOrder(order.id, displayNo, { verdict: verdict.note });
        await say(
          needsEmail && email
            ? copy.receiptReceivedKnownEmail(displayNo, email)
            : copy.receiptReceivedWhatsApp(displayNo),
        );
        return true;
      }
    }

    await flow.notifyAdminAboutDirectOrder(order.id, displayNo, { verdict: verdict.note });

    if (!needsEmail) {
      await flow.clearDirectFlow(user.user_key);
      await say(copy.receiptReceivedWhatsApp(displayNo));
      return true;
    }

    if (email) {
      await s.from("orders").update({ customer_email: email }).eq("id", order.id);
      await say(copy.receiptReceivedAskEmailOptional(displayNo, email));
      return true;
    }

    if (!askedForEmailImmediately) await say(copy.receiptReceivedNeedEmail(displayNo));
    return true;
  }

  // ── Ждём страну ─────────────────────────────────────────────────────────
  if (state.mode === "awaiting_country") {
    const options = await flow.listCountries();
    const chosen = flow.matchCountry(text, options);
    if (!chosen) {
      await flow.handleStepMiss({
        user,
        state,
        text,
        hint: copy.countryHint,
        say,
        locale,
      });
      return true;
    }

    // Дальше — общий шаг с тем случаем, когда страну взяли из памяти.
    await proceedToFulfillmentOrPayment(conversationId, accountId, user, chosen, false);
    return true;
  }

  // ── Способ/дата/адрес/комментарий получения физического заказа (Ниши, ────
  // ── Блок 8.3) — между awaiting_country и awaiting_proof. ──────────────────
  if (state.mode === "awaiting_fulfillment_type") {
    const { matchFulfillmentType } = await import("./direct-flow");
    const picked = matchFulfillmentType(text);
    if (!picked) {
      await flow.handleStepMiss({
        user,
        state,
        text,
        hint: copy.fulfillmentTypeHint,
        say,
        locale,
      });
      return true;
    }
    await askFulfillmentDate(conversationId, accountId, user, picked);
    return true;
  }

  if (state.mode === "awaiting_fulfillment_date") {
    const {
      parseFulfillmentDateInput,
      maxLeadTimeDaysInCart,
      todayInAppTZ,
      addDaysToIsoDate,
      isoDateToDisplay,
    } = await import("./fulfillment.server");
    const iso = parseFulfillmentDateInput(text);
    if (!iso) {
      await flow.handleStepMiss({
        user,
        state,
        text,
        hint: copy.fulfillmentDateInvalid,
        say,
        locale,
      });
      return true;
    }
    const minIso = addDaysToIsoDate(todayInAppTZ(), await maxLeadTimeDaysInCart(user.telegram_id));
    if (iso < minIso) {
      await say(copy.fulfillmentDateTooEarly(isoDateToDisplay(minIso)));
      return true;
    }
    if (state.checkout_fulfillment_type === "delivery") {
      await flow.setDirectState(user.user_key, { checkout_fulfillment_at: iso });
      await proceedToDeliveryZoneOrAddress(conversationId, accountId, user);
    } else {
      await flow.setDirectState(user.user_key, {
        checkout_fulfillment_at: iso,
        mode: "awaiting_fulfillment_note",
      });
      await reply(user, conversationId, accountId, copy.fulfillmentNotePrompt, [
        { type: "postback", title: copy.fulfillmentNoteSkipBtn, payload: "fulfillnote:skip" },
      ]);
    }
    return true;
  }

  // Выбор варианта товара при более чем трёх вариантах (Ниши, Блок D) —
  // тот же numbered-list-с-текстовым-fallback приём, что и у зоны
  // доставки/страны. До трёх вариантов покупатель просто тапает кнопку на
  // карточке (BUY:<productId>:<variantId>), этот шаг не нужен вовсе.
  if (state.mode === "awaiting_variant_choice") {
    const productId = state.pending_variant_product_id;
    if (!productId) {
      // Состояние потерялось между сообщениями — переспрашивать нечего,
      // просто выходим из шага молча, как и остальные шаги без контекста.
      await flow.setDirectState(user.user_key, { mode: undefined });
      return true;
    }
    const s = await db();
    const { data: variants } = await s
      .from("product_variants")
      .select("id, name, price")
      .eq("product_id", productId)
      .order("sort_order");
    const chosen = matchZone(text, variants ?? []);
    if (!chosen) {
      await flow.handleStepMiss({
        user,
        state,
        text,
        hint: copy.variantChoiceHint,
        say,
        locale,
      });
      return true;
    }
    await flow.setDirectState(user.user_key, { pending_variant_product_id: undefined });
    await addProductToCart(conversationId, accountId, user, productId, chosen.id);
    return true;
  }

  if (state.mode === "awaiting_delivery_zone") {
    const { activeDeliveryZones } = await import("./fulfillment.server");
    const zones = await activeDeliveryZones();
    const chosen = matchZone(text, zones);
    if (!chosen) {
      await flow.handleStepMiss({
        user,
        state,
        text,
        hint: copy.deliveryZoneHint,
        say,
        locale,
      });
      return true;
    }
    await flow.setDirectState(user.user_key, {
      checkout_delivery_zone_id: chosen.id,
      checkout_delivery_zone_name: chosen.name,
      checkout_delivery_fee: Number(zones.find((z) => z.id === chosen.id)?.price ?? 0),
      mode: "awaiting_address",
    });
    await say(copy.fulfillmentAddressPrompt);
    return true;
  }

  if (state.mode === "awaiting_address") {
    await flow.setDirectState(user.user_key, {
      checkout_fulfillment_address: text.trim().slice(0, 500),
      mode: "awaiting_fulfillment_note",
    });
    await reply(user, conversationId, accountId, copy.fulfillmentNotePrompt, [
      { type: "postback", title: copy.fulfillmentNoteSkipBtn, payload: "fulfillnote:skip" },
    ]);
    return true;
  }

  if (state.mode === "awaiting_fulfillment_note") {
    await finishFulfillmentAndShowPayment(
      conversationId,
      accountId,
      user,
      text.trim().slice(0, 500),
    );
    return true;
  }

  // ── Ждём почту ──────────────────────────────────────────────────────────
  if (state.mode === "awaiting_email") {
    const email = flow.extractEmail(text);

    /**
     * Пришла ещё одна картинка вместо адреса — это второй чек, а не ошибка.
     *
     * Так и было при живой проверке: человек, уже отправив чек, прислал его
     * ещё раз (или скриншот перевода вдогонку) — и получил «это не похоже на
     * адрес почты». Ответ формально верный и совершенно бесполезный: человек
     * прислал доказательство оплаты, а ему сказали, что он неправильно написал
     * почту.
     *
     * Сохраняем вложение к тому же заказу, говорим продавцу и остаёмся на шаге
     * почты — она всё ещё нужна, чтобы отправить материалы.
     */
    if (!email && attachmentUrl) {
      const extra = await flow.storeReceipt(attachmentUrl, user.user_key, {
        platform: platformOf(user),
        accountId,
      });
      const s = await db();
      if (extra && state.pending_order_id) {
        const { data: order } = await s
          .from("orders")
          .select("payment_proof_path, order_no, admin_note")
          .eq("id", state.pending_order_id)
          .maybeSingle();

        await s
          .from("orders")
          .update(
            order?.payment_proof_path
              ? {
                  admin_note: `${order.admin_note ?? ""}; ещё один чек: ${extra.path}`.slice(
                    0,
                    500,
                  ),
                }
              : { payment_proof_path: extra.path },
          )
          .eq("id", state.pending_order_id);

        await flow.notifyAdminAboutQuestion({
          question: `Прислал ещё один чек к заказу №${order?.order_no ?? state.pending_order_id}. Посмотрите вложения заказа.`,
          senderName: user.first_name || "покупатель",
          senderUsername: user.username || "",
          platform: platformOf(user),
        });
      }
      await say(copy.emailStepGotReceipt);
      return true;
    }

    if (!email) {
      /**
       * Шаг был необязательным — адрес мы уже знали и лишь предложили его
       * заменить. Значит, человек написал о чём-то другом: выходим из сценария
       * и отдаём сообщение обычному разбору, а не требуем почту.
       */
      if (state.email_optional) {
        await flow.clearDirectFlow(user.user_key);
        return false;
      }
      await flow.handleStepMiss({
        user,
        state,
        text,
        hint: copy.emailHint,
        say,
        locale,
      });
      return true;
    }
    const s = await db();
    await s.from("bot_users").update({ email }).eq("user_key", user.user_key);
    if (state.pending_order_id) {
      await s.from("orders").update({ customer_email: email }).eq("id", state.pending_order_id);
    }
    await flow.clearDirectFlow(user.user_key);

    /**
     * Чек уже проверен при получении, и вердикт лежит в заметке заказа. Если он
     * сошёлся, ждать продавца незачем — адрес теперь известен, отдаём материалы
     * сразу. Именно это и превращает бота из посредника в настоящую автовыдачу:
     * человек получает файлы через минуту после оплаты, ночью и в выходной.
     */
    if (state.pending_order_id) {
      const { data: order } = await s
        .from("orders")
        .select("admin_note, status")
        .eq("id", state.pending_order_id)
        .maybeSingle();

      const verified = (order?.admin_note ?? "").includes("чек распознан");
      if (verified && order?.status === "awaiting_confirmation") {
        try {
          const { deliverOrder } = await import("./orders.server");
          await deliverOrder(state.pending_order_id);
          const { data: shown } = await s
            .from("orders")
            .select("order_no")
            .eq("id", state.pending_order_id)
            .maybeSingle();
          await flow.notifyAdminAboutDirectOrder(
            state.pending_order_id,
            shown?.order_no ?? state.pending_order_id,
            { verdict: "распознан, выдано автоматически", needsAction: false },
          );
          return true; // о письме покупателю сообщает сама выдача
        } catch (e) {
          console.error("[zernio-bot] автовыдача после ввода почты не удалась", e);
        }
      }
    }

    /**
     * Дальше разговор ведёт продавец, и это сказано прямо.
     *
     * Продавец боялась именно этого: человек оформил заказ, у него возник
     * вопрос, а сообщение «прошло через бота» и до неё не дошло. Теперь после
     * оформления бот выходит из сценария и по обычной переписке молчит —
     * непрочитанное в Instagram снова видно, а покупатель предупреждён, что
     * ответит живой человек, и не ждёт от бота невозможного.
     */
    await say(copy.emailSaved(email));
    return true;
  }

  /**
   * Вложение пришло вне сценария — почти всегда это чек «на опережение».
   *
   * Так и появляются истории вида «я оплатила, а материал не отправили»:
   * человек увидел реквизиты в публикации, заплатил и прислал чек в Direct,
   * ничего у бота не заказывая. Заказа под такой чек нет, шага сценария нет —
   * прежде это вложение просто пропадало из виду бота целиком.
   *
   * Сохраняем чек в хранилище и зовём продавца: даже если это не чек, а
   * случайная картинка, потеря невелика, а цена обратной ошибки — потерянная
   * оплата и разбирательство.
   */
  if (attachmentUrl) {
    const notifiedRecently =
      Boolean(state.notified_at) && Date.now() - Date.parse(state.notified_at!) < 60 * 60 * 1000;

    if (!notifiedRecently) {
      const stored = await flow.storeReceipt(attachmentUrl, `${user.user_key}/unmatched`, {
        platform: platformOf(user),
        accountId,
      });
      await flow.notifyAdminAboutQuestion({
        question:
          "Прислал вложение (похоже на чек), но заказа у него нет — оплатил, минуя бота." +
          (stored ? `\nФайл: payment-proofs/${stored.path}` : "\nФайл сохранить не удалось."),
        senderName: user.first_name || "покупатель",
        senderUsername: user.username || "",
        platform: platformOf(user),
      });
      await flow.setDirectState(user.user_key, { notified_at: new Date().toISOString() });
    }

    // Вложение — осознанное действие покупателя, даже если состояние заказа
    // потерялось из-за сбоя записи или пришло из старого сценария. В режиме
    // «только покупки» обычный текст можно оставить продавцу, но картинку-чек
    // нельзя проглатывать молча: человек должен понять, что она замечена.
    await say(copy.strayAttachmentAck);
    return true;
  }

  // ── Сценарий не начат: разбираем свободную реплику ──────────────────────
  if (!text.trim()) return false;

  const incoming = classifyIncoming(text);

  /**
   * Разговор уже передан продавцу — молчим, как и обещали.
   *
   * Исключение одно: номер материала. Если после разбирательства человек всё же
   * решил купить, помочь ему надо — это действие, а не разговор. Всё остальное
   * (вопросы, «спасибо», односложные ответы) ждёт продавца, и переписка
   * остаётся у него непрочитанной.
   */
  if (flow.handedToHuman(state) && incoming.kind !== "product_number") {
    console.log(`[zernio-bot] разговор с ${user.user_key} у продавца — бот молчит`);
    return true;
  }

  if (incoming.kind === "product_number") {
    const lookup = await flow.findProductByNumber(incoming.number);

    if (lookup.kind === "ambiguous") {
      // Под одним номером несколько товаров. Не угадываем: продать не тот
      // материал хуже, чем задать лишний вопрос.
      const names = lookup.products.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
      await say(copy.ambiguousProduct(incoming.number, names));
      return true;
    }

    const product = lookup.kind === "found" ? lookup.product : null;
    if (!product) {
      /**
       * Номер есть, а товара по нему нет.
       *
       * В тихом режиме молчим: человек мог написать «5» в обычном разговоре
       * («штук 5 хватит»), и «товар №5 не нашёл» в ответ выглядит дико. Пусть
       * продавец разберётся сам — переписка останется непрочитанной.
       */
      if (!answersEverything) return false;
      await say(copy.productNotFound(incoming.number));
      return true;
    }
    // Материал без файла продавать нельзя: заказ дошёл бы до подтверждения и
    // упёрся бы там — уже после того, как человек заплатил. Таких в каталоге 8.
    if (!(await flow.productHasFiles(product.id))) {
      await say(copy.productNoFiles(product.name));
      return true;
    }
    if (!(await flow.cartAllowsProduct(user, product.id))) {
      await say(copy.productMixedCart(product.name));
      return true;
    }

    await flow.addToCart(user, product.id);
    const cart = await flow.readCart(user);

    /**
     * Складываем в корзину, а не оформляем сразу.
     *
     * Методички берут по нескольку за раз, а прежний сценарий умел ровно один
     * материал: за вторым надо было заново проходить весь путь и присылать
     * второй чек. Корзина в базе была и раньше — ею пользовался старый путь с
     * Robokassa, — теперь она общий накопитель.
     *
     * Кнопка «Оформить» здесь важнее текста: одиночному покупателю не хочется
     * печатать лишнее слово, а тап работает и в папке «Запросы сообщений».
     */
    /**
     * Цену называем сразу.
     *
     * «Сколько стоит?» — самый частый вопрос в переписках, и молчать о цене,
     * когда человек уже назвал номер, значит гарантированно получить этот
     * вопрос следующим сообщением.
     *
     * Если страна известна с прошлого заказа — считаем по ней, в её валюте.
     * Если нет — по домашней стране продавца, а не по базовой цене товара:
     * базовая у клиента намеренно завышена (500 ₸ настоящих против 700 в
     * основном поле), и именно её покупатели видели раньше.
     */
    const shown = await flow.priceCart(cart, state.country_code ?? null);
    const line = shown.lines.find((item) => item.productId === product.id);
    const priceLine = line ? `${line.sum} ${line.currency}` : "";

    const added =
      cart.length === 1
        ? copy.addedSingle(product.name, priceLine)
        : copy.addedMulti(product.name, priceLine, cart.length, flow.renderCart(shown.lines));

    await reply(user, conversationId, accountId, `${added}\n\n${copy.addedFooter}`, [
      { type: "postback", title: copy.btnCheckout, payload: "CHECKOUT" },
    ]);
    return true;
  }

  if (incoming.kind === "affirmative") {
    // Односложный ответ — почти всегда реакция на автоматический DM из
    // воронки. Но такое же «да» звучит и в обычном разговоре с продавцом,
    // поэтому в тихом режиме не вмешиваемся.
    if (!answersEverything) return false;
    await say(copy.affirmativeReply);
    return true;
  }

  if (incoming.kind === "dismissal") {
    /**
     * Разговор закрывают: «не нужно», «спасибо», «понятно».
     *
     * Отвечаем коротко и на этом замолкаем. Раньше такая реплика попадала в
     * разбор вопросов и человек получал полное приветствие с предложением
     * назвать номер товара — то есть бот здоровался с ним заново после того,
     * как тот вежливо отказался. Продавца тут не зовём: звать его на «спасибо»
     * незачем.
     */
    if (!answersEverything) return false;
    await say(copy.dismissalReply);
    return true;
  }

  return false;
}

/** Слова по умолчанию, которыми человек зовёт бота. Продавец может задать свои. */
export const DEFAULT_TRIGGER_WORDS = ["заказать", "купить", "магазин", "каталог", "/start"];

/**
 * Список слов-вызовов из настройки. Пустая настройка не должна оставлять бота
 * без единого способа его позвать, поэтому падаем на значения по умолчанию.
 */
function parseTriggerWords(raw: string): string[] {
  const words = raw
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  return words.length > 0 ? words : DEFAULT_TRIGGER_WORDS;
}

/**
 * Ссылка на Telegram-бота этого клиента.
 *
 * Раньше в Direct уходила ссылка на веб-адрес деплоя — а это админка, и
 * покупателю там делать нечего. Правильный адресат — Telegram-бот: в нём
 * каталог, поиск и выдача файлов, ради которых из Instagram и приходят.
 *
 * Юзернейм спрашиваем у самого Telegram по токену, который у деплоя и так
 * есть: так его не надо прописывать руками ни в панели, ни в переменных, и он
 * не разъедется с действительностью, если бота переименуют. Ответ кешируем на
 * процесс — он меняется раз в никогда, а дёргать getMe на каждое сообщение
 * незачем. Переопределить можно переменной TELEGRAM_BOT_USERNAME.
 */
let cachedBotUsername: string | null = null;

export async function telegramBotLink(): Promise<string | null> {
  const override = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  if (override) return `https://t.me/${override}`;
  if (cachedBotUsername) return `https://t.me/${cachedBotUsername}`;

  try {
    const { tg } = await import("./telegram.server");
    const response = (await tg("getMe", {})) as { ok?: boolean; result?: { username?: string } };
    const username = response?.result?.username?.trim();
    if (!username) return null;
    cachedBotUsername = username;
    return `https://t.me/${username}`;
  } catch (e) {
    console.error("[zernio-bot] не удалось узнать юзернейм Telegram-бота", e);
    return null;
  }
}
