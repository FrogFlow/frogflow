import { isLocale, type Locale } from "./i18n";
import { currentVertical } from "./verticals/vertical.server";

export type MiniAppStrings = {
  defaultShopName: string;
  emptyCatalog: string;
  searchPlaceholder: string;
  searchEmpty: string;
  categoryBack: string;
  searchingDeeper: string;
  productsCount: (n: number) => string;
  allCategories: string;
  filesAfterPayment: string;
  languagesLabel: string;
  allLanguages: string;
  inCart: string;
  materialLangAll: string;
  filesInBot: string;
  rateMaterial: string;
  rateThanks: string;
  myMaterials: string;
  emptyLibrary: string;
  purchased: string;
  moreInFolder: string;
  youMayAlsoLike: string;
  sortCatalog: string;
  sortPopular: string;
  sortNew: string;
  sortPrice: string;
  filesIncluded: string;
  reviewsTitle: string;
  noReviews: string;
  shareMaterial: string;
  copied: string;
  tabCatalog: string;
  tabLibrary: string;
  tabOrders: string;
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
  subtotal: string;
  discount: string;
  promoCode: string;
  giftCode: string;
  apply: string;
  loyaltyPoints: string;
  usePoints: string;
  clear: string;
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
  chooseDeliveryLanguage: string;
  needAddress: string;
  addressLabel: string;
  noteLabel: string;
  noteOptional: string;
  choosePayment: string;
  payRobokassa: string;
  payManual: string;
  amountToPay: (amount: string) => string;
  depositNow: (amount: string) => string;
  orderComplete: string;
  orderCompletePhysical: string;
  orderOnReceipt: string;
  leadTime: (days: number) => string;
  inStock: string;
  pagination: string;
  paidLabel: string;
  physicalDelivering: string;
  openPayment: string;
  sendProofInBot: string;
  continue: string;
  cancel: string;
  back: string;
  close: string;
  loading: string;
  inProgress: string;
  invalidField: string;
  paymentUnavailable: string;
  pendingOrder: string;
  continuePayment: string;
  cancelOrder: string;
  rateLimited: string;
  pendingConflict: string;
  orderAlreadyProcessed: string;
  uploadReceipt: string;
  chooseReceipt: string;
  uploadingReceipt: string;
  proofReview: string;
  proofRetry: string;
  proofAccepted: string;
  proofCompleted: string;
  invalidReceiptFile: string;
  receiptTooLarge: string;
  myOrders: string;
  noOrders: string;
  resendFiles: string;
  contactSupport: string;
  waitingPayment: string;
  paymentConfirmed: string;
  filesResent: string;
  orderStatus: Record<string, string>;
};

