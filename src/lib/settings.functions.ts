import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./admin-session.server";
import { isOwnTenantStorageKey } from "./tenant-storage-key.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data, error } = await s.from("app_settings").select("*");
  if (error) throw new Error(error.message);
  const map: Record<string, string> = {};
  const { isAdminNotifySettingKey } = await import("./admin-order-notify");
  for (const r of data ?? []) {
    const key = r.key as string;
    if (isAdminNotifySettingKey(key)) continue;
    map[key] = (r.value as string) ?? "";
  }
  // Не хранится в app_settings — вычисляется на каждый запрос, как
  // getShopUrl/getMiniAppUrl/getAppTimeZone выше: панель включает "Умный
  // поиск" переключателем без единого сигнала о том, настроен ли на
  // деплое сам ANTHROPIC_API_KEY (isSmartSearchEnabled, smart-search.server.ts,
  // молча возвращает false без него) — продавец включал тумблер, видел
  // "Сохранено" и не понимал, почему поиск не работает (Учителя-HIGH).
  map.smart_search_api_key_configured = process.env.ANTHROPIC_API_KEY?.trim() ? "true" : "false";
  return map;
});

/**
 * Ссылка на публичную веб-витрину (Кейс 3, №8) — считается из адреса
 * деплоя (PUBLIC_APP_URL), не хранится в app_settings: это не настройка,
 * а производное значение, которое незачем держать в двух местах.
 */
export const getShopUrl = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { appOrigin } = await import("./app-origin.server");
  const origin = appOrigin();
  return { url: origin ? `${origin}/shop` : null };
});

export const getMiniAppUrl = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { hasModule } = await import("./modules/modules.server");
  if (!(await hasModule("telegram_mini_app"))) {
    return { url: null };
  }
  const { appOrigin } = await import("./app-origin.server");
  const { miniAppUrl } = await import("./mini-app.server");
  const origin = appOrigin();
  return { url: origin ? miniAppUrl(origin) : null };
});

/**
 * Часовой пояс магазина (APP_TIMEZONE, см. datetime.ts) — нужен клиенту
 * админки, чтобы считать "сегодня/завтра/просрочено" в фильтре заказов
 * (admin.orders.tsx) той же датой, что и сам чекаут (todayInAppTZ в
 * fulfillment.server.ts), а не датой UTC-сервера (Блок 6, находка 6.6):
 * с 00:00 до ~06:00 по Алматы UTC-дата всё ещё "вчера".
 */
export const getAppTimeZone = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { appTimeZone } = await import("./datetime");
  return { timeZone: appTimeZone() };
});

const SaveInput = z.object({ key: z.string().min(1).max(100), value: z.string().max(100_000) });

