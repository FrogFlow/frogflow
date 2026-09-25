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

/**
 * Консультант BOVI. Вынесен в константу, чтобы вторая версия
 * (consultant_bovi_v2) бралась с него целиком и отличалась только тем,
 * что меняем осознанно.
 */
const BOVI_CONSULTANT = {
  title: "Консультант (ун. BOVI)",
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
} as const satisfies VerticalDef;

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
  consultant: BOVI_CONSULTANT,
  /**
   * Вторая версия консультанта BOVI — ИИ-менеджер, который ведёт продажу сам.
   * Живёт рядом с первой: тестовый деплой на нашем аккаунте берёт эту нишу,
   * BOVI остаётся на consultant, пока не решит перейти. Переход — смена
   * VERTICAL в проекте Vercel; данные у обеих версий одинаковые.
   */
  consultant_bovi_v2: { ...BOVI_CONSULTANT, title: "Консультант v2 (ун. BOVI)" },
  flowers: {
    title: "Цветы и букеты",
    mode: "shop",
    defaultFulfillment: "physical",
    botDescriptionIntro:
      `🌸 Доставка авторских букетов и свежих цветов.\n` +
      `→ Подбор букета по поводу и бюджету\n` +
      `→ Срочная доставка (от 60 мин) или к точной дате\n` +
      `→ Бесплатная открытка и фото букета перед отправкой`,
    shortDescription:
      "Доставка цветов и букетов. Нажимая /start, вы принимаете оферту и политику конфиденциальности.",
    suggestedModules: ["whatsapp", "stock", "multi_currency", "manager_chat", "smart_search"],
    locales: {
      ru: {
        welcomeGreeting: "Добро пожаловать в цветочную мастерскую!",
        welcomeCatalog: "Каталог букетов, роз и подарков",
        welcomePayment: "Оформление заказа и доставка",
        contactBtn: "💬 Связаться с флористом",
        instructionComingSoon:
          "📖 Инструкция скоро появится.\nПока: выберите букет из каталога или напишите бюджет — флорист поможет оформить заказ и пришлёт фото перед отправкой.",
        instructionDefaultCaption:
          "📖 Как заказать цветы: выберите букет → укажите дату и адрес доставки → добавьте текст открытки. Перед отправкой мы пришлём фото букета.",
      },
      kk: {
        welcomeGreeting: "Гүл шеберханасына қош келдіңіз!",
        welcomeCatalog: "Гүл шоқтары мен сыйлықтар каталогы",
        welcomePayment: "Тапсырыс беру және жеткізу",
        contactBtn: "💬 Флористпен байланысу",
        instructionComingSoon:
          "📖 Нұсқаулық жақында қосылады.\nӘзірге: каталогтан гүл шоғын таңдаңыз немесе бюджетіңізді жазыңыз — флорист тапсырыс беруге көмектеседі.",
        instructionDefaultCaption:
          "📖 Гүлге қалай тапсырыс беру керек: гүл шоғын таңдаңыз → жеткізу күні мен мекенжайын көрсетіңіз → құттықтау хатын қосыңыз.",
      },
      en: {
        welcomeGreeting: "Welcome to the flower boutique!",
        welcomeCatalog: "Bouquets, roses, and gift arrangements",
        welcomePayment: "Order placement and delivery",
        contactBtn: "💬 Contact a florist",
        instructionComingSoon:
          "📖 The guide is coming soon.\nFor now: pick a bouquet from the catalog or name your budget — our florist will assist you and send a photo before delivery.",
        instructionDefaultCaption:
          "📖 How to order flowers: select a bouquet → specify delivery date and address → add a postcard message. We'll send a photo before dispatch.",
      },
      uz: {
        welcomeGreeting: "Gul ustaxonasiga xush kelibsiz!",
        welcomeCatalog: "Guldastalar, atirgullar va sovg‘alar katalogi",
        welcomePayment: "Buyurtma berish va yetkazib berish",
        contactBtn: "💬 Florist bilan bog‘lanish",
        instructionComingSoon:
          "📖 Yo‘riqnoma tez orada qo‘shiladi.\nHozircha: katalogdan guldastani tanlang yoki byudjetingizni yozing — florist yordam beradi.",
        instructionDefaultCaption:
          "📖 Qanday buyurtma beriladi: guldastani tanlang → yetkazish sanasi va manzilini ko‘rsating → tabriknoma matnini qo‘shing.",
      },
    },
  },
  consultant_universal: {
    title: "Универсальный консультант",
    mode: "consultant",
    defaultFulfillment: "physical",
    botDescriptionIntro:
      `Интеллектуальный онлайн-консультант в Instagram Direct.\n` +
      `→ Консультации по товарам, услугам и регламентам компании\n` +
      `→ Быстрый ответ 24/7\n` +
      `→ Бесшовная связь с менеджером`,
    shortDescription:
      "Универсальный онлайн-консультант. Нажимая /start, вы принимаете оферту и политику конфиденциальности.",
    suggestedModules: ["instagram", "manager_chat", "smart_search", "multi_currency"],
    locales: {
      ru: {
        welcomeGreeting: "Здравствуйте! Чем могу вам помочь?",
        welcomeCatalog: "Консультация по ассортименту и услугам",
        welcomePayment: "Оформление заказа через менеджера",
        contactBtn: "💬 Связаться с менеджером",
        instructionComingSoon:
          "📖 Инструкция скоро появится.\nПока: напишите любой вопрос — консультант ответит по базе знаний компании.",
        instructionDefaultCaption:
          "📖 Задайте интересующий вопрос в Direct. Консультант предоставит информацию по услугам и товарам.",
      },
      kk: {
        welcomeGreeting: "Сәлеметсіз бе! Сізге қалай көмектесе аламын?",
        welcomeCatalog: "Тауарлар мен қызметтер бойынша кеңес",
        welcomePayment: "Тапсырысты менеджер арқылы рәсімдеу",
        contactBtn: "💬 Менеджермен байланысу",
        instructionComingSoon:
          "📖 Нұсқаулық жақында қосылады.\nӘзірге: кез келген сұрағыңызды жазыңыз — кеңесші компанияның білім базасы бойынша жауап береді.",
        instructionDefaultCaption:
          "📖 Direct-ке сұрағыңызды жазыңыз. Кеңесші қызметтер мен тауарлар туралы толық ақпарат береді.",
      },
      en: {
        welcomeGreeting: "Hello! How can I assist you today?",
        welcomeCatalog: "Assistance with products and services",
        welcomePayment: "Order processing with a manager",
        contactBtn: "💬 Contact a manager",
        instructionComingSoon:
          "📖 Guide coming soon.\nFor now: send any question — the assistant will answer based on company knowledge.",
        instructionDefaultCaption:
          "📖 Ask any question in Direct. The consultant will provide accurate details on products and services.",
      },
      uz: {
        welcomeGreeting: "Salom! Sizga qanday yordam bera olaman?",
        welcomeCatalog: "Mahsulotlar va xizmatlar bo'yicha maslahat",
        welcomePayment: "Buyurtmani menejer orqali rasmiylashtirish",
        contactBtn: "💬 Menejer bilan bog'lanish",
        instructionComingSoon:
          "📖 Yo'riqnoma tez orada qo'shiladi.\nHozircha: istalgan savolingizni yozing — maslahatchi kompaniya ma'lumotlari asosida javob beradi.",
        instructionDefaultCaption:
          "📖 Direct'ga savolingizni yozing. Maslahatchi tovarlar va xizmatlar haqida ma'lumot beradi.",
      },
    },
  },
} as const satisfies Record<string, VerticalDef>;

export type VerticalKey = keyof typeof VERTICALS;

export const VERTICAL_KEYS = Object.keys(VERTICALS) as VerticalKey[];

export function verticalDef(key: VerticalKey): VerticalDef {
  return VERTICALS[key];
}

/** Кондитерская и цветочная витрина: зоны, самовывоз, физическая доставка. */
export function isPhysicalShopVertical(key: VerticalKey): boolean {
  const def = VERTICALS[key];
  return def.mode === "shop" && def.defaultFulfillment === "physical";
}

export function isConsultantVertical(key: VerticalKey): boolean {
  return VERTICALS[key].mode === "consultant";
}

/** Консультант BOVI — обе версии: у них общие данные и общая админка. */
export function isBoviConsultantVertical(key: VerticalKey | string | undefined): boolean {
  return key === "consultant" || key === "consultant_bovi_v2";
}

/** Вторая версия консультанта BOVI (ИИ-менеджер). */
export function isBoviConsultantV2Vertical(key: VerticalKey | string | undefined): boolean {
  return key === "consultant_bovi_v2";
}

export function isUniversalConsultantVertical(key: VerticalKey): boolean {
  return key === "consultant_universal";
}

export function isFlowersVertical(key: VerticalKey): boolean {
  return key === "flowers";
}

