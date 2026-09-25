/**
 * Панель: фото и видео товаров консультанта v2 (media.ts).
 *
 * Только для ниши v2: у первой версии бот фото не отправляет, и вкладка ей не
 * нужна. Файл загружается браузером прямо в хранилище по подписанной ссылке
 * (getSignedUploadUrl из products.functions — видео больше предела запроса
 * Vercel), сюда приходит только путь.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-session.server";

async function isV2(): Promise<boolean> {
  const { currentVertical } = await import("@/lib/verticals/vertical.server");
  const { isBoviConsultantV2Vertical } = await import("@/lib/verticals/registry");
  return isBoviConsultantV2Vertical(currentVertical());
}

export const listProductMediaFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  if (!(await isV2())) return { enabled: false as const, items: [], withoutMedia: [] as string[] };
  const { loadProductMedia, mediaMatchesProduct } = await import("./media");
  const { loadConsultantCatalog } = await import("@/lib/consultant/catalog");
  const [items, catalog] = await Promise.all([loadProductMedia(), loadConsultantCatalog()]);
  // Модели без фото — чтобы было видно, что ещё загрузить. Модель — название
  // до размера: у одной модели по пять–десять строк прайса.
  const models = new Map<string, boolean>();
  for (const p of catalog) {
    const model = p.name
      .replace(/[\s,]*\d{2,3}\s*[xх×*]\s*\d{2,3}.*$/i, "")
      .replace(/,?\s*цвет.*$/i, "")
      .trim();
    if (!model) continue;
    const covered = items.some((m) => mediaMatchesProduct(m, p));
    models.set(model, (models.get(model) ?? false) || covered);
  }
  return {
    enabled: true as const,
    items: items.map((m) => ({
      ...m,
      url: `/api/public/img/${m.path}`,
      matches: catalog.filter((p) => mediaMatchesProduct(m, p)).length,
    })),
    withoutMedia: [...models]
      .filter(([, covered]) => !covered)
      .map(([model]) => model)
      .slice(0, 300),
  };
});

export const previewProductMediaMatchFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ match: z.string().max(120), color: z.string().max(40).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const { mediaMatchesProduct } = await import("./media");
    const { loadConsultantCatalog } = await import("@/lib/consultant/catalog");
    const catalog = await loadConsultantCatalog();
    const probe = {
      id: "",
      match: data.match,
      color: data.color,
      path: "",
      kind: "image" as const,
      createdAt: "",
    };
    const found =
      data.match.trim().length >= 3 ? catalog.filter((p) => mediaMatchesProduct(probe, p)) : [];
    return { count: found.length, sample: found.slice(0, 8).map((p) => p.name) };
  });

export const addProductMediaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        match: z.string().min(3).max(120),
        color: z.string().max(40).optional(),
        path: z.string().min(1).max(200),
        kind: z.enum(["image", "video"]),
        name: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    if (!(await isV2())) throw new Error("Фото товаров — только для консультанта v2");
    // Путь выдан getSignedUploadUrl этого же магазина: чужой файл не прицепить.
    const botId = process.env.BOT_ID?.trim() || "";
    if (!botId || !data.path.startsWith(`${botId}/`))
      throw new Error("Файл загружен не из этой панели");
    const { loadProductMedia, saveProductMedia } = await import("./media");
    const { randomBytes } = await import("node:crypto");
    const list = await loadProductMedia();
    const item = {
      id: randomBytes(8).toString("hex"),
      match: data.match.trim(),
      ...(data.color?.trim() ? { color: data.color.trim() } : {}),
      path: data.path,
      kind: data.kind,
      ...(data.name ? { name: data.name } : {}),
      createdAt: new Date().toISOString(),
    };
    await saveProductMedia([...list, item]);
    return item;
  });

export const removeProductMediaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { loadProductMedia, saveProductMedia } = await import("./media");
    const list = await loadProductMedia();
    const gone = list.find((m) => m.id === data.id);
    await saveProductMedia(list.filter((m) => m.id !== data.id));
    if (gone) {
      const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
      await supabaseAdmin.storage
        .from("product-images")
        .remove([gone.path])
        .catch(() => {});
    }
    return { ok: true };
  });
