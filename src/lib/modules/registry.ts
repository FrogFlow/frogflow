/**
 * Единственный источник списка модулей — для гардов в коде, тумблеров в панели
 * оператора и будущей витрины модулей в клиентской админке. Второго списка
 * ключей не заводить нигде: миграции, панель и код читают этот файл.
 *
 * Здесь перечислены ВСЕ позиции из «ПРАЙС-ЛИСТ · 2026» (v8), а не только
 * готовые. Это сделано намеренно: панель показывает полный каталог того, что
 * продаётся, и честно отделяет готовое от непроданного кода.
 *
 * `status` — единственное, что решает, можно ли включить модуль клиенту:
 *   available — код есть и проверен, тумблер работает;
 *   planned   — позиция есть в прайсе, кода нет. В панели серым, включить
 *               нельзя. Продать можно, но сначала надо реализовать.
 * Ставить "available" разрешено ТОЛЬКО вместе с рабочим кодом за флагом.
 *
 * Цены — разовое подключение из прайса. Где в прайсе есть отдельная цена
 * «к вашему боту» (модуль к уже готовому боту, а не продукт с нуля), берётся
 * она: у всех текущих клиентов бот уже есть.
 */

export type ModuleDef = {
  /** Как показывать в панели / витрине. */
  title: string;
  /** Группировка — совпадает с разделами прайса. */
  group: string;
  /** Разовая стоимость подключения, ₸; null — входит в базовый пакет. */
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
  // ── База: «05 Базовые возможности», входят в каждый продукт без доплаты ──
  shop: {
    title: "Магазин",
    group: "База",
    price: null,
    status: "available",
  },
  broadcasts: {
    title: "Рассылки по базе",
    group: "База",
    price: null,
    status: "available",
  },
  multi_files: {
    title: "Материалы из нескольких файлов",
    group: "База",
    price: null,
    status: "available",
  },
  order_status: {
    title: "«Где мой заказ»",
    group: "База",
    price: null,
    status: "available",
    note: "Кнопка «📋 Мои заказы» в главном меню бота: статус и состав каждого заказа.",
  },
  excel_export: {
    title: "Выгрузка в Excel",
    group: "База",
    price: null,
    status: "available",
    note: "Админка → Заказы: выгрузка заказов за период и клиентской базы. CSV с BOM и разделителем «;» — открывается двойным щелчком в Excel.",
  },
  legal_docs: {
    title: "Юридические страницы",
    group: "База",
    price: null,
    status: "available",
    note: "Отдельным пунктом в прайсе не заведено — уточнить условия, если продавать как модуль.",
  },

  // ── Оплата: «Приём оплаты и продажи» ──
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
  telegram_stars: {
    title: "Оплата Telegram Stars",
    group: "Оплата",
    price: 17000,
    status: "planned",
  },
  coupons: {
    title: "Скидки и промокоды",
    group: "Оплата",
    price: 20000,
    status: "planned",
  },
  upsell: {
    title: "Апсейл и кросс-сейл",
    group: "Оплата",
    price: 12000,
    status: "planned",
  },
  quiz: {
    title: "Квиз-подбор",
    group: "Оплата",
    price: 12000,
    status: "planned",
  },

  // ── Каталог: «Каталог и материалы» ──
  multi_currency: {
    title: "Мультивалютность",
    group: "Каталог",
    price: 18000,
    status: "available",
  },
  multi_language: {
    title: "Мультиязычность",
    group: "Каталог",
    price: 16000,
    status: "available",
    note: "Русский/казахский интерфейс и отдельные версии материалов (file_url_kz, material_files_kz).",
  },
  vip: {
    title: "VIP-подписки",
    group: "Каталог",
    price: 22000,
    status: "available",
  },
  blocked: {
    title: "Блокировка пользователей",
    group: "Каталог",
    price: 14000,
    status: "available",
  },
  courses: {
    title: "Курсы внутри магазина",
    group: "Каталог",
    price: 18000,
    status: "planned",
    note: "Кода курсов в репозитории нет. Отдельный продукт «Бот „Курсы“» (42 000 ₸) — это другая позиция прайса, не этот модуль.",
  },

  // ── Instagram: «04 Instagram» ──
  instagram: {
    title: "Instagram-автоматизация",
    group: "Instagram",
    price: 22000,
    status: "available",
    note: "22 000 ₸ — цена «к вашему боту». Отдельным продуктом с нуля — 30 000 ₸.",
  },
  dm_shop: {
    title: "Магазин в директе",
    group: "Instagram",
    price: 16000,
    status: "available",
    requires: ["instagram"],
    note: "16 000 ₸ — цена «к вашему боту». Отдельным продуктом с нуля — 25 000 ₸.",
  },

  // ── Удержание: «Повторные продажи и удержание» ──
  winback: {
    title: "Возвратные продажи",
    group: "Удержание",
    price: 24000,
    status: "planned",
    note: "Объединённый модуль: сегменты базы, брошенная корзина, напоминание о повторной покупке, серия писем.",
  },
  funnel: {
    title: "Автоворонка",
    group: "Удержание",
    price: 21000,
    status: "planned",
  },
  loyalty: {
    title: "Программа лояльности",
    group: "Удержание",
    price: 14000,
    status: "planned",
  },
  referral: {
    title: "Реферальная программа",
    group: "Удержание",
    price: 14000,
    status: "planned",
  },

  // ── Сервис: «Клиентский сервис» ──
  manager_chat: {
    title: "Чат с менеджером",
    group: "Сервис",
    price: 14000,
    status: "available",
    note: "Автоответы бота логируются только начиная с включения модуля — истории до этого момента нет.",
  },
  helpdesk: {
    title: "Мини-helpdesk",
    group: "Сервис",
    price: 22000,
    status: "planned",
  },
  review_request: {
    title: "Оценка после покупки",
    group: "Сервис",
    price: 7000,
    status: "planned",
  },
  notify_in_bot: {
    title: "Дублирование уведомлений",
    group: "Сервис",
    price: 9000,
    status: "planned",
  },

  // ── Аналитика: «Аналитика и управление» ──
  dashboard: {
    title: "Дашборд с графиками",
    group: "Аналитика",
    price: 17000,
    status: "planned",
    note: "Компонент графиков (components-ui/chart.tsx) в проекте есть, но ни на одном экране не используется.",
  },
  crm_pipeline: {
    title: "Мини-CRM воронка",
    group: "Аналитика",
    price: 14000,
    status: "planned",
  },
  admin_roles: {
    title: "Мультиадминство с ролями",
    group: "Аналитика",
    price: 14000,
    status: "planned",
    note: "Сейчас в настройках зашит список из двух Telegram ID для уведомлений — это не роли и не разграничение доступа.",
  },
  crm_integration: {
    title: "Интеграция с CRM и Таблицами",
    group: "Аналитика",
    price: 12000,
    status: "planned",
  },
  multi_bot: {
    title: "Управление несколькими ботами",
    group: "Аналитика",
    price: 23000,
    status: "planned",
  },

  // ── Физические товары ──
  stock: {
    title: "Складской учёт",
    group: "Физические товары",
    price: 12000,
    status: "planned",
    note: "quantity в корзине считает только цену, остатков на складе нет.",
  },
  limited_offers: {
    title: "Ограниченные предложения",
    group: "Физические товары",
    price: 7000,
    status: "planned",
  },
  waitlist: {
    title: "Лист ожидания",
    group: "Физические товары",
    price: 9000,
    status: "planned",
  },
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
