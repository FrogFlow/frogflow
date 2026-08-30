import type { Locale } from "@/lib/i18n";

/**
 * Единственный источник списка ниш — по образцу lib/modules/registry.ts
 * («второго списка ключей не заводить нигде»). Ниша объявляется переменной
 * окружения деплоя (VERTICAL, см. vertical.server.ts), тем же способом, что
 * CONTROL_PLANE разделяет панель оператора и клиентский деплой из одного
 * бандла: один git, одно ядро, разные ветки поведения по настройке проекта
 * Vercel — не форк и не ветка в git.
 *
 * Ниша — не то же самое, что тип товара (products.fulfillment_kind). Ниша
 * задаёт умолчания и тексты деплоя; конкретный товар всё равно решает сам,
 * цифровой он или физический — кондитер может продать PDF-рецепт, а
 * образовательный проект — печатный воркбук.
 */

export type VerticalLocaleCopy = {
  /** Первая строка приветствия после выбора языка (welcomeStartHtml). */
  welcomeGreeting: string;
  /** Строка «→ …» с описанием каталога в том же приветствии. */
  welcomeCatalog: string;
  /** Строка «→ …» с описанием оплаты/получения там же. */
  welcomePayment: string;
  /** Кнопка главного меню и пункт «Информация» — было «💬 Связаться с автором». */
  contactBtn: string;
  /** Заглушка, пока не настроено видео-инструкция (app_settings). */
  instructionComingSoon: string;
  /** Умолчание для app_settings.instruction_caption, пока продавец не задал своё. */
  instructionDefaultCaption: string;
};

export type VerticalDef = {
  /** Как показывать в панели оператора. */
  title: string;
  /** Умолчание для products.fulfillment_kind новых товаров этого деплоя. */
  defaultFulfillment: "digital" | "physical";
  /** Профильный текст бота (setMyDescription) — первые строки, до ссылок на оферту. */
  botDescriptionIntro: string;
  /** setMyShortDescription — лимит Telegram 120 символов. */
  shortDescription: string;
  locales: Record<Locale, VerticalLocaleCopy>;
};

