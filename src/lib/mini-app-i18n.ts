import { isLocale, type Locale } from "./i18n";

export type MiniAppStrings = {
  searchPlaceholder: string;
  productsCount: (n: number) => string;
  allCategories: string;
  addToCart: string;
  variant: string;
  outOfStock: string;
  fromPrice: string;
  addedToCart: string;
  mixedCart: string;
  digitalLimit: string;
  couldNotAdd: string;
  chooseVariant: string;
  sessionNotReady: string;
  cartEmpty: string;
  inCartOpen: string;
  pay: string;
  cartTitle: string;
  remove: string;
  checkoutInChat: string;
  checkoutFailed: string;
  networkError: string;
  cartLoadFailed: string;
  backToCatalog: string;
  description: string;
  rating: (avg: string, count: number) => string;
  needContact: string;
  needContactHint: string;
  phoneLabel: string;
  needCountry: string;
  chooseCountry: string;
  needFulfillmentType: string;
  pickup: string;
  delivery: string;
  needFulfillmentDate: string;
  dateLabel: string;
  needDeliveryZone: string;
  needAddress: string;
  addressLabel: string;
  noteLabel: string;
  noteOptional: string;
  choosePayment: string;
  payRobokassa: string;
  payManual: string;
  amountToPay: (amount: string) => string;
  orderComplete: string;
  orderOnReceipt: string;
  openPayment: string;
  sendProofInBot: string;
  continue: string;
  cancel: string;
};

