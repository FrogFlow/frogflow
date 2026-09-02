/**
 * Файлы материала — в одном виде для всех, кто их снимает в заказ.
 *
 * Появилось после разбора заказа №484 из Instagram. Покупательница выбрала
 * «376. Оформление на 1 сентября», оплатила 1000 ₸, прислала чек и адрес почты;
 * продавец подтвердил заказ — и выдача упала с «у товаров в заказе не приложены
 * файлы». Файл у товара был, но лежал в product_material_files (модуль
 * multi_files), а снимок заказа из Direct копировал только старые одиночные
 * поля file_path/file_url. Telegram-бот при этом снимал и то, и другое: две
 * копии одной логики разошлись, как и должны были.
 *
 * Таких товаров в живом каталоге 21 из 493 — то есть каждый двадцать третий
 * заказ из Direct заканчивался бы оплатой без выдачи. Поэтому логика одна и
 * лежит отдельно: она чистая, проверяется тестом и переиспользуется оба раза.
 *
 * Языки — те же 4 кода, что и Locale бота (ru/kk/en/uz, см. i18n.ts): раньше
 * здесь были только "ru"/"kz" под старую пару полей на products, теперь любой
 * язык материала идёт через product_material_files, а старые одиночные поля
 * остаются лишь как самый первый, дораспознанный запасной путь для ru/kk
 * (историческая пара, которую они и обслуживали изначально).
 */

import { isLocale, type Locale } from "./i18n";

export type MaterialSnapshot = {
  path: string | null;
  name: string | null;
  url: string | null;
};

type ProductWithFiles = {
  file_path?: string | null;
  file_name?: string | null;
  file_url?: string | null;
  file_path_kz?: string | null;
  file_name_kz?: string | null;
  file_url_kz?: string | null;
  product_material_files?: Array<{
    language?: string | null;
    file_path?: string | null;
    file_name?: string | null;
    sort_order?: number | null;
  }> | null;
};

/**
 * Колонки, без которых снимок получится неполным.
 *
 * Список приходится повторять в каждом `select` дословно: типы supabase-js
 * выводятся из строки-литерала, и подстановка константы превращает результат
 * запроса в ParserError. Поэтому здесь он только для справки — при правке
 * не забудьте все места (bot.server.ts placeOrder, direct-purchase.server.ts
 * createOrderFromCart, orders.server.ts collectOrderFiles):
 *
 *   file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz,
 *   product_material_files(language, file_path, file_name, sort_order)
 */

/** Языки материалов — те же 4 кода, что у Locale бота. Порядок — как в UI. */
export const MATERIAL_LANGUAGES: readonly Locale[] = ["ru", "kk", "en", "uz"];

/** Короткие коды на витрине: kk показываем как KZ — так ищут учителя. */
export const MATERIAL_LANG_SHORT: Record<Locale, string> = {
  ru: "RU",
  kk: "KZ",
  en: "EN",
  uz: "UZ",
};

/**
 * Файлы материала на нужном языке.
 *
 * Порядок важен: сначала product_material_files (там их может быть несколько и
 * с заданной сортировкой), и только если их нет — старые одиночные поля (есть
 * только для ru и kk — у en/uz такой пары никогда не было).
 */
export function materialsForProduct(
  product: ProductWithFiles | null | undefined,
  lang: Locale,
): MaterialSnapshot[] {
  const rows = (product?.product_material_files ?? [])
    .filter((file) => (file.language ?? "ru") === lang && file.file_path)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((file) => ({
      path: file.file_path ?? null,
      name: file.file_name ?? null,
      url: null,
    }));
  if (rows.length) return rows;

  if (lang === "ru") {
    if (product?.file_url) return [{ path: null, name: null, url: product.file_url }];
    if (product?.file_path) {
      return [{ path: product.file_path, name: product.file_name ?? null, url: null }];
    }
  }
  if (lang === "kk") {
    if (product?.file_url_kz) return [{ path: null, name: null, url: product.file_url_kz }];
    if (product?.file_path_kz) {
      return [{ path: product.file_path_kz, name: product.file_name_kz ?? null, url: null }];
    }
  }
  return [];
}

/** Есть ли вообще что выдавать — та же проверка, что и у снимка. */
export function hasAnyMaterial(product: ProductWithFiles | null | undefined): boolean {
  return MATERIAL_LANGUAGES.some((lang) => materialsForProduct(product, lang).length > 0);
}

/**
 * Какие языки реально доступны для этого товара — нужен и для снимка заказа
 * (сохранить все имеющиеся, а не только ru/kk), и для выбора языка при
 * выдаче/оформлении (показать кнопку только на то, что действительно есть).
 */
export function availableMaterialLanguages(product: ProductWithFiles | null | undefined): Locale[] {
  return MATERIAL_LANGUAGES.filter((lang) => materialsForProduct(product, lang).length > 0);
}

