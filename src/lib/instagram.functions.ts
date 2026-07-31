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
        accountId: z.string().min(1, "Укажите accountId"),
        profileId: z.any().optional(),
        name: z.string().min(1, "Укажите название"),
        keywords: z.array(z.string()).default([]),
        matchMode: z.enum(["exact", "contains"]).default("contains"),
        dmMessage: z.string().min(1, "Укажите DM сообщение"),
        commentReply: z.string().default(""),
        platformPostId: z.string().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { createCommentAutomation, ensureDefaultZernioProfile } = await import("./zernio.server");
    await requireAdmin();
    
    let profileId = typeof data.profileId === "string" ? data.profileId : "";
    if (!profileId) {
      const defaultProfile = await ensureDefaultZernioProfile();
      profileId = defaultProfile._id;
    }

    return await createCommentAutomation({
      ...data,
      profileId,
    });
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
