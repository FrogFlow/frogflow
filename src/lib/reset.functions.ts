import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "./admin-session.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

/**
 * The tenant this deployment belongs to. In a shared database "reset everything"
 * must mean "everything of MINE" — without this id we cannot tell the two apart,
 * so the reset refuses to run rather than risk wiping another client's shop.
 */
function requireBotId(): string {
  const id = process.env.BOT_ID?.trim();
  if (!id) {
    throw new Error(
      "BOT_ID не задан в переменных окружения. Сброс данных отменён: " +
        "без него невозможно отличить данные этого бота от данных других клиентов.",
    );
  }
  return id;
}

/**
 * Removes exactly the listed storage objects. Unlike walking a bucket, this
 * cannot reach files belonging to another tenant — the buckets are shared.
 */
async function removeFiles(bucket: string, paths: string[]) {
  if (paths.length === 0) return;
  const s = await db();
  // Storage caps how many objects a single remove() call accepts.
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await s.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) console.error(`[reset] failed removing from ${bucket}`, error);
  }
}

export const resetAllData = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const botId = requireBotId();
  const s = await db();

  // ── Collect this tenant's file paths BEFORE deleting the rows that name them.
  const [
    { data: products },
    { data: images },
    { data: orders },
    { data: materials },
    { data: settings },
  ] = await Promise.all([
    s.from("products").select("file_path, file_path_kz").eq("bot_id", botId),
    s.from("product_images").select("image_path").eq("bot_id", botId),
    s.from("orders").select("payment_proof_path").eq("bot_id", botId),
    s.from("product_material_files").select("file_path").eq("bot_id", botId),
    s.from("app_settings").select("key, value").eq("bot_id", botId),
  ]);

  const productFiles = [
    ...(products ?? []).flatMap((p: any) => [p.file_path, p.file_path_kz]),
    ...(materials ?? []).map((m: any) => m.file_path),
  ].filter(Boolean) as string[];

  const imageFiles = (images ?? []).map((i: any) => i.image_path).filter(Boolean) as string[];
  const proofFiles = (orders ?? [])
    .map((o: any) => o.payment_proof_path)
    .filter(Boolean) as string[];

  const settingValue = (key: string) =>
    (settings ?? []).find((r: any) => r.key === key)?.value?.trim() || null;
  const legalFiles = [settingValue("legal_offer_file"), settingValue("legal_privacy_file")].filter(
    Boolean,
  ) as string[];
  const videoFiles = [settingValue("instruction_video_path")].filter(Boolean) as string[];

  // ── Delete rows, tenant-scoped, children before parents (FK order).
  await s.from("order_items").delete().eq("bot_id", botId);
  await s.from("orders").delete().eq("bot_id", botId);
  await s.from("cart_items").delete().eq("bot_id", botId);
  await s.from("product_material_files").delete().eq("bot_id", botId);
  await s.from("product_images").delete().eq("bot_id", botId);
  await s.from("products").delete().eq("bot_id", botId);
  await s.from("categories").delete().eq("bot_id", botId);

  // Reset checkout state so flows start fresh, without touching other tenants.
  await s.from("bot_users").update({ state: {} }).eq("bot_id", botId);

  // ── Storage: only the paths gathered above.
  await removeFiles("product-files", productFiles);
  await removeFiles("product-images", imageFiles);
  await removeFiles("payment-proofs", proofFiles);
  await removeFiles("legal-docs", legalFiles);
  await removeFiles("instruction-videos", videoFiles);

  // NOTE: the orders id sequence is intentionally NOT reset. It is shared by
  // every tenant in this database, so rewinding it would hand out ids that
  // another client's orders already occupy.

  return { ok: true as const };
});