// Заказы, оформленные до multi-file материалов, хранят только одиночные
// *_snapshot-колонки — заворачиваем их в тот же вид массива, которым
// пользуется остальная выдача.
export function legacyAsMaterials(
  path?: string | null,
  name?: string | null,
  url?: string | null,
): MaterialSnapshot[] {
  if (url) return [{ path: null, name: null, url }];
  if (path) return [{ path, name: name ?? null, url: null }];
  return [];
}

type OrderItemWithMaterials = {
  material_files_by_lang?: Record<string, MaterialSnapshot[]> | null;
  material_files_snapshot?: MaterialSnapshot[] | null;
  material_files_kz_snapshot?: MaterialSnapshot[] | null;
  file_path_snapshot?: string | null;
  file_name_snapshot?: string | null;
  file_url_snapshot?: string | null;
  file_path_kz_snapshot?: string | null;
  file_name_kz_snapshot?: string | null;
  file_url_kz_snapshot?: string | null;
};

/**
 * Файлы снимка заказа на нужном языке.
 *
 * Порядок: новая колонка `material_files_by_lang` (пишется для всех заказов,
 * оформленных после MIGRATION-37) → старые ru/kk снимки (`material_files_snapshot`,
 * `material_files_kz_snapshot`) → совсем старые одиночные *_snapshot-колонки —
 * ровно тот же трёхступенчатый откат, что уже был у ru/kz до появления языков
 * en/uz, просто оформленный в одну функцию для переиспользования при выдаче.
 */
export function materialsForOrderItem(
  item: OrderItemWithMaterials | null | undefined,
  lang: Locale,
): MaterialSnapshot[] {
  const fromMap = item?.material_files_by_lang?.[lang];
  if (fromMap?.length) return fromMap;

  if (lang === "ru") {
    if (item?.material_files_snapshot?.length) return item.material_files_snapshot;
    return legacyAsMaterials(
      item?.file_path_snapshot,
      item?.file_name_snapshot,
      item?.file_url_snapshot,
    );
  }
  if (lang === "kk") {
    if (item?.material_files_kz_snapshot?.length) return item.material_files_kz_snapshot;
    return legacyAsMaterials(
      item?.file_path_kz_snapshot,
      item?.file_name_kz_snapshot,
      item?.file_url_kz_snapshot,
    );
  }
  return [];
}

/** Какие языки реально есть в снимке этой позиции заказа. */
export function availableOrderItemLanguages(
  item: OrderItemWithMaterials | null | undefined,
): Locale[] {
  return MATERIAL_LANGUAGES.filter((lang) => materialsForOrderItem(item, lang).length > 0);
}

/**
 * Первый доступный язык снимка — для доставки без выбора языка (письмо,
 * WhatsApp вне диалога): там нет кнопок, а отправить что-то одно строго
 * лучше, чем ничего.
 */
export function materialsForOrderItemAnyLang(
  item: OrderItemWithMaterials | null | undefined,
): MaterialSnapshot[] {
  for (const lang of MATERIAL_LANGUAGES) {
    const materials = materialsForOrderItem(item, lang);
    if (materials.length > 0) return materials;
  }
  return [];
}

/**
 * Языки, уже отправленные покупателю через кнопку выбора языка при выдаче.
 *
 * Раньше в `delivered_language` хранилось "ru"/"kz"/"both" — годилось строго
 * на 2 языка. Теперь их до 4, и колонка хранит список кодов через запятую;
 * "both" остаётся как понятный старым заказам синоним «ru и kk».
 */
export function parseDeliveredLanguages(raw: string | null | undefined): Set<Locale> {
  if (!raw) return new Set();
  if (raw === "both") return new Set(["ru", "kk"]);
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(isLocale),
  );
}

/** Добавить язык к уже отправленным и вернуть новое значение колонки. */
export function addDeliveredLanguage(raw: string | null | undefined, lang: Locale): string {
  const set = parseDeliveredLanguages(raw);
  set.add(lang);
  return MATERIAL_LANGUAGES.filter((l) => set.has(l)).join(",");
}

/**
 * Выбор языка ДО оформления заказа (настройка `delivery_lang_timing` =
 * "before") — либо конкретный язык, либо «все доступные» (`"all"`),
 * который ставит цену позиции ×N по числу реально заведённых у товара
 * языков — как за N комплектов, а не один.
 */
export type DeliveryLangChoice = Locale | "all";

export function isDeliveryLangChoice(value: unknown): value is DeliveryLangChoice {
  return value === "all" || (typeof value === "string" && isLocale(value));
}

/**
 * Во сколько раз должна вырасти цена позиции для этого выбора.
 *
 * Только "all" умножает — и на число языков, которые у ЭТОГО товара
 * реально есть (`availableLangsCount`), а не на общее число языков в
 * системе: товар с одним языком не должен внезапно стоить 4x только
 * потому, что покупатель попросил «все».
 */
export function deliveryPriceMultiplier(
  choice: DeliveryLangChoice | null | undefined,
  availableLangsCount: number,
): number {
  if (choice !== "all") return 1;
  return Math.max(1, availableLangsCount);
}
