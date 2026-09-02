import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./admin-session.server";
import { fetchAll } from "./csv";
import { MATERIAL_LANGUAGES } from "./product-materials";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export const listProducts = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  // PostgREST молча обрывает на 1000 строках — 524 товара сегодня, но без
  // постраничного чтения каталог однажды исчезнет из админки наполовину
  // (Блок 3.3).
  return fetchAll(
    (from, to) =>
      s
        .from("products")
        .select(
          "*, product_images(id, image_path, sort_order), product_material_files(id, language, file_path, file_name, sort_order), product_variants(id, name, price, sort_order), categories(name)",
        )
        .order("created_at", { ascending: false })
        .range(from, to),
    "товары",
  );
});

export const getSignedUploadUrl = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ bucket: z.enum(["product-images", "product-files"]), filename: z.string() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const ext = (data.filename.split(".").pop() || "bin").toLowerCase().slice(0, 10);
    const { randomBytes } = await import("node:crypto");
    const botId = process.env.BOT_ID?.trim() || "unknown";
    const key = `${botId}/${randomBytes(16).toString("hex")}.${ext}`;
    const s = await db();
    const { data: signed, error } = await s.storage.from(data.bucket).createSignedUploadUrl(key);
    if (error || !signed) throw new Error(error?.message || "Error");
    return { path: key, name: data.filename, signedUrl: signed.signedUrl };
  });

export const getProduct = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { data: prod, error } = await s
      .from("products")
      .select(
        "*, product_images(id, image_path, sort_order), product_material_files(id, language, file_path, file_name, sort_order), product_variants(id, name, price, sort_order)",
      )
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return prod;
  });

const SaveInput = z.object({
  id: z.string().uuid().optional(),
  category_id: z.string().uuid().nullable().optional(), // kept for backwards compatibility during migration
  category_ids: z.array(z.string().uuid()).default([]),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).default(""),
  keywords: z.string().max(500).default(""),
  price: z.number().min(0),
  currency: z.string().min(1).max(8).default("KZT"),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
  file_path: z.string().nullable().optional(),
  file_name: z.string().nullable().optional(),
  file_path_kz: z.string().nullable().optional(),
  file_name_kz: z.string().nullable().optional(),
  file_url: z.string().nullable().optional(),
  file_url_kz: z.string().nullable().optional(),
  // Складской учёт (Кейс 4) — null = не отслеживается (безлимитно).
  stock_quantity: z.number().int().min(0).nullable().optional(),
  // Ниши (Блок 4) — digital выдаётся файлом, physical изготавливается
  // руками. Умолчание — из ниши деплоя (кондитерская → physical), а не
  // жёсткий digital: иначе товар без поля в форме становится «цифровым»
  // на кондитерском деплое и в списке орёт «нет файла».
  fulfillment_kind: z.enum(["digital", "physical"]).optional(),
  // lead_time_days: NULL/0 = есть в наличии, N = делается N дней (используется
  // чекаутом для минимальной даты получения).
  lead_time_days: z.number().int().min(0).nullable().optional(),
  image_paths: z.array(z.string()).default([]),
  // A material can be several files/photos (e.g. worksheet pages), not just
  // the single file_path/file_url above — those stay for older products that
  // predate multi-file support. Keyed by language (ru/kk/en/uz, see
  // product-materials.ts MATERIAL_LANGUAGES) — was a fixed ru/kz pair.
  material_files: z
    .object({
      ru: z.array(z.object({ file_path: z.string(), file_name: z.string().nullable().optional() })),
      kk: z.array(z.object({ file_path: z.string(), file_name: z.string().nullable().optional() })),
      en: z.array(z.object({ file_path: z.string(), file_name: z.string().nullable().optional() })),
      uz: z.array(z.object({ file_path: z.string(), file_name: z.string().nullable().optional() })),
    })
    .partial()
    .default({}),
  country_prices: z.record(z.number()).optional().default({}),
  // Ниши (Блок D) — простой список вариантов товара («1 кг» / «2 кг»),
  // заменяется целиком при сохранении, как image_paths/material_files.
  // Пустой массив = товар без вариантов, цена берётся из products.price,
  // как и раньше.
  // id — Блок 8, находка 8.1/8.2: присутствует у уже существующего
  // варианта (снят с формы при загрузке для редактирования), отсутствует
  // у только что добавленного в форме. Позволяет обновлять/добавлять/
  // удалять точечно вместо "снести всё и вставить заново".
  variants: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(120),
        price: z.number().min(0),
      }),
    )
    .default([]),
});

