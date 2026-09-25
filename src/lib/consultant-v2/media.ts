/**
 * Фото и видео товаров консультанта v2.
 *
 * Прайс консультанта приходит из 1С файлом, и номер позиции строится из
 * названия и номера строки: при каждой загрузке прайса он другой. Поэтому
 * медиа привязаны не к номеру, а к модели — части названия, как в прайсе
 * («Uchino Zero Twist»), и, если нужно, к цвету. Одно фото подходит всем
 * размерам модели и переживает обновление прайса.
 *
 * Файлы лежат в бакете product-images (как у магазинной ниши) и отдаются
 * через /api/public/img; список — в app_settings, ключ consultant_product_media_json.
 */
import type { ConsultantProduct } from "@/lib/consultant/catalog";

export const PRODUCT_MEDIA_KEY = "consultant_product_media_json";
export const MAX_MEDIA_PER_REPLY = 3;

export type ProductMediaKind = "image" | "video";

export type ProductMedia = {
  id: string;
  /** Часть названия из прайса: «Uchino Zero Twist», «Les Fleurs 70х140». */
  match: string;
  /** Цвет, если фото только одного цвета: «белый». */
  color?: string;
  /** Путь в бакете product-images. */
  path: string;
  kind: ProductMediaKind;
  /** Имя файла при загрузке — для панели. */
  name?: string;
  createdAt: string;
};

/** Сравнение без регистра, «ё», знаков и разницы «х»/«x» в размерах. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/(\d)\s*[xх×*]\s*(\d)/g, "$1x$2")
    .replace(/[^a-zа-я0-9x]+/g, " ")
    .trim();
}

/**
 * Все слова модели есть в названии позиции, в любом порядке: «Uchino Zero
 * Twist» находит «Uchino Полотенце махровое Zero Twist, 70x140». Цвет — среди
 * цветов позиции или в её названии.
 */
export function mediaMatchesProduct(media: ProductMedia, product: ConsultantProduct): boolean {
  const words = normalizeForMatch(media.match).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const name = new Set(normalizeForMatch(product.name).split(" "));
  if (!words.every((w) => name.has(w))) return false;
  if (!media.color?.trim()) return true;
  const color = normalizeForMatch(media.color);
  return normalizeForMatch(`${product.colors.join(" ")} ${product.name}`).includes(color);
}

/**
 * Медиа для позиции: сначала с совпавшим цветом (точнее), потом общие для
 * модели; фото раньше видео — их открывают быстрее.
 */
export function mediaForProduct(all: ProductMedia[], product: ConsultantProduct): ProductMedia[] {
  const matched = all.filter((m) => mediaMatchesProduct(m, product));
  return matched
    .sort(
      (a, b) =>
        Number(Boolean(b.color)) - Number(Boolean(a.color)) ||
        (a.kind === b.kind ? 0 : a.kind === "image" ? -1 : 1),
    )
    .slice(0, MAX_MEDIA_PER_REPLY);
}

export function parseProductMedia(raw: unknown): ProductMedia[] {
  try {
    const list = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (m): m is ProductMedia =>
        Boolean(m) &&
        typeof m === "object" &&
        typeof (m as ProductMedia).id === "string" &&
        typeof (m as ProductMedia).match === "string" &&
        typeof (m as ProductMedia).path === "string" &&
        ((m as ProductMedia).kind === "image" || (m as ProductMedia).kind === "video"),
    );
  } catch {
    return [];
  }
}

export async function loadProductMedia(): Promise<ProductMedia[]> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", PRODUCT_MEDIA_KEY)
    .maybeSingle();
  return parseProductMedia(data?.value);
}

export async function saveProductMedia(list: ProductMedia[]): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { error } = await supabaseAdmin.from("app_settings").upsert({
    key: PRODUCT_MEDIA_KEY,
    value: JSON.stringify(list),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/** Публичная ссылка на файл: её скачивают Instagram и Telegram. */
export function mediaUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}/api/public/img/${path}`;
}
