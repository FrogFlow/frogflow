import type { Locale } from "@/lib/i18n";
import type { ModuleKey } from "@/lib/modules/registry";

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

export type VerticalMode = "shop" | "consultant";

export type VerticalDef = {
  /** Как показывать в панели оператора. */
  title: string;
  /**
   * shop — витрина (каталог, заказы, оплата).
   * consultant — консультант в Direct: прайс и менеджер, без кассы и зон доставки.
   * Не путать с defaultFulfillment: у консультанта товары физические, но
   * чекаут кондитерской (зоны, самовывоз, задаток) не включается.
   */
  mode: VerticalMode;
  /** Умолчание для products.fulfillment_kind новых товаров этого деплоя. */
  defaultFulfillment: "digital" | "physical";
  /** Профильный текст бота (setMyDescription) — первые строки, до ссылок на оферту. */
  botDescriptionIntro: string;
  /** setMyShortDescription — лимит Telegram 120 символов. */
  shortDescription: string;
  /**
   * Модули сверх базового пакета, отмеченные в мастере подключения при выборе
   * этой ниши (панель оператора, Блок 10) — не гейт: продавец может снять
   * галочку. Только "available"-модули, "planned" в пресет не кладём.
   */
  suggestedModules: ModuleKey[];
  locales: Record<Locale, VerticalLocaleCopy>;
};

export const VERTICALS = {
  digital: {
    title: "Цифровые материалы",
    mode: "shop",
    defaultFulfillment: "digital",
    botDescriptionIntro:
      `📚 Каталог цифровых учебных материалов.\n` +
      `→ Выбор материалов и мгновенная выдача файлов после оплаты\n` +
      `→ Оплата картой / по реквизитам\n` +
      `→ Поддержка автора`,
    shortDescription:
      "Каталог материалов. Нажимая /start, вы принимаете оферту и политику конфиденциальности.",
    suggestedModules: ["multi_currency"],
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
    mode: "shop",
    defaultFulfillment: "physical",
    botDescriptionIntro:
      `🎂 Каталог тортов и десертов на заказ.\n` +
      `→ Выбор товара, дата получения и способ выдачи\n` +
      `→ Оплата картой / по реквизитам\n` +
      `→ Связь с кондитерской`,
    shortDescription:
      "Каталог тортов на заказ. Нажимая /start, вы принимаете оферту и политику конфиденциальности.",
    // stock — остаток на витринную позицию (не на заказ), multi_currency — как
    // у всех текущих клиентов.
    suggestedModules: ["multi_currency", "stock"],
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
  consultant: {
    title: "Консультант в Direct",
    mode: "consultant",
    // Товары физические (дом. текстиль и т.п.), но UI кондитерской не включаем —
    // см. isPhysicalShopVertical: mode === "shop" && defaultFulfillment === "physical".
    defaultFulfillment: "physical",
    botDescriptionIntro:
      `Каталог в Instagram Direct.\n` +
      `→ Наличие и цена из прайса\n` +
      `→ Казахстан и Россия\n` +
      `→ Связь с менеджером`,
    shortDescription:
      "Консультант в Direct. Нажимая /start, вы принимаете оферту и политику конфиденциальности.",
    suggestedModules: ["instagram", "manager_chat"],
    locales: {
      ru: {
        welcomeGreeting: "Здравствуйте. Помогу подобрать товар из наличия.",
        welcomeCatalog: "Каталог по прайсу: размер, цвет, наличие",
        welcomePayment: "Оформление через менеджера",
        contactBtn: "💬 Связаться с менеджером",
        instructionComingSoon:
          "📖 Инструкция скоро появится.\nПока: напишите, что ищете — бот ответит по прайсу. «Купить» или «менеджер» — подключится живой менеджер.",
        instructionDefaultCaption:
          "📖 Напишите запрос в Direct. Бот ответит по наличию и цене из прайса. Чтобы оформить заказ или поговорить с человеком — напишите «купить» или «менеджер».",
      },
      kk: {
        welcomeGreeting: "Сәлеметсіз бе. Қолда бар тауарды таңдауға көмектесемін.",
        welcomeCatalog: "Прайс бойынша каталог: өлшем, түс, қор",
        welcomePayment: "Менеджер арқылы рәсімдеу",
        contactBtn: "💬 Менеджермен байланысу",
        instructionComingSoon:
          "📖 Нұсқаулық жақында қосылады.\nӘзірге: не іздегеніңізді жазыңыз — бот прайс бойынша жауап береді. «Сатып алу» немесе «менеджер» — тірі менеджер қосылады.",
        instructionDefaultCaption:
          "📖 Direct-ке сұрау жазыңыз. Бот прайстағы қор мен баға бойынша жауап береді. Тапсырыс рәсімдеу немесе адаммен сөйлесу үшін «сатып алу» немесе «менеджер» деп жазыңыз.",
      },
      en: {
        welcomeGreeting: "Hello. I can help you pick an item from stock.",
        welcomeCatalog: "Catalog from the price list: size, color, stock",
        welcomePayment: "Checkout with a manager",
        contactBtn: "💬 Contact a manager",
        instructionComingSoon:
          "📖 The guide is coming soon.\nFor now: write what you need — the bot answers from the price list. “Buy” or “manager” connects a live manager.",
        instructionDefaultCaption:
          "📖 Send a query in Direct. The bot answers with stock and price from the list. To place an order or talk to a person, write “buy” or “manager”.",
      },
      uz: {
        welcomeGreeting: "Salom. Mavjud tovardan tanlashga yordam beraman.",
        welcomeCatalog: "Narxlar ro‘yxati: o‘lcham, rang, qoldiq",
        welcomePayment: "Menejer orqali rasmiylashtirish",
        contactBtn: "💬 Menejer bilan bog‘lanish",
        instructionComingSoon:
          "📖 Yo‘riqnoma tez orada qo‘shiladi.\nHozircha: nima izlayotganingizni yozing — bot narxlar ro‘yxati bo‘yicha javob beradi. «Sotib olish» yoki «menejer» — jonli menejer ulanadi.",
        instructionDefaultCaption:
          "📖 Direct’ga so‘rov yozing. Bot ro‘yxatdagi qoldiq va narx bo‘yicha javob beradi. Buyurtma yoki odam bilan gaplashish uchun «sotib olish» yoki «menejer» deb yozing.",
      },
    },
  },
} as const satisfies Record<string, VerticalDef>;

export type VerticalKey = keyof typeof VERTICALS;

export const VERTICAL_KEYS = Object.keys(VERTICALS) as VerticalKey[];

export function verticalDef(key: VerticalKey): VerticalDef {
  return VERTICALS[key];
}

/** Кондитерская витрина: зоны, самовывоз, задаток. У консультанта — false. */
export function isPhysicalShopVertical(key: VerticalKey): boolean {
  const def = VERTICALS[key];
  return def.mode === "shop" && def.defaultFulfillment === "physical";
}

export function isConsultantVertical(key: VerticalKey): boolean {
  return VERTICALS[key].mode === "consultant";
}