export const saveSetting = createServerFn({ method: "POST" })
  .validator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { error } = await s
      .from("app_settings")
      .upsert({ key: data.key, value: data.value, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const getLegalDocUploadUrl = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        kind: z.enum(["offer", "privacy"]),
        filename: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const ext = (data.filename.split(".").pop() || "pdf").toLowerCase().slice(0, 10);
    // legal-docs — бакет общий на все деплои (Storage не проходит через RLS);
    // префикс BOT_ID — та же изоляция, что у product-images/product-files/
    // broadcast-images (см. tenant-storage-key.server.ts).
    const botId = process.env.BOT_ID?.trim() || "unknown";
    const key = `${botId}/${data.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const s = await db();
    const { data: signed, error } = await s.storage.from("legal-docs").createSignedUploadUrl(key);
    if (error || !signed) throw new Error(error?.message || "Upload error");
    return { path: key, signedUrl: signed.signedUrl, filename: data.filename };
  });

/** After PUT to signed URL: swap DB path, clear HTML fallback, delete previous file. */
export const commitLegalDocFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        kind: z.enum(["offer", "privacy"]),
        path: z.string().min(1),
        filename: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    // legal-docs — общий бакет; без этой проверки арендатор мог передать
    // чужой (чужого bot_id) path — он бы сохранился как свой указатель и
    // при следующей загрузке удалился бы вместо настоящего старого файла
    // этого клиента (см. remove(oldPath) ниже).
    if (!isOwnTenantStorageKey(data.path)) {
      throw new Error("Invalid path");
    }
    const s = await db();
    const pathKey = data.kind === "offer" ? "legal_offer_file" : "legal_privacy_file";
    const nameKey = data.kind === "offer" ? "legal_offer_filename" : "legal_privacy_filename";
    const htmlKey = data.kind === "offer" ? "legal_offer_html" : "legal_privacy_html";

    const { data: row } = await s
      .from("app_settings")
      .select("value")
      .eq("key", pathKey)
      .maybeSingle();
    const oldPath = (row?.value as string | undefined)?.trim() || "";

    const now = new Date().toISOString();
    const { error } = await s.from("app_settings").upsert([
      { key: pathKey, value: data.path, updated_at: now },
      { key: nameKey, value: data.filename, updated_at: now },
      // Старый HTML-фолбэк иначе снова показывается после «Удалить»
      { key: htmlKey, value: "", updated_at: now },
    ]);
    if (error) throw new Error(error.message);

    if (oldPath && oldPath !== data.path) {
      const rem = await s.storage.from("legal-docs").remove([oldPath]);
      if (rem.error) console.warn("[settings] remove old legal doc", rem.error.message);
    }
    return { ok: true as const, path: data.path };
  });

export const clearLegalDocFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ kind: z.enum(["offer", "privacy"]) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const pathKey = data.kind === "offer" ? "legal_offer_file" : "legal_privacy_file";
    const nameKey = data.kind === "offer" ? "legal_offer_filename" : "legal_privacy_filename";
    const htmlKey = data.kind === "offer" ? "legal_offer_html" : "legal_privacy_html";
    const { data: row } = await s
      .from("app_settings")
      .select("value")
      .eq("key", pathKey)
      .maybeSingle();
    const path = (row?.value as string | undefined)?.trim();
    if (path) {
      await s.storage.from("legal-docs").remove([path]);
    }
    const now = new Date().toISOString();
    await s.from("app_settings").upsert([
      { key: pathKey, value: "", updated_at: now },
      { key: nameKey, value: "", updated_at: now },
      { key: htmlKey, value: "", updated_at: now },
    ]);
    return { ok: true as const };
  });

export const getInstructionVideoUploadUrl = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ filename: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const ext = (data.filename.split(".").pop() || "mp4").toLowerCase().slice(0, 10);
    const botId = process.env.BOT_ID?.trim() || "unknown";
    const key = `${botId}/instruction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const s = await db();
    try {
      const { data: buckets } = await s.storage.listBuckets();
      if (!buckets?.some((b) => b.name === "instruction-videos")) {
        await s.storage.createBucket("instruction-videos", {
          public: true,
          fileSizeLimit: 50 * 1024 * 1024,
        });
      }
    } catch (e) {
      console.warn("[settings] ensure instruction-videos bucket", e);
    }
    const { data: signed, error } = await s.storage
      .from("instruction-videos")
      .createSignedUploadUrl(key);
    if (error || !signed) throw new Error(error?.message || "Upload error");
    return { path: key, signedUrl: signed.signedUrl, filename: data.filename };
  });

export const commitInstructionVideoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ path: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    // Same cross-tenant path-confusion risk as commitLegalDocFn above.
    if (!isOwnTenantStorageKey(data.path)) {
      throw new Error("Invalid path");
    }
    const s = await db();
    const { data: row } = await s
      .from("app_settings")
      .select("value")
      .eq("key", "instruction_video_path")
      .maybeSingle();
    const oldPath = (row?.value as string | undefined)?.trim() || "";
    const now = new Date().toISOString();
    const { error } = await s.from("app_settings").upsert([
      { key: "instruction_video_path", value: data.path, updated_at: now },
      { key: "instruction_video_file_id", value: "", updated_at: now },
    ]);
    if (error) throw new Error(error.message);
    if (oldPath && oldPath !== data.path) {
      await s.storage.from("instruction-videos").remove([oldPath]);
    }
    return { ok: true as const };
  });

export const clearInstructionVideoFn = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data: row } = await s
    .from("app_settings")
    .select("value")
    .eq("key", "instruction_video_path")
    .maybeSingle();
  const path = (row?.value as string | undefined)?.trim();
  if (path) await s.storage.from("instruction-videos").remove([path]);
  const now = new Date().toISOString();
  await s.from("app_settings").upsert([
    { key: "instruction_video_path", value: "", updated_at: now },
    { key: "instruction_video_file_id", value: "", updated_at: now },
  ]);
  return { ok: true as const };
});