/**
 * Блок 8 — сознательно отложенные находки:
 *
 * 8.7 — сделано: lead_time_days для digital сбрасывается в null при
 * сохранении, чтобы переключение «торт → файл» не оставляло срок выпечки
 * на цифровом товаре.
 *
 * 8.8 — у вариантов нет ни своего остатка (stock_quantity), ни своего
 * срока изготовления (lead_time_days): "1 кг в наличии, 2 кг под заказ"
 * невыразимо. Требует новых колонок в product_variants (новая миграция) и
 * правок decrementStock/addToCart под учёт по варианту, а не по товару —
 * заметно шире одной точечной правки.
 *
 * 8.9 — выбор варианта в Direct (awaiting_variant_choice) диспетчеризуется
 * через matchZone (задуман для зон доставки) — работает структурно
 * идентично (числа/названия), но смешивает семантику двух разных сущностей
 * в одной функции. Переименование/выделение отдельной matchVariant —
 * рефакторинг без изменения поведения, не тронут в этом заходе.
 */
export const saveProduct = createServerFn({ method: "POST" })
  .validator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { currentVerticalDef } = await import("./verticals/vertical.server");
    const fulfillment_kind = data.fulfillment_kind ?? currentVerticalDef().defaultFulfillment;
    // Складской учёт (Кейс 4) — платный модуль, но сохраняем поле
    // безусловно: тот же приём, что уже у country_prices/kk-материалов в
    // этой же форме — продавец готовит данные заранее, а реальный эффект
    // (ограничение добавления в корзину и списание при оформлении) уже
    // гейтится в bot.server.ts на самом использовании, не здесь.
    const stock_quantity = data.stock_quantity ?? null;
    const lead_time_days = fulfillment_kind === "physical" ? (data.lead_time_days ?? null) : null;
    let productId = data.id;
    if (productId) {
      const { error } = await s
        .from("products")
        .update({
          category_id: data.category_ids[0] ?? null, // Sync the primary one just in case
          category_ids: data.category_ids,
          name: data.name,
          description: data.description,
          keywords: data.keywords,
          price: data.price,
          currency: data.currency,
          is_active: data.is_active,
          sort_order: data.sort_order,
          file_path: data.file_path ?? null,
          file_name: data.file_name ?? null,
          file_path_kz: data.file_path_kz ?? null,
          file_name_kz: data.file_name_kz ?? null,
          file_url: data.file_url ?? null,
          file_url_kz: data.file_url_kz ?? null,
          country_prices: data.country_prices,
          stock_quantity,
          fulfillment_kind,
          lead_time_days,
        })
        .eq("id", productId);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await s
        .from("products")
        .insert({
          category_id: data.category_ids[0] ?? null,
          category_ids: data.category_ids,
          name: data.name,
          description: data.description,
          keywords: data.keywords,
          price: data.price,
          currency: data.currency,
          is_active: data.is_active,
          sort_order: data.sort_order,
          file_path: data.file_path ?? null,
          file_name: data.file_name ?? null,
          file_path_kz: data.file_path_kz ?? null,
          file_name_kz: data.file_name_kz ?? null,
          file_url: data.file_url ?? null,
          file_url_kz: data.file_url_kz ?? null,
          country_prices: data.country_prices,
          stock_quantity,
          fulfillment_kind,
          lead_time_days,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      productId = inserted!.id as string;
    }
    // Replace images. Insert the new rows FIRST, delete the old ones only
    // after that succeeds — the old order (delete, unchecked, then insert)
    // meant an insert failure left the product live with no images and no
    // material files at all, and the uploaded file paths were already gone
    // from the DB by then (Блок 4.8).
    const { data: oldImages } = await s
      .from("product_images")
      .select("id")
      .eq("product_id", productId);
    if (data.image_paths.length) {
      const rows = data.image_paths.map((p, idx) => ({
        product_id: productId!,
        image_path: p,
        sort_order: idx,
      }));
      const { error } = await s.from("product_images").insert(rows);
      if (error) throw new Error(error.message);
    }
    if (oldImages?.length) {
      const { error } = await s
        .from("product_images")
        .delete()
        .in(
          "id",
          oldImages.map((r) => r.id),
        );
      if (error) throw new Error(error.message);
    }

    // Replace material files (the deliverable itself — can be one file or many photos)
    const { data: oldMaterials } = await s
      .from("product_material_files")
      .select("id")
      .eq("product_id", productId);
    const materialRows = MATERIAL_LANGUAGES.flatMap((lang) =>
      (data.material_files[lang] ?? []).map((f, idx) => ({
        product_id: productId!,
        language: lang,
        file_path: f.file_path,
        file_name: f.file_name ?? null,
        sort_order: idx,
      })),
    );
    if (materialRows.length) {
      const { error } = await s.from("product_material_files").insert(materialRows);
      if (error) throw new Error(error.message);
    }
    if (oldMaterials?.length) {
      const { error } = await s
        .from("product_material_files")
        .delete()
        .in(
          "id",
          oldMaterials.map((r) => r.id),
        );
      if (error) throw new Error(error.message);
    }

    // Точечное обновление вариантов (Блок 8, находка 8.1/8.2) — раньше все
    // варианты сносились и вставлялись заново при КАЖДОМ сохранении товара,
    // даже если правилась только опечатка в описании. cart_items/order_items,
    // ссылавшиеся на любой из них (не только правда удалённый), теряли
    // ссылку через ON DELETE SET NULL (MIGRATION-53) — покупатель с "2 кг" в
    // корзине молча откатывался на базовую products.price. Плюс сама схема
    // "вставить все новые, потом удалить все старые" могла на секунду
    // держать одновременно и старую, и новую версию строки того же варианта
    // — при двух строках корзины на разные варианты одного товара это
    // роняло уникальный индекс из MIGRATION-54.
    //
    // Теперь: вариант с id из формы (существовал и до правки) — UPDATE по
    // этому id, без каких-либо последствий для cart_items/order_items,
    // ссылающихся на него. Вариант без id — новая строка, INSERT. Старый
    // id, которого нет среди присланных — вариант реально удалён продавцом,
    // DELETE только по нему (ровно тот случай, для которого ON DELETE SET
    // NULL и существует).
    const { data: oldVariants } = await s
      .from("product_variants")
      .select("id")
      .eq("product_id", productId);
    const oldIds = new Set((oldVariants ?? []).map((r) => r.id as string));
    const keepIds = new Set<string>();
    for (let idx = 0; idx < data.variants.length; idx++) {
      const v = data.variants[idx];
      if (v.id && oldIds.has(v.id)) {
        keepIds.add(v.id);
        const { error } = await s
          .from("product_variants")
          .update({ name: v.name, price: v.price, sort_order: idx })
          .eq("id", v.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await s.from("product_variants").insert({
          product_id: productId!,
          name: v.name,
          price: v.price,
          sort_order: idx,
        });
        if (error) throw new Error(error.message);
      }
    }
    const removedIds = [...oldIds].filter((id) => !keepIds.has(id));
    if (removedIds.length) {
      const { error } = await s.from("product_variants").delete().in("id", removedIds);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const, id: productId };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { error } = await s.from("products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const listCategoriesForProducts = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data, error } = await s
    .from("categories")
    .select("id, name, parent_id, sort_order, is_visible")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
});
