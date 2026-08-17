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
 */

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
 * не забудьте оба места (bot.server.ts placeOrder и direct-purchase.server.ts
 * createOrderFromCart, productHasFiles):
 *
 *   file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz,
 *   product_material_files(language, file_path, file_name, sort_order)
 */

/**
 * Файлы материала на нужном языке.
 *
 * Порядок важен: сначала product_material_files (там их может быть несколько и
 * с заданной сортировкой), и только если их нет — старые одиночные поля.
 */
export function materialsForProduct(
  product: ProductWithFiles | null | undefined,
  lang: "ru" | "kz",
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

  const url = lang === "ru" ? product?.file_url : product?.file_url_kz;
  const path = lang === "ru" ? product?.file_path : product?.file_path_kz;
  const name = lang === "ru" ? product?.file_name : product?.file_name_kz;
  if (url) return [{ path: null, name: null, url }];
  if (path) return [{ path, name: name ?? null, url: null }];
  return [];
}

/** Есть ли вообще что выдавать — та же проверка, что и у снимка. */
export function hasAnyMaterial(product: ProductWithFiles | null | undefined): boolean {
  return materialsForProduct(product, "ru").length > 0 || materialsForProduct(product, "kz").length > 0;
}