const dict: Record<Locale, MiniAppStrings> = {
  ru: {
    defaultShopName: "Магазин",
    emptyCatalog: "Материалов пока нет.",
    searchPlaceholder: "Поиск материала…",
    searchEmpty: "Материал не найден.",
    categoryBack: "← Назад",
    searchingDeeper: "Ищу по смыслу…",
    productsCount: (n) => `${n} материалов`,
    allCategories: "Все",
    filesAfterPayment: "Файл придёт в бот после оплаты",
    languagesLabel: "Языки",
    allLanguages: "🌐 Все языки (цена ×N)",
    inCart: "В корзине",
    materialLangAll: "Все языки",
    filesInBot: "Файлы отправлены в бот",
    rateMaterial: "Оценить материал",
    rateThanks: "Спасибо за оценку!",
    myMaterials: "Мои материалы",
    emptyLibrary: "Купленных материалов пока нет.",
    purchased: "Куплено",
    moreInFolder: "Ещё в этой папке",
    youMayAlsoLike: "Может понравиться",
    sortCatalog: "Каталог",
    sortPopular: "Популярные",
    sortNew: "Новые",
    sortPrice: "Цена",
    filesIncluded: "Какие файлы придут",
    reviewsTitle: "Оценки",
    noReviews: "Оценок пока нет.",
    shareMaterial: "Поделиться",
    copied: "Скопировано",
    tabCatalog: "Каталог",
    tabLibrary: "Материалы",
    tabOrders: "Заказы",
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
    subtotal: "Товары",
    discount: "Скидка",
    promoCode: "Промокод",
    giftCode: "Сертификат",
    apply: "Применить",
    loyaltyPoints: "Баллы",
    usePoints: "Списать баллы",
    clear: "Убрать",
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
    dateLabel: "Дата",
    needDeliveryZone: "Зона доставки",
    chooseDeliveryLanguage: "Язык материалов",
    needAddress: "Адрес доставки",
    addressLabel: "Адрес",
    noteLabel: "Комментарий",
    noteOptional: "Комментарий (необязательно)",
    choosePayment: "Способ оплаты",
    payRobokassa: "Картой (Robokassa)",
    payManual: "По реквизитам",
    amountToPay: (a) => `К оплате: ${a}`,
    depositNow: (a) => `Предоплата сейчас: ${a}`,
    orderComplete: "Заказ оформлен! Материалы придут в бот.",
    orderCompletePhysical: "Заказ оформлен! Статус придёт в бот.",
    orderOnReceipt: "Заказ принят! Оплата при получении.",
    leadTime: (days) => `Готовим ${days} дн.`,
    inStock: "В наличии",
    pagination: "Страницы",
    paidLabel: "Оплачено",
    physicalDelivering: "Готовится к выдаче",
    openPayment: "Перейти к оплате",
    sendProofInBot: "Если загрузка не сработала — отправьте чек в чат с ботом.",
    continue: "Продолжить",
    cancel: "Отмена",
    back: "Назад",
    close: "Закрыть",
    loading: "Подождите…",
    inProgress: "Заказ уже оформляется",
    invalidField: "Проверьте введённые данные",
    paymentUnavailable: "Выбранный способ оплаты недоступен",
    pendingOrder: "Заказ ожидает оплаты",
    continuePayment: "Продолжить оплату",
    cancelOrder: "Отменить заказ",
    rateLimited: "Слишком много запросов. Подождите минуту.",
    pendingConflict: "Сначала оплатите или отмените предыдущий заказ.",
    orderAlreadyProcessed: "Заказ уже обработан. Обновите список заказов.",
    uploadReceipt: "Загрузить чек",
    chooseReceipt: "Выберите фото или PDF чека",
    uploadingReceipt: "Загрузка чека…",
    proofReview: "Чек отправлен продавцу на проверку.",
    proofRetry: "Файл не похож на чек. Загрузите другой.",
    proofAccepted: "Оплата подтверждена, заказ принят в работу.",
    proofCompleted: "Оплата подтверждена, материалы отправлены в бот.",
    invalidReceiptFile: "Нужен чек в формате JPEG, PNG, WebP, HEIC или PDF.",
    receiptTooLarge: "Файл больше 20 МБ.",
    myOrders: "Мои заказы",
    noOrders: "Заказов пока нет.",
    resendFiles: "Получить файлы повторно",
    contactSupport: "Написать в бот",
    waitingPayment: "Ожидаем оплату. Можно вернуться сюда после оплаты.",
    paymentConfirmed: "Оплата получена. Статус заказа обновлён.",
    filesResent: "Файлы отправлены в бот.",
    orderStatus: {
      awaiting_payment: "Ожидает оплаты",
      awaiting_confirmation: "Чек проверяется",
      delivering: "Материалы отправляются",
      delivered: "Выполнен",
      accepted: "Принят в работу",
      in_production: "В работе",
      ready: "Готов",
      rejected: "Отменён",
    },
  },
  kk: {
    defaultShopName: "Дүкен",
    emptyCatalog: "Материалдар әзірге жоқ.",
    searchPlaceholder: "Материал іздеу…",
    searchEmpty: "Материал табылмады.",
    categoryBack: "← Артқа",
    searchingDeeper: "Мағынасы бойынша іздеу…",
    productsCount: (n) => `${n} материал`,
    allCategories: "Барлығы",
    filesAfterPayment: "Файл төлемнен кейін ботқа келеді",
    languagesLabel: "Тілдер",
    allLanguages: "🌐 Барлық тілдер (баға ×N)",
    inCart: "Себетте",
    materialLangAll: "Барлық тілдер",
    filesInBot: "Файлдар ботқа жіберілді",
    rateMaterial: "Материалды бағалау",
    rateThanks: "Бағалағаныңызға рақмет!",
    myMaterials: "Менің материалдарым",
    emptyLibrary: "Сатып алынған материалдар әзірге жоқ.",
    purchased: "Сатып алынды",
    moreInFolder: "Осы бумада тағы",
    youMayAlsoLike: "Ұнауы мүмкін",
    sortCatalog: "Каталог",
    sortPopular: "Танымал",
    sortNew: "Жаңа",
    sortPrice: "Баға",
    filesIncluded: "Қандай файлдар келеді",
    reviewsTitle: "Бағалар",
    noReviews: "Бағалар әзірге жоқ.",
    shareMaterial: "Бөлісу",
    copied: "Көшірілді",
    tabCatalog: "Каталог",
    tabLibrary: "Материалдар",
    tabOrders: "Тапсырыстар",
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
    subtotal: "Тауарлар",
    discount: "Жеңілдік",
    promoCode: "Промокод",
    giftCode: "Сертификат",
    apply: "Қолдану",
    loyaltyPoints: "Ұпайлар",
    usePoints: "Ұпайларды пайдалану",
    clear: "Алып тастау",
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
    dateLabel: "Күні",
    needDeliveryZone: "Жеткізу аймағы",
    chooseDeliveryLanguage: "Материалдар тілі",
    needAddress: "Жеткізу мекенжайы",
    addressLabel: "Мекенжай",
    noteLabel: "Пікір",
    noteOptional: "Пікір (міндетті емес)",
    choosePayment: "Төлем әдісі",
    payRobokassa: "Картамен (Robokassa)",
    payManual: "Деректемелер бойынша",
    amountToPay: (a) => `Төлемге: ${a}`,
    depositNow: (a) => `Қазір алдын ала төлем: ${a}`,
    orderComplete: "Тапсырыс жасалды! Материалдар ботқа келеді.",
    orderCompletePhysical: "Тапсырыс жасалды! Мәртебе ботқа келеді.",
    orderOnReceipt: "Тапсырыс қабылданды! Алу кезінде төлем.",
    leadTime: (days) => `Дайындау: ${days} күн`,
    inStock: "Қолда бар",
    pagination: "Беттер",
    paidLabel: "Төленді",
    physicalDelivering: "Беруге дайындалуда",
    openPayment: "Төлемге өту",
    sendProofInBot: "Жүктеу істемесе — чекті бот чатына жіберіңіз.",
    continue: "Жалғастыру",
    cancel: "Бас тарту",
    back: "Артқа",
    close: "Жабу",
    loading: "Күте тұрыңыз…",
    inProgress: "Тапсырыс рәсімделіп жатыр",
    invalidField: "Енгізілген деректерді тексеріңіз",
    paymentUnavailable: "Төлем әдісі қолжетімсіз",
    pendingOrder: "Тапсырыс төлемді күтуде",
    continuePayment: "Төлемді жалғастыру",
    cancelOrder: "Тапсырыстан бас тарту",
    rateLimited: "Сұраулар тым көп. Бір минут күтіңіз.",
    pendingConflict: "Алдымен алдыңғы тапсырысты төлеңіз немесе одан бас тартыңыз.",
    orderAlreadyProcessed: "Тапсырыс өңделді. Тізімді жаңартыңыз.",
    uploadReceipt: "Чекті жүктеу",
    chooseReceipt: "Чектің фотосын немесе PDF файлын таңдаңыз",
    uploadingReceipt: "Чек жүктелуде…",
    proofReview: "Чек сатушыға тексеруге жіберілді.",
    proofRetry: "Файл чекке ұқсамайды. Басқасын жүктеңіз.",
    proofAccepted: "Төлем расталды, тапсырыс жұмысқа қабылданды.",
    proofCompleted: "Төлем расталды, материалдар ботқа жіберілді.",
    invalidReceiptFile: "JPEG, PNG, WebP, HEIC немесе PDF чек қажет.",
    receiptTooLarge: "Файл 20 МБ-тан үлкен.",
    myOrders: "Менің тапсырыстарым",
    noOrders: "Тапсырыстар әзірге жоқ.",
    resendFiles: "Файлдарды қайта алу",
    contactSupport: "Ботқа жазу",
    waitingPayment: "Төлемді күтеміз. Төлегеннен кейін осында оралыңыз.",
    paymentConfirmed: "Төлем қабылданды. Тапсырыс мәртебесі жаңартылды.",
    filesResent: "Файлдар ботқа жіберілді.",
    orderStatus: {
      awaiting_payment: "Төлемді күтуде",
      awaiting_confirmation: "Чек тексерілуде",
      delivering: "Материалдар жіберілуде",
      delivered: "Орындалды",
      accepted: "Жұмысқа қабылданды",
      in_production: "Жұмыста",
      ready: "Дайын",
      rejected: "Бас тартылды",
    },
  },
  en: {
    defaultShopName: "Shop",
    emptyCatalog: "No materials yet.",
    searchPlaceholder: "Search materials…",
    searchEmpty: "No materials found.",
    categoryBack: "← Back",
    searchingDeeper: "Searching by meaning…",
    productsCount: (n) => `${n} materials`,
    allCategories: "All",
    filesAfterPayment: "The file arrives in the bot after payment",
    languagesLabel: "Languages",
    allLanguages: "🌐 All languages (price ×N)",
    inCart: "In cart",
    materialLangAll: "All languages",
    filesInBot: "Files were sent to the bot",
    rateMaterial: "Rate this material",
    rateThanks: "Thanks for the rating!",
    myMaterials: "My materials",
    emptyLibrary: "No purchased materials yet.",
    purchased: "Purchased",
    moreInFolder: "More in this folder",
    youMayAlsoLike: "You may also like",
    sortCatalog: "Catalog",
    sortPopular: "Popular",
    sortNew: "New",
    sortPrice: "Price",
    filesIncluded: "Files you will get",
    reviewsTitle: "Ratings",
    noReviews: "No ratings yet.",
    shareMaterial: "Share",
    copied: "Copied",
    tabCatalog: "Catalog",
    tabLibrary: "Library",
    tabOrders: "Orders",
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
    subtotal: "Items",
    discount: "Discount",
    promoCode: "Promo code",
    giftCode: "Gift certificate",
    apply: "Apply",
    loyaltyPoints: "Points",
    usePoints: "Use points",
    clear: "Remove",
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
    dateLabel: "Date",
    needDeliveryZone: "Delivery zone",
    chooseDeliveryLanguage: "Material language",
    needAddress: "Delivery address",
    addressLabel: "Address",
    noteLabel: "Note",
    noteOptional: "Note (optional)",
    choosePayment: "Payment method",
    payRobokassa: "Card (Robokassa)",
    payManual: "Bank transfer",
    amountToPay: (a) => `Amount due: ${a}`,
    depositNow: (a) => `Deposit due now: ${a}`,
    orderComplete: "Order placed! Files will arrive in the bot.",
    orderCompletePhysical: "Order placed! Status updates will arrive in the bot.",
    orderOnReceipt: "Order accepted! Pay on receipt.",
    leadTime: (days) => `Made to order: ${days} day${days === 1 ? "" : "s"}`,
    inStock: "In stock",
    pagination: "Pages",
    paidLabel: "Paid",
    physicalDelivering: "Being prepared",
    openPayment: "Go to payment",
    sendProofInBot: "If upload fails, send the receipt in the bot chat.",
    continue: "Continue",
    cancel: "Cancel",
    back: "Back",
    close: "Close",
    loading: "Please wait…",
    inProgress: "The order is already being processed",
    invalidField: "Check the entered information",
    paymentUnavailable: "This payment method is unavailable",
    pendingOrder: "Order awaiting payment",
    continuePayment: "Continue payment",
    cancelOrder: "Cancel order",
    rateLimited: "Too many requests. Please wait a minute.",
    pendingConflict: "Complete or cancel the previous order first.",
    orderAlreadyProcessed: "The order has already been processed. Refresh your orders.",
    uploadReceipt: "Upload receipt",
    chooseReceipt: "Choose a receipt photo or PDF",
    uploadingReceipt: "Uploading receipt…",
    proofReview: "The receipt was sent to the seller for review.",
    proofRetry: "This file does not look like a receipt. Upload another one.",
    proofAccepted: "Payment confirmed. Your order is now being prepared.",
    proofCompleted: "Payment confirmed. Files were sent to the bot.",
    invalidReceiptFile: "Upload a JPEG, PNG, WebP, HEIC or PDF receipt.",
    receiptTooLarge: "The file is larger than 20 MB.",
    myOrders: "My orders",
    noOrders: "No orders yet.",
    resendFiles: "Send files again",
    contactSupport: "Open bot",
    waitingPayment: "Waiting for payment. You can return here after paying.",
    paymentConfirmed: "Payment received. Order status updated.",
    filesResent: "Files were sent to the bot.",
    orderStatus: {
      awaiting_payment: "Awaiting payment",
      awaiting_confirmation: "Receipt under review",
      delivering: "Sending files",
      delivered: "Completed",
      accepted: "Accepted",
      in_production: "In progress",
      ready: "Ready",
      rejected: "Cancelled",
    },
  },
  uz: {
    defaultShopName: "Do‘kon",
    emptyCatalog: "Materiallar hozircha yo‘q.",
    searchPlaceholder: "Material qidirish…",
    searchEmpty: "Material topilmadi.",
    categoryBack: "← Orqaga",
    searchingDeeper: "Ma’no bo‘yicha qidirilmoqda…",
    productsCount: (n) => `${n} material`,
    allCategories: "Hammasi",
    filesAfterPayment: "Fayl to‘lovdan so‘ng botga keladi",
    languagesLabel: "Tillar",
    allLanguages: "🌐 Barcha tillar (narx ×N)",
    inCart: "Savatda",
    materialLangAll: "Barcha tillar",
    filesInBot: "Fayllar botga yuborildi",
    rateMaterial: "Materialni baholash",
    rateThanks: "Bahongiz uchun rahmat!",
    myMaterials: "Materiallarim",
    emptyLibrary: "Sotib olingan materiallar hozircha yo‘q.",
    purchased: "Sotib olingan",
    moreInFolder: "Shu jildda yana",
    youMayAlsoLike: "Sizga yoqishi mumkin",
    sortCatalog: "Katalog",
    sortPopular: "Mashhur",
    sortNew: "Yangi",
    sortPrice: "Narx",
    filesIncluded: "Qaysi fayllar keladi",
    reviewsTitle: "Baholar",
    noReviews: "Baholar hozircha yo‘q.",
    shareMaterial: "Ulashish",
    copied: "Nusxa olindi",
    tabCatalog: "Katalog",
    tabLibrary: "Materiallar",
    tabOrders: "Buyurtmalar",
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
    subtotal: "Mahsulotlar",
    discount: "Chegirma",
    promoCode: "Promokod",
    giftCode: "Sertifikat",
    apply: "Qo‘llash",
    loyaltyPoints: "Ballar",
    usePoints: "Ballarni ishlatish",
    clear: "Olib tashlash",
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
    dateLabel: "Sana",
    needDeliveryZone: "Yetkazish zonasi",
    chooseDeliveryLanguage: "Materiallar tili",
    needAddress: "Yetkazish manzili",
    addressLabel: "Manzil",
    noteLabel: "Izoh",
    noteOptional: "Izoh (ixtiyoriy)",
    choosePayment: "To‘lov usuli",
    payRobokassa: "Karta (Robokassa)",
    payManual: "Rekvizitlar orqali",
    amountToPay: (a) => `To‘lov: ${a}`,
    depositNow: (a) => `Hozirgi oldindan to‘lov: ${a}`,
    orderComplete: "Buyurtma qabul qilindi! Fayllar botga keladi.",
    orderCompletePhysical: "Buyurtma qabul qilindi! Holat botga keladi.",
    orderOnReceipt: "Buyurtma qabul qilindi! Olishda to‘lash.",
    leadTime: (days) => `Tayyorlash: ${days} kun`,
    inStock: "Mavjud",
    pagination: "Sahifalar",
    paidLabel: "To‘langan",
    physicalDelivering: "Berishga tayyorlanmoqda",
    openPayment: "To‘lovga o‘tish",
    sendProofInBot: "Yuklash ishlamasa — chekni bot chatiga yuboring.",
    continue: "Davom etish",
    cancel: "Bekor qilish",
    back: "Orqaga",
    close: "Yopish",
    loading: "Kuting…",
    inProgress: "Buyurtma rasmiylashtirilmoqda",
    invalidField: "Kiritilgan ma’lumotlarni tekshiring",
    paymentUnavailable: "To‘lov usuli mavjud emas",
    pendingOrder: "Buyurtma to‘lovni kutmoqda",
    continuePayment: "To‘lovni davom ettirish",
    cancelOrder: "Buyurtmani bekor qilish",
    rateLimited: "Juda ko‘p so‘rov. Bir daqiqa kuting.",
    pendingConflict: "Avval oldingi buyurtmani to‘lang yoki bekor qiling.",
    orderAlreadyProcessed: "Buyurtma allaqachon qayta ishlangan. Ro‘yxatni yangilang.",
    uploadReceipt: "Chekni yuklash",
    chooseReceipt: "Chek rasmi yoki PDF faylini tanlang",
    uploadingReceipt: "Chek yuklanmoqda…",
    proofReview: "Chek sotuvchiga tekshirish uchun yuborildi.",
    proofRetry: "Fayl chekga o‘xshamaydi. Boshqasini yuklang.",
    proofAccepted: "To‘lov tasdiqlandi, buyurtma ishga qabul qilindi.",
    proofCompleted: "To‘lov tasdiqlandi, fayllar botga yuborildi.",
    invalidReceiptFile: "JPEG, PNG, WebP, HEIC yoki PDF chek yuklang.",
    receiptTooLarge: "Fayl 20 MB dan katta.",
    myOrders: "Buyurtmalarim",
    noOrders: "Buyurtmalar hali yo‘q.",
    resendFiles: "Fayllarni qayta olish",
    contactSupport: "Botga yozish",
    waitingPayment: "To‘lovni kutmoqdamiz. To‘lagach shu yerga qayting.",
    paymentConfirmed: "To‘lov qabul qilindi. Buyurtma holati yangilandi.",
    filesResent: "Fayllar botga yuborildi.",
    orderStatus: {
      awaiting_payment: "To‘lov kutilmoqda",
      awaiting_confirmation: "Chek tekshirilmoqda",
      delivering: "Fayllar yuborilmoqda",
      delivered: "Bajarildi",
      accepted: "Ishga qabul qilindi",
      in_production: "Jarayonda",
      ready: "Tayyor",
      rejected: "Bekor qilindi",
    },
  },
};

