/**
 * Единственный источник списка модулей — для гардов в коде и, начиная с
 * Фазы 2, для тумблеров в панели оператора и (в будущем) витрины модулей в
 * клиентской админке. Второго списка ключей не заводить нигде: миграции,
 * панель и код читают этот файл.
 *
 * Цены — из «ПРАЙС-ЛИСТ · 2026» (v8). Где в прайсе есть отдельная цена
 * «к вашему боту» (модуль как надстройка над уже готовым ботом, а не
 * отдельный продукт с нуля) — берётся она: у всех текущих пяти клиентов бот
 * уже есть.
 */

export type ModuleDef = {
  /** Как показывать в панели / витрине. */
  title: string;
  /** Группировка — совпадает с разделами прайса. */
  group: string;
  /** ₸/мес не берём — здесь разовая стоимость подключения; null — входит в базу. */
  price: number | null;
  /** "planned" — записан в прайсе, кода ещё нет: показывается серым, включить нельзя. */
  status: "available" | "planned";
  /**
   * Зависимости — включить нельзя, пока не включена зависимость. Типизировано
   * как string[], а не ModuleKey[]: ModuleKey выводится из типа MODULES, а
   * MODULES типизирован через ModuleDef — ссылка друг на друга внутри одного
   * литерала TypeScript не резолвит (circular type reference).
   */
  requires?: string[];
  /** Подсказка оператору в панели. */
  note?: string;
};

export const MODULES = {
  shop: {
    title: "Магазин",
    group: "База",
    price: null,
    status: "available",
  },
  broadcasts: {
    title: "Рассылки",
    group: "База",
    price: null,
    status: "available",
  },
  legal_docs: {
    title: "Юридические страницы",
    group: "База",
    price: null,
    status: "available",
    note: "Пока не оформлено отдельным пунктом в прайсе — уточнить условия перед продажей как самостоятельного модуля.",
  },
  vip: {
    title: "VIP-подписки",
    group: "Каталог",
    price: 22000,
    status: "available",
  },
  multi_currency: {
    title: "Мультивалютность",
    group: "Каталог",
    price: 18000,
    status: "available",
  },
  blocked: {
    title: "Блокировка пользователей",
    group: "Сервис",
    price: 14000,
    status: "available",
  },
  instagram: {
    title: "Instagram-автоматизация",
    group: "Instagram",
    price: 22000,
    status: "available",
    note: "22 000 ₸ — цена «к вашему боту» из прайса (у клиента уже есть бот). Отдельным продуктом с нуля — 30 000 ₸.",
  },
  dm_shop: {
    title: "Магазин в директе",
    group: "Instagram",
    price: 16000,
    status: "available",
    requires: ["instagram"],
    note: "16 000 ₸ — цена «к вашему боту». Отдельным продуктом с нуля — 25 000 ₸.",
  },
  robokassa: {
    title: "Онлайн-эквайринг (RoboKassa)",
    group: "Оплата",
    price: 25000,
    status: "available",
  },
  receipt_ocr: {
    title: "Распознавание чека",
    group: "Оплата",
    price: 20000,
    status: "available",
  },
  courses: {
    title: "Курсы внутри магазина",
    group: "Каталог",
    price: 18000,
    status: "planned",
    note: "У Анастасии уже отмечен как купленный (bots.modules.courses=true) — код ждёт реализации.",
  },
  coupons: {
    title: "Скидки и промокоды",
    group: "Оплата",
    price: 20000,
    status: "planned",
  },
  referral: {
    title: "Реферальная программа",
    group: "Удержание",
    price: 14000,
    status: "planned",
  },
  // …остальное из прайса (Stars, апсейл, квиз, мультиязычность, лояльность,
  // автоворонка, helpdesk, дашборд, мини-CRM, роли, интеграции, склад…)
  // добавляется сюда же по мере готовности кода, не раньше.
} as const satisfies Record<string, ModuleDef>;

export type ModuleKey = keyof typeof MODULES;

export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

/**
 * `MODULES[key]` alone narrows to the exact literal shape of that one entry
 * (a side effect of `as const satisfies …`) — modules that never set
 * `requires`/`note` lose those optional properties from their type entirely
 * instead of typing them as `undefined`. Use this where code needs the full
 * ModuleDef shape uniformly.
 */
export function moduleDef(key: ModuleKey): ModuleDef {
  return MODULES[key];
}