export const VERTICALS = {
  digital: {
    title: "Цифровые материалы",
    defaultFulfillment: "digital",
    botDescriptionIntro:
      `📚 Каталог цифровых учебных материалов.\n` +
      `→ Выбор материалов и мгновенная выдача файлов после оплаты\n` +
      `→ Оплата картой / по реквизитам\n` +
      `→ Поддержка автора`,
    shortDescription:
      "Каталог материалов. Нажимая /start, вы принимаете оферту и политику конфиденциальности.",
    locales: {
      ru: {
        welcomeGreeting: "Добро пожаловать в магазин.",
        welcomeCatalog: "Каталог учебных материалов",
        welcomePayment: "Оплата и выдача файлов",
        contactBtn: "💬 Связаться с автором",
        instructionComingSoon:
          "📖 Инструкция скоро появится.\nПока: «Каталог» или «Поиск» → корзина → оплата → чек или Robokassa. Файлы придут после оплаты.",
        instructionDefaultCaption:
          "📖 Как пользоваться ботом: каталог → корзина → оплата → чек. Файлы придут после оплаты (картой или по чеку).",
      },
      kk: {
        welcomeGreeting: "Дүкенге қош келдіңіз!",
        welcomeCatalog: "Оқу материалдарының каталогы",
        welcomePayment: "Төлем және файлдарды алу",
        contactBtn: "💬 Автормен байланысу",
        instructionComingSoon:
          "📖 Нұсқаулық жақында қосылады.\nӘзірге: «Каталог» немесе «Іздеу» → себет → төлем → чек немесе Robokassa. Файлдар төлемнен кейін келеді.",
        instructionDefaultCaption:
          "📖 Ботты қалай пайдалану керек: каталог → себет → төлем → чек. Файлдар төлемнен кейін келеді (картамен немесе чекпен).",
      },
      en: {
        welcomeGreeting: "Welcome to the store!",
        welcomeCatalog: "Learning materials catalog",
        welcomePayment: "Payment and file delivery",
        contactBtn: "💬 Contact the author",
        instructionComingSoon:
          "📖 The guide is coming soon.\nFor now: “Catalog” or “Search” → cart → payment → receipt or Robokassa. Files arrive after payment.",
        instructionDefaultCaption:
          "📖 How to use the bot: catalog → cart → payment → receipt. Files arrive after payment (by card or receipt).",
      },
      uz: {
        welcomeGreeting: "Do‘konga xush kelibsiz!",
        welcomeCatalog: "O‘quv materiallari katalogi",
        welcomePayment: "To‘lov va fayllarni yetkazib berish",
        contactBtn: "💬 Muallif bilan bog‘lanish",
        instructionComingSoon:
          "📖 Yo‘riqnoma tez orada qo‘shiladi.\nHozircha: «Katalog» yoki «Qidirish» → savat → to‘lov → chek yoki Robokassa. Fayllar to‘lovdan so‘ng keladi.",
        instructionDefaultCaption:
          "📖 Botdan qanday foydalanish kerak: katalog → savat → to‘lov → chek. Fayllar to‘lovdan so‘ng keladi (karta yoki chek orqali).",
      },
    },
  },
  confectionery: {
    title: "Кондитерская",
    defaultFulfillment: "physical",
    botDescriptionIntro:
      `🎂 Каталог тортов и десертов на заказ.\n` +
      `→ Выбор товара, дата получения и способ выдачи\n` +
      `→ Оплата картой / по реквизитам\n` +
      `→ Связь с кондитерской`,
    shortDescription:
      "Каталог тортов на заказ. Нажимая /start, вы принимаете оферту и политику конфиденциальности.",
    locales: {
      ru: {
        welcomeGreeting: "Добро пожаловать в кондитерскую.",
        welcomeCatalog: "Каталог тортов и десертов",
        welcomePayment: "Оплата и оформление заказа",
        contactBtn: "💬 Связаться с кондитерской",
        instructionComingSoon:
          "📖 Инструкция скоро появится.\nПока: «Каталог» или «Поиск» → корзина → дата получения → оплата. Заказ подтвердит кондитерская.",
        instructionDefaultCaption:
          "📖 Как пользоваться ботом: каталог → корзина → способ и дата получения → оплата. Кондитерская подтвердит заказ и сообщит, когда он будет готов.",
      },
      kk: {
        welcomeGreeting: "Кондитерлік дүкенге қош келдіңіз!",
        welcomeCatalog: "Торттар мен десерттер каталогы",
        welcomePayment: "Төлем және тапсырысты рәсімдеу",
        contactBtn: "💬 Кондитерлікпен байланысу",
        instructionComingSoon:
          "📖 Нұсқаулық жақында қосылады.\nӘзірге: «Каталог» немесе «Іздеу» → себет → алу күні → төлем. Тапсырысты кондитерлік растайды.",
        instructionDefaultCaption:
          "📖 Ботты қалай пайдалану керек: каталог → себет → алу тәсілі мен күні → төлем. Кондитерлік тапсырысты растап, дайын болған кезде хабарлайды.",
      },
      en: {
        welcomeGreeting: "Welcome to the bakery!",
        welcomeCatalog: "Cakes and desserts catalog",
        welcomePayment: "Payment and order placement",
        contactBtn: "💬 Contact the bakery",
        instructionComingSoon:
          "📖 The guide is coming soon.\nFor now: “Catalog” or “Search” → cart → pickup/delivery date → payment. The bakery will confirm your order.",
        instructionDefaultCaption:
          "📖 How to use the bot: catalog → cart → pickup/delivery method and date → payment. The bakery will confirm the order and let you know when it's ready.",
      },
      uz: {
        welcomeGreeting: "Qandolatxonaga xush kelibsiz!",
        welcomeCatalog: "Tortlar va desertlar katalogi",
        welcomePayment: "To‘lov va buyurtmani rasmiylashtirish",
        contactBtn: "💬 Qandolatxona bilan bog‘lanish",
        instructionComingSoon:
          "📖 Yo‘riqnoma tez orada qo‘shiladi.\nHozircha: «Katalog» yoki «Qidirish» → savat → olish sanasi → to‘lov. Buyurtmani qandolatxona tasdiqlaydi.",
        instructionDefaultCaption:
          "📖 Botdan qanday foydalanish kerak: katalog → savat → olish usuli va sanasi → to‘lov. Qandolatxona buyurtmani tasdiqlaydi va tayyor bo‘lganda xabar beradi.",
      },
    },
  },
} as const satisfies Record<string, VerticalDef>;

export type VerticalKey = keyof typeof VERTICALS;

export const VERTICAL_KEYS = Object.keys(VERTICALS) as VerticalKey[];

export function verticalDef(key: VerticalKey): VerticalDef {
  return VERTICALS[key];
}
