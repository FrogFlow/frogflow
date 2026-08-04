import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export const getInstagramConnectUrlFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  const { getZernioConnectUrl } = await import("./zernio.server");
  await requireAdmin();

  const origin =
    process.env.PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "https://tg-bot-ashen-one.vercel.app";

  const redirectUrl = `${origin.replace(/\/$/, "")}/admin/instagram?connected=1`;
  return await getZernioConnectUrl("instagram", undefined, redirectUrl);
});

export const getInstagramAccountsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  const { listZernioAccounts } = await import("./zernio.server");
  await requireAdmin();
  const accounts = await listZernioAccounts();
  return { accounts };
});

export const registerInstagramWebhookFn = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  const { registerZernioWebhook } = await import("./zernio.server");
  await requireAdmin();

  const origin =
    process.env.PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "https://tg-bot-ashen-one.vercel.app";

  const webhookUrl = `${origin.replace(/\/$/, "")}/api/public/zernio/webhook`;
  return await registerZernioWebhook(webhookUrl);
});

// ─── Automations via Zernio API ───────────────────────────────────────────────

/**
 * Получить список Comment-to-DM автоматизаций напрямую из Zernio
 */
export const getAutomationsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  const { listCommentAutomations } = await import("./zernio.server");
  await requireAdmin();
  return await listCommentAutomations();
});

/**
 * Создать Comment-to-DM автоматизацию через Zernio API
 */
export const saveAutomationFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().optional(),
        accountId: z.string().min(1, "Укажите accountId"),
        profileId: z.any().optional(),
        name: z.string().min(1, "Укажите название"),
        keywords: z.array(z.string()).default([]),
        matchMode: z.enum(["exact", "contains"]).default("contains"),
        dmMessage: z.string().default(""),
        commentReply: z.string().default(""),
        trigger: z.enum(["comment", "story_reply"]).default("comment"),
        platformPostId: z.string().optional().nullable(),
        postId: z.string().optional().nullable(),
        postTitle: z.string().max(500).optional(),
        dmMediaPath: z.string().optional().nullable(),
        dmMediaType: z.enum(["image", "video", "audio"]).optional().nullable(),
        buttons: z.array(z.object({ type: z.enum(["url", "postback", "phone"]), title: z.string().min(1), url: z.string().optional(), payload: z.string().optional(), phone: z.string().optional() })).max(3).optional(),
        dmMessageVariations: z.array(z.string()).max(5).optional(),
        commentReplyVariations: z.array(z.string()).max(5).optional(),
        linkTracking: z.boolean().optional(), clickTag: z.string().max(100).optional(), isActive: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { createCommentAutomation, updateCommentAutomation, ensureDefaultZernioProfile } = await import("./zernio.server");
    await requireAdmin();
    if (data.platformPostId && data.platformPostId === data.accountId) {
      throw new Error("Выбран ID аккаунта вместо ID публикации. Обновите список и выберите пост заново.");
    }
    
    let profileId = typeof data.profileId === "string" ? data.profileId : "";
    if (!profileId) {
      const defaultProfile = await ensureDefaultZernioProfile();
      profileId = defaultProfile._id;
    }

    const automation = {
      ...data,
      profileId,
      dmMediaPath: data.dmMediaPath || null,
      dmMediaType: data.dmMediaType || null,
    };
    return data.id
      ? await updateCommentAutomation(data.id, automation)
      : await createCommentAutomation(automation);
  });

/**
 * Удалить автоматизацию через Zernio API
 */
export const deleteAutomationFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { deleteCommentAutomation } = await import("./zernio.server");
    await requireAdmin();
    return await deleteCommentAutomation(data.id);
  });

/**
 * Включить/выключить автоматизацию через Zernio API
 */
export const toggleAutomationFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.string(), isActive: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { updateCommentAutomation } = await import("./zernio.server");
    await requireAdmin();
    return await updateCommentAutomation(data.id, { isActive: data.isActive });
  });

/**
 * Получить логи конкретной автоматизации из Zernio API
 */
export const getAutomationLogsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { getCommentAutomationLogs } = await import("./zernio.server");
    await requireAdmin();
    return await getCommentAutomationLogs(data.id);
  });

// ─── Webhook logs (наша БД) ───────────────────────────────────────────────────

export const getInstagramLogsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();

  const s = await db();
  const { data, error } = await s
    .from("zernio_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("[instagram.functions] getInstagramLogs error:", error);
    return { logs: [] };
  }

  return { logs: data || [] };
});

/**
 * Сгенерировать signed upload URL для медиа-вложения в Instagram DM
 */
export const getInstagramMediaUploadUrlFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ filename: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const ext = (data.filename.split(".").pop() || "jpg").toLowerCase().slice(0, 10);
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("instagram-media")
      .createSignedUploadUrl(key);
    if (error || !signed) throw new Error(error?.message || "Upload error");
    return { path: key, signedUrl: signed.signedUrl };
  });

export const disconnectInstagramAccountFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ accountId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { disconnectZernioAccount } = await import("./zernio.server");
    await requireAdmin();
    return await disconnectZernioAccount(data.accountId);
  });

export const getZernioPostsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ accountId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { listZernioPosts } = await import("./zernio.server");
    await requireAdmin();
    const posts = await listZernioPosts(data.accountId);
    return { posts };
  });