const dict: Record<Locale, MiniAppStrings> = {
  ru: {
    searchPlaceholder: "Поиск…",
    productsCount: (n) => `${n} товаров`,
    allCategories: "Все",
    addToCart: "В корзину",
    variant: "Вариант",
    outOfStock: "Нет в наличии",
    fromPrice: "от ",
    addedToCart: "Добавлено в корзину",
    mixedCart: "Смешанная корзина недоступна",
    digitalLimit: "Уже в корзине",
    couldNotAdd: "Не удалось добавить",
    chooseVariant: "Выберите вариант",
    sessionNotReady: "Сессия Telegram ещё не готова — закройте и откройте магазин из бота",
    cartEmpty: "Корзина пуста",
    inCartOpen: "в корзине — открыть",
    pay: "Оплатить",
    cartTitle: "Корзина",
    remove: "Удалить",
    checkoutInChat: "Оплата в Mini App или по реквизитам ниже.",
    checkoutFailed: "Не удалось оформить заказ",
    networkError: "Ошибка сети",
    cartLoadFailed: "Не удалось загрузить корзину",
    backToCatalog: "← Каталог",
    description: "Описание",
    rating: (avg, count) => `★ ${avg} (${count})`,
    needContact: "Нужен номер телефона",
    needContactHint: "Укажите телефон для заказа или поделитесь контактом в боте.",
    phoneLabel: "Телефон",
    needCountry: "Выберите страну оплаты",
    chooseCountry: "Страна",
    needFulfillmentType: "Как получить заказ?",
    pickup: "Самовывоз",
    delivery: "Доставка",
    needFulfillmentDate: "Дата получения",
    dateLabel: "Дата (ГГГГ-ММ-ДД)",
    needDeliveryZone: "Зона доставки",
    needAddress: "Адрес доставки",
    addressLabel: "Адрес",
    noteLabel: "Комментарий",
    noteOptional: "Комментарий (необязательно)",
    choosePayment: "Способ оплаты",
    payRobokassa: "Картой (Robokassa)",
    payManual: "По реквизитам",
    amountToPay: (a) => `К оплате: ${a}`,
    orderComplete: "Заказ оформлен! Материалы придут в бот.",
    orderOnReceipt: "Заказ принят! Оплата при получении.",
    openPayment: "Перейти к оплате",
    sendProofInBot: "Отправьте чек оплаты в чат с ботом.",
    continue: "Продолжить",
    cancel: "Отмена",
  },
  kk: {
    searchPlaceholder: "Іздеу…",
    productsCount: (n) => `${n} тауар`,
    allCategories: "Барлығы",
    addToCart: "Себетке",
    variant: "Нұсқа",
    outOfStock: "Қолда жоқ",
    fromPrice: "бастап ",
    addedToCart: "Себетке қосылды",
    mixedCart: "Аралас себет қолжетімсіз",
    digitalLimit: "Себетте бар",
    couldNotAdd: "Қосу сәтті болмады",
    chooseVariant: "Нұсқаны таңдаңыз",
    sessionNotReady: "Telegram сессиясы дайын емес — боттан қайта ашыңыз",
    cartEmpty: "Себет бос",
    inCartOpen: "себетте — ашу",
    pay: "Төлеу",
    cartTitle: "Себет",
    remove: "Жою",
    checkoutInChat: "Төлем Mini App ішінде немесе төлем деректерімен.",
    checkoutFailed: "Тапсырыс жасалмады",
    networkError: "Желі қатесі",
    cartLoadFailed: "Себет жүктелмеді",
    backToCatalog: "← Каталог",
    description: "Сипаттама",
    rating: (avg, count) => `★ ${avg} (${count})`,
    needContact: "Телефон керек",
    needContactHint: "Тапсырыс үшін телефон көрсетіңіз немесе ботта контакт бөлісіңіз.",
    phoneLabel: "Телефон",
    needCountry: "Төлем елін таңдаңыз",
    chooseCountry: "Ел",
    needFulfillmentType: "Тапсырысты қалай аласыз?",
    pickup: "Өзі алып кету",
    delivery: "Жеткізу",
    needFulfillmentDate: "Алу күні",
    dateLabel: "Күні (ЖЖЖЖ-АА-КК)",
    needDeliveryZone: "Жеткізу аймағы",
    needAddress: "Жеткізу мекенжайы",
    addressLabel: "Мекенжай",
    noteLabel: "Пікір",
    noteOptional: "Пікір (міндетті емес)",
    choosePayment: "Төлем әдісі",
    payRobokassa: "Картамен (Robokassa)",
    payManual: "Деректемелер бойынша",
    amountToPay: (a) => `Төлемге: ${a}`,
    orderComplete: "Тапсырыс жасалды! Материалдар ботқа келеді.",
    orderOnReceipt: "Тапсырыс қабылданды! Алу кезінде төлем.",
    openPayment: "Төлемге өту",
    sendProofInBot: "Төлем чегін бот чатында жіберіңіз.",
    continue: "Жалғастыру",
    cancel: "Бас тарту",
  },
  en: {
    searchPlaceholder: "Search…",
    productsCount: (n) => `${n} products`,
    allCategories: "All",
    addToCart: "Add to cart",
    variant: "Variant",
    outOfStock: "Out of stock",
    fromPrice: "from ",
    addedToCart: "Added to cart",
    mixedCart: "Mixed cart is not supported",
    digitalLimit: "Already in cart",
    couldNotAdd: "Could not add",
    chooseVariant: "Choose a variant",
    sessionNotReady: "Telegram session not ready — reopen the shop from the bot",
    cartEmpty: "Cart is empty",
    inCartOpen: "in cart — open",
    pay: "Pay",
    cartTitle: "Cart",
    remove: "Remove",
    checkoutInChat: "Pay in Mini App or use payment details below.",
    checkoutFailed: "Could not place order",
    networkError: "Network error",
    cartLoadFailed: "Could not load cart",
    backToCatalog: "← Catalog",
    description: "Description",
    rating: (avg, count) => `★ ${avg} (${count})`,
    needContact: "Phone number required",
    needContactHint: "Enter your phone or share contact in the bot.",
    phoneLabel: "Phone",
    needCountry: "Choose payment country",
    chooseCountry: "Country",
    needFulfillmentType: "How will you receive the order?",
    pickup: "Pickup",
    delivery: "Delivery",
    needFulfillmentDate: "Pickup/delivery date",
    dateLabel: "Date (YYYY-MM-DD)",
    needDeliveryZone: "Delivery zone",
    needAddress: "Delivery address",
    addressLabel: "Address",
    noteLabel: "Note",
    noteOptional: "Note (optional)",
    choosePayment: "Payment method",
    payRobokassa: "Card (Robokassa)",
    payManual: "Bank transfer",
    amountToPay: (a) => `Amount due: ${a}`,
    orderComplete: "Order placed! Files will arrive in the bot.",
    orderOnReceipt: "Order accepted! Pay on receipt.",
    openPayment: "Go to payment",
    sendProofInBot: "Send payment proof in the bot chat.",
    continue: "Continue",
    cancel: "Cancel",
  },
  uz: {
    searchPlaceholder: "Qidiruv…",
    productsCount: (n) => `${n} mahsulot`,
    allCategories: "Hammasi",
    addToCart: "Savatga",
    variant: "Variant",
    outOfStock: "Mavjud emas",
    fromPrice: "dan ",
    addedToCart: "Savatga qo‘shildi",
    mixedCart: "Aralash savat mumkin emas",
    digitalLimit: "Savatda bor",
    couldNotAdd: "Qo‘shib bo‘lmadi",
    chooseVariant: "Variantni tanlang",
    sessionNotReady: "Telegram sessiyasi tayyor emas — botdan qayta oching",
    cartEmpty: "Savat bo‘sh",
    inCartOpen: "savatda — ochish",
    pay: "To‘lash",
    cartTitle: "Savat",
    remove: "O‘chirish",
    checkoutInChat: "Mini App ichida yoki quyidagi rekvizitlar bilan to‘lang.",
    checkoutFailed: "Buyurtma yaratilmadi",
    networkError: "Tarmoq xatosi",
    cartLoadFailed: "Savat yuklanmadi",
    backToCatalog: "← Katalog",
    description: "Tavsif",
    rating: (avg, count) => `★ ${avg} (${count})`,
    needContact: "Telefon kerak",
    needContactHint: "Buyurtma uchun telefon kiriting yoki botda kontakt ulashing.",
    phoneLabel: "Telefon",
    needCountry: "To‘lov mamlakatini tanlang",
    chooseCountry: "Mamlakat",
    needFulfillmentType: "Buyurtmani qanday olasiz?",
    pickup: "O‘zi olib ketish",
    delivery: "Yetkazib berish",
    needFulfillmentDate: "Olish sanasi",
    dateLabel: "Sana (YYYY-MM-DD)",
    needDeliveryZone: "Yetkazish zonasi",
    needAddress: "Yetkazish manzili",
    addressLabel: "Manzil",
    noteLabel: "Izoh",
    noteOptional: "Izoh (ixtiyoriy)",
    choosePayment: "To‘lov usuli",
    payRobokassa: "Karta (Robokassa)",
    payManual: "Rekvizitlar orqali",
    amountToPay: (a) => `To‘lov: ${a}`,
    orderComplete: "Buyurtma qabul qilindi! Fayllar botga keladi.",
    orderOnReceipt: "Buyurtma qabul qilindi! Olishda to‘lash.",
    openPayment: "To‘lovga o‘tish",
    sendProofInBot: "To‘lov chekini bot chatida yuboring.",
    continue: "Davom etish",
    cancel: "Bekor qilish",
  },
};