export function miniAppLocaleFromTelegram(language_code?: string | null): Locale {
  const code = (language_code || "").toLowerCase();
  if (code.startsWith("kk")) return "kk";
  if (code.startsWith("en")) return "en";
  if (code.startsWith("uz")) return "uz";
  return "ru";
}

const confectioneryOverlay: Record<Locale, Partial<MiniAppStrings>> = {
  ru: {
    emptyCatalog: "Каталог пока пуст.",
    searchPlaceholder: "Поиск…",
    searchEmpty: "Ничего не найдено.",
    productsCount: (n) => `${n} товаров`,
  },
  kk: {
    emptyCatalog: "Каталог әзірге бос.",
    searchPlaceholder: "Іздеу…",
    searchEmpty: "Ештеңе табылмады.",
    productsCount: (n) => `${n} тауар`,
  },
  en: {
    emptyCatalog: "The catalog is empty.",
    searchPlaceholder: "Search…",
    searchEmpty: "Nothing found.",
    productsCount: (n) => `${n} products`,
  },
  uz: {
    emptyCatalog: "Katalog hozircha bo‘sh.",
    searchPlaceholder: "Qidiruv…",
    searchEmpty: "Hech narsa topilmadi.",
    productsCount: (n) => `${n} mahsulot`,
  },
};

