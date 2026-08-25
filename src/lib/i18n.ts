export const SUPPORTED_LOCALES = ["ru", "kk", "en", "uz"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const localeNames: Record<Locale, string> = {
  ru: "Русский",
  kk: "Қазақша",
  en: "English",
  uz: "O‘zbekcha",
};

export const localeFlags: Record<Locale, string> = {
  ru: "🇷🇺",
  kk: "🇰🇿",
  en: "🇬🇧",
  uz: "🇺🇿",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

type Dictionary = Record<string, Record<Locale, string>>;

const messages: Dictionary = {
  adminPanel: { ru: "Админ-панель", kk: "Әкімші панелі", en: "Admin panel", uz: "Admin paneli" },
  dashboard: { ru: "Дашборд", kk: "Басқару тақтасы", en: "Dashboard", uz: "Boshqaruv paneli" },
  categories: { ru: "Категории", kk: "Санаттар", en: "Categories", uz: "Kategoriyalar" },
  products: { ru: "Товары", kk: "Тауарлар", en: "Products", uz: "Mahsulotlar" },
  orders: { ru: "Заказы", kk: "Тапсырыстар", en: "Orders", uz: "Buyurtmalar" },
  broadcast: { ru: "Рассылка", kk: "Хабарлама", en: "Broadcast", uz: "Xabar yuborish" },
  promoCodes: { ru: "Промокоды", kk: "Промокодтар", en: "Promo codes", uz: "Promokodlar" },
  giftCertificates: {
    ru: "Сертификаты",
    kk: "Сертификаттар",
    en: "Certificates",
    uz: "Sertifikatlar",
  },
  payments: {
    ru: "Реквизиты",
    kk: "Төлем деректері",
    en: "Payment details",
    uz: "To‘lov ma’lumotlari",
  },
  settings: { ru: "Настройки", kk: "Баптаулар", en: "Settings", uz: "Sozlamalar" },
  catalogGroup: { ru: "Каталог", kk: "Каталог", en: "Catalog", uz: "Katalog" },
  paymentGroup: { ru: "Оплата", kk: "Төлем", en: "Payment", uz: "To‘lov" },
  promotionGroup: { ru: "Продвижение", kk: "Жылжыту", en: "Promotion", uz: "Reklama" },
  audienceGroup: { ru: "Аудитория", kk: "Аудитория", en: "Audience", uz: "Auditoriya" },
  modules: { ru: "Модули", kk: "Модульдер", en: "Modules", uz: "Modullar" },
  managerChat: {
    ru: "Чат с менеджером",
    kk: "Менеджермен чат",
    en: "Manager chat",
    uz: "Menejer bilan chat",
  },
  logout: { ru: "Выйти", kk: "Шығу", en: "Log out", uz: "Chiqish" },
  language: { ru: "Язык", kk: "Тіл", en: "Language", uz: "Til" },
  blocked: { ru: "Блокировка", kk: "Бұғаттау", en: "Blocking", uz: "Bloklash" },
  vip: { ru: "VIP-группа", kk: "VIP-топ", en: "VIP group", uz: "VIP-guruh" },
  moduleLocked: {
    ru: "Модуль не подключён. Чтобы активировать — свяжитесь с администратором.",
    kk: "Модуль қосылмаған. Іске қосу үшін әкімшіге хабарласыңыз.",
    en: "This module isn't enabled. Contact the administrator to activate it.",
    uz: "Modul ulanmagan. Faollashtirish uchun administrator bilan bog‘laning.",
  },
  moduleLockedAlert: {
    ru: "Этот раздел не подключён к вашему тарифу.\nЧтобы активировать — свяжитесь с администратором.",
    kk: "Бұл бөлім сіздің тарифке қосылмаған.\nІске қосу үшін әкімшіге хабарласыңыз.",
    en: "This section isn't included in your plan.\nContact the administrator to activate it.",
    uz: "Bu bo‘lim tarifingizga ulanmagan.\nFaollashtirish uchun administrator bilan bog‘laning.",
  },
  // Common buttons/labels reused across many admin pages.
  save: { ru: "Сохранить", kk: "Сақтау", en: "Save", uz: "Saqlash" },
  cancel: { ru: "Отмена", kk: "Бас тарту", en: "Cancel", uz: "Bekor qilish" },
  delete: { ru: "Удалить", kk: "Жою", en: "Delete", uz: "O‘chirish" },
  edit: { ru: "Изменить", kk: "Өзгерту", en: "Edit", uz: "Tahrirlash" },
  add: { ru: "Добавить", kk: "Қосу", en: "Add", uz: "Qo‘shish" },
  create: { ru: "Создать", kk: "Құру", en: "Create", uz: "Yaratish" },
  close: { ru: "Закрыть", kk: "Жабу", en: "Close", uz: "Yopish" },
  loading: { ru: "Загрузка…", kk: "Жүктелуде…", en: "Loading…", uz: "Yuklanmoqda…" },
  saving: { ru: "Сохранение…", kk: "Сақталуда…", en: "Saving…", uz: "Saqlanmoqda…" },
  confirm: { ru: "Подтвердить", kk: "Растау", en: "Confirm", uz: "Tasdiqlash" },
  yes: { ru: "Да", kk: "Иә", en: "Yes", uz: "Ha" },
  no: { ru: "Нет", kk: "Жоқ", en: "No", uz: "Yo‘q" },
  search: { ru: "Поиск", kk: "Іздеу", en: "Search", uz: "Qidiruv" },
  back: { ru: "Назад", kk: "Артқа", en: "Back", uz: "Orqaga" },
  actions: { ru: "Действия", kk: "Әрекеттер", en: "Actions", uz: "Amallar" },
  name: { ru: "Название", kk: "Атауы", en: "Name", uz: "Nomi" },
  status: { ru: "Статус", kk: "Мәртебесі", en: "Status", uz: "Holati" },
  error: { ru: "Ошибка", kk: "Қате", en: "Error", uz: "Xato" },
  success: { ru: "Готово", kk: "Дайын", en: "Done", uz: "Tayyor" },
  noData: { ru: "Пока пусто", kk: "Әзірге бос", en: "Nothing here yet", uz: "Hozircha bo‘sh" },
  requestConnection: {
    ru: "Заказать подключение",
    kk: "Қосуды тапсырыс беру",
    en: "Request connection",
    uz: "Ulanishni buyurtma qilish",
  },
  requestSent: {
    ru: "Заявка отправлена",
    kk: "Өтінім жіберілді",
    en: "Request sent",
    uz: "So‘rov yuborildi",
  },
  alreadyRequested: {
    ru: "Заявка уже отправлена — ожидайте связи",
    kk: "Өтінім жіберілген — байланысты күтіңіз",
    en: "Already requested — we'll reach out",
    uz: "So‘rov allaqachon yuborilgan — kuting",
  },
  connected: { ru: "Подключено", kk: "Қосылған", en: "Connected", uz: "Ulangan" },
  includedInPlan: {
    ru: "Входит в пакет",
    kk: "Пакетке кіреді",
    en: "Included in your plan",
    uz: "Paketga kiradi",
  },
};

export function t(key: keyof typeof messages, locale: Locale): string {
  return messages[key][locale];
}
