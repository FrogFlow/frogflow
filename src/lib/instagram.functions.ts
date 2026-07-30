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

export const getAutomationsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();

  const s = await db();
  const { data, error } = await s
    .from("zernio_automations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[instagram.functions] getAutomations error:", error);
    return { automations: [] };
  }

  return { automations: data || [] };
});

export const saveAutomationFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        title: z.string().min(1, "Укажите название"),
        keywords: z.array(z.string()).default([]),
        reply_text: z.string().default(""),
        dm_text: z.string().default(""),
        post_id: z.string().optional().nullable(),
        is_active: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();

    const s = await db();
    if (data.id) {
      const { error } = await s
        .from("zernio_automations")
        .update({
          title: data.title,
          keywords: data.keywords,
          reply_text: data.reply_text,
          dm_text: data.dm_text,
          post_id: data.post_id || null,
          is_active: data.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id);

      if (error) throw new Error(error.message);
      return { ok: true };
    }

    const { error } = await s.from("zernio_automations").insert({
      title: data.title,
      keywords: data.keywords,
      reply_text: data.reply_text,
      dm_text: data.dm_text,
      post_id: data.post_id || null,
      is_active: data.is_active,
    });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAutomationFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();

    const s = await db();
    const { error } = await s.from("zernio_automations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getInstagramLogsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();

  const s = await db();
  const { data, error } = await s
    .from("zernio_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[instagram.functions] getInstagramLogs error:", error);
    return { logs: [] };
  }

  return { logs: data || [] };
});
