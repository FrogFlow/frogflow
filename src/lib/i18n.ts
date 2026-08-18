export const SUPPORTED_LOCALES = ["ru", "kk", "en", "uz"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const localeNames: Record<Locale, string> = {
  ru: "Русский",
  kk: "Қазақша",
  en: "English",
  uz: "O‘zbekcha",
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
  payments: { ru: "Реквизиты", kk: "Төлем деректері", en: "Payment details", uz: "To‘lov ma’lumotlari" },
  settings: { ru: "Настройки", kk: "Баптаулар", en: "Settings", uz: "Sozlamalar" },
  logout: { ru: "Выйти", kk: "Шығу", en: "Log out", uz: "Chiqish" },
  language: { ru: "Язык", kk: "Тіл", en: "Language", uz: "Til" },
  blocked: { ru: "Блокировка", kk: "Бұғаттау", en: "Blocking", uz: "Bloklash" },
  vip: { ru: "VIP-группа", kk: "VIP-топ", en: "VIP group", uz: "VIP-guruh" },
};

export function t(key: keyof typeof messages, locale: Locale): string {
  return messages[key][locale];
}