// uz block has needFulfillmentDate typo - I used needDeliveryDate by mistake. Fix in file.

export function miniAppLocaleFromTelegram(language_code?: string | null): Locale {
  const code = (language_code || "").toLowerCase();
  if (code.startsWith("kk")) return "kk";
  if (code.startsWith("en")) return "en";
  if (code.startsWith("uz")) return "uz";
  return "ru";
}

export function miniAppStrings(locale: Locale): MiniAppStrings {
  return dict[locale];
}

export function miniAppStringsForLanguage(language_code?: string | null): MiniAppStrings {
  const loc = miniAppLocaleFromTelegram(language_code);
  return miniAppStrings(loc);
}

/** JSON-safe copy for client (functions → static strings where needed). */
export function miniAppStringsClientPack(locale: Locale): Record<string, string> {
  const s = miniAppStrings(locale);
  return {
    searchPlaceholder: s.searchPlaceholder,
    allCategories: s.allCategories,
    addToCart: s.addToCart,
    variant: s.variant,
    outOfStock: s.outOfStock,
    fromPrice: s.fromPrice,
    addedToCart: s.addedToCart,
    mixedCart: s.mixedCart,
    digitalLimit: s.digitalLimit,
    couldNotAdd: s.couldNotAdd,
    chooseVariant: s.chooseVariant,
    sessionNotReady: s.sessionNotReady,
    cartEmpty: s.cartEmpty,
    inCartOpen: s.inCartOpen,
    pay: s.pay,
    cartTitle: s.cartTitle,
    remove: s.remove,
    checkoutInChat: s.checkoutInChat,
    checkoutFailed: s.checkoutFailed,
    networkError: s.networkError,
    cartLoadFailed: s.cartLoadFailed,
    backToCatalog: s.backToCatalog,
    description: s.description,
    needContact: s.needContact,
    needContactHint: s.needContactHint,
    phoneLabel: s.phoneLabel,
    needCountry: s.needCountry,
    chooseCountry: s.chooseCountry,
    needFulfillmentType: s.needFulfillmentType,
    pickup: s.pickup,
    delivery: s.delivery,
    needFulfillmentDate: s.needFulfillmentDate,
    dateLabel: s.dateLabel,
    needDeliveryZone: s.needDeliveryZone,
    needAddress: s.needAddress,
    addressLabel: s.addressLabel,
    noteLabel: s.noteLabel,
    noteOptional: s.noteOptional,
    choosePayment: s.choosePayment,
    payRobokassa: s.payRobokassa,
    payManual: s.payManual,
    orderComplete: s.orderComplete,
    orderOnReceipt: s.orderOnReceipt,
    openPayment: s.openPayment,
    sendProofInBot: s.sendProofInBot,
    continue: s.continue,
    cancel: s.cancel,
    productsCountSuffix: locale === "ru" ? "товаров" : locale === "kk" ? "тауар" : locale === "en" ? "products" : "mahsulot",
  };
}

export function resolveMiniAppLocale(value: unknown): Locale {
  return isLocale(value) ? value : "ru";
}