export function miniAppStrings(locale: Locale): MiniAppStrings {
  const s = dict[locale];
  if (currentVertical() !== "confectionery") return s;
  return { ...s, ...confectioneryOverlay[locale] };
}

export function miniAppStringsForLanguage(language_code?: string | null): MiniAppStrings {
  const loc = miniAppLocaleFromTelegram(language_code);
  return miniAppStrings(loc);
}

/** JSON-safe copy for client (functions → static strings where needed). */
export function miniAppStringsClientPack(
  locale: Locale,
): Record<string, string | Record<string, string>> {
  const s = miniAppStrings(locale);
  return {
    defaultShopName: s.defaultShopName,
    emptyCatalog: s.emptyCatalog,
    searchPlaceholder: s.searchPlaceholder,
    searchEmpty: s.searchEmpty,
    categoryBack: s.categoryBack,
    searchingDeeper: s.searchingDeeper,
    allCategories: s.allCategories,
    filesAfterPayment: s.filesAfterPayment,
    languagesLabel: s.languagesLabel,
    allLanguages: s.allLanguages,
    inCart: s.inCart,
    materialLangAll: s.materialLangAll,
    filesInBot: s.filesInBot,
    rateMaterial: s.rateMaterial,
    rateThanks: s.rateThanks,
    myMaterials: s.myMaterials,
    emptyLibrary: s.emptyLibrary,
    purchased: s.purchased,
    moreInFolder: s.moreInFolder,
    sortCatalog: s.sortCatalog,
    sortPopular: s.sortPopular,
    sortNew: s.sortNew,
    sortPrice: s.sortPrice,
    filesIncluded: s.filesIncluded,
    reviewsTitle: s.reviewsTitle,
    noReviews: s.noReviews,
    shareMaterial: s.shareMaterial,
    copied: s.copied,
    tabCatalog: s.tabCatalog,
    tabLibrary: s.tabLibrary,
    tabOrders: s.tabOrders,
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
    subtotal: s.subtotal,
    discount: s.discount,
    promoCode: s.promoCode,
    giftCode: s.giftCode,
    apply: s.apply,
    loyaltyPoints: s.loyaltyPoints,
    usePoints: s.usePoints,
    clear: s.clear,
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
    chooseDeliveryLanguage: s.chooseDeliveryLanguage,
    needAddress: s.needAddress,
    addressLabel: s.addressLabel,
    noteLabel: s.noteLabel,
    noteOptional: s.noteOptional,
    choosePayment: s.choosePayment,
    payRobokassa: s.payRobokassa,
    payManual: s.payManual,
    orderComplete: s.orderComplete,
    orderCompletePhysical: s.orderCompletePhysical,
    orderOnReceipt: s.orderOnReceipt,
    inStock: s.inStock,
    pagination: s.pagination,
    paidLabel: s.paidLabel,
    physicalDelivering: s.physicalDelivering,
    openPayment: s.openPayment,
    sendProofInBot: s.sendProofInBot,
    continue: s.continue,
    cancel: s.cancel,
    back: s.back,
    close: s.close,
    loading: s.loading,
    inProgress: s.inProgress,
    invalidField: s.invalidField,
    paymentUnavailable: s.paymentUnavailable,
    pendingOrder: s.pendingOrder,
    continuePayment: s.continuePayment,
    cancelOrder: s.cancelOrder,
    rateLimited: s.rateLimited,
    pendingConflict: s.pendingConflict,
    orderAlreadyProcessed: s.orderAlreadyProcessed,
    uploadReceipt: s.uploadReceipt,
    chooseReceipt: s.chooseReceipt,
    uploadingReceipt: s.uploadingReceipt,
    proofReview: s.proofReview,
    proofRetry: s.proofRetry,
    proofAccepted: s.proofAccepted,
    proofCompleted: s.proofCompleted,
    invalidReceiptFile: s.invalidReceiptFile,
    receiptTooLarge: s.receiptTooLarge,
    myOrders: s.myOrders,
    noOrders: s.noOrders,
    resendFiles: s.resendFiles,
    contactSupport: s.contactSupport,
    waitingPayment: s.waitingPayment,
    paymentConfirmed: s.paymentConfirmed,
    filesResent: s.filesResent,
    orderStatus: s.orderStatus,
    productsCountSuffix: s.productsCount(0).replace(/^\d+\s*/, ""),
  };
}

export function resolveMiniAppLocale(value: unknown): Locale {
  return isLocale(value) ? value : "ru";
}
