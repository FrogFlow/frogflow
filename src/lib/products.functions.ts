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
          "*, product_images(id, image_path, sort_order), product_material_files(id, language, file_path, file_name, sort_order), categories(name)",
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
        "*, product_images(id, image_path, sort_order), product_material_files(id, language, file_path, file_name, sort_order)",
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
});

export const saveProduct = createServerFn({ method: "POST" })
  .validator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    // Складской учёт (Кейс 4) — платный модуль, но сохраняем поле
    // безусловно: тот же приём, что уже у country_prices/kk-материалов в
    // этой же форме — продавец готовит данные заранее, а реальный эффект
    // (ограничение добавления в корзину и списание при оформлении) уже
    // гейтится в bot.server.ts на самом использовании, не здесь.
    const stock_quantity = data.stock_quantity ?? null;
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
