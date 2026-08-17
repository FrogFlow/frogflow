import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppOrigin } from "./app-origin.server";

/**
 * Раздел платный: мало быть админом своего бота — модуль должен быть
 * подключён. Без второй проверки тумблер в панели оператора прячет только
 * пункт меню, а серверную функцию по-прежнему можно вызвать напрямую.
 */
async function requireAdminWithModule() {
  const { requireAdmin } = await import("./admin-session.server");
  const { requireModule } = await import("./modules/require-module.server");
  await requireAdmin();
  await requireModule("instagram");
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

function requireBotId() {
  const botId = process.env.BOT_ID?.trim();
  if (!botId) throw new Error("BOT_ID is required for Instagram settings");
  return botId;
}

export const getInstagramConnectUrlFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getZernioConnectUrl } = await import("./zernio.server");
  await requireAdminWithModule();

  const origin = requireAppOrigin();

  const redirectUrl = `${origin.replace(/\/$/, "")}/admin/instagram?connected=1`;
  return await getZernioConnectUrl("instagram", undefined, redirectUrl);
});

export const getInstagramAccountsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listZernioAccounts } = await import("./zernio.server");
  await requireAdminWithModule();
  const accounts = await listZernioAccounts();
  return { accounts };
});

export const getInstagramAccountHealthFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ accountId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { getZernioAccountHealth } = await import("./zernio.server");
    await requireAdminWithModule();
    return { health: await getZernioAccountHealth(data.accountId) };
  });

/** Settings for the in-app Direct assistant (separate from comment rules). */
export const getInstagramDirectBotSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminWithModule();
  const s = await db();
  const { data } = await s.from("app_settings").select("key, value").eq("bot_id", requireBotId()).eq("key", "instagram_direct_bot_enabled").maybeSingle();
  return { enabled: data?.value !== "false" };
});

export const saveInstagramDirectBotSettingsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdminWithModule();
    const s = await db();
    const { error } = await s
      .from("app_settings")
      .upsert({ bot_id: requireBotId(), key: "instagram_direct_bot_enabled", value: String(data.enabled), updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true, enabled: data.enabled };
  });

export const getInstagramDirectBotScriptFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminWithModule(); const s = await db();
  const { data } = await s.from("app_settings").select("value").eq("bot_id", requireBotId()).eq("key", "instagram_direct_bot_script").maybeSingle();
  return { text: data?.value || "" };
});

export const saveInstagramDirectBotScriptFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ text: z.string().trim().max(1500) }).parse(d))
  .handler(async ({ data }) => { await requireAdminWithModule(); const s = await db(); const { error } = await s.from("app_settings").upsert({ bot_id: requireBotId(), key: "instagram_direct_bot_script", value: data.text, updated_at: new Date().toISOString() }); if (error) throw new Error(error.message); return { ok: true }; });

/**
 * На что бот вообще отвечает.
 *
 * `purchases` — только покупки: узнанный номер товара и шаги начатого заказа
 * (страна, чек, почта). Всё остальное бот пропускает молча.
 *
 * `all` — плюс свободные вопросы: бот отвечает заготовленным текстом и зовёт
 * продавца в Telegram.
 *
 * По умолчанию `purchases`, и это ответ на живую жалобу продавца. Отвечая,
 * бот неизбежно помечает переписку прочитанной — управления этим у Instagram
 * в API нет, — и продавец перестаёт видеть в приложении, кому нужно ответить.
 * Ему приходилось смотреть ник в админке и вручную искать человека в
 * Instagram. Пока бот молчит, непрочитанное остаётся непрочитанным, и обычная
 * переписка идёт мимо него — как и должна.
 */
const directScopeSchema = z.object({ scope: z.enum(["purchases", "all"]) });

export const getInstagramDirectBotScopeFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminWithModule();
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("bot_id", requireBotId())
    .eq("key", "instagram_direct_bot_scope")
    .maybeSingle();
  return { scope: data?.value === "all" ? ("all" as const) : ("purchases" as const) };
});

export const saveInstagramDirectBotScopeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => directScopeSchema.parse(d))
  .handler(async ({ data }) => {
    await requireAdminWithModule();
    const s = await db();
    const { error } = await s.from("app_settings").upsert({
      bot_id: requireBotId(),
      key: "instagram_direct_bot_scope",
      value: data.scope,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const directFeaturesSchema = z.object({ catalog: z.boolean(), search: z.boolean(), cart: z.boolean(), checkout: z.boolean() });
export const getInstagramDirectBotFeaturesFn = createServerFn({ method: "GET" }).handler(async () => { await requireAdminWithModule(); const s = await db(); const { data } = await s.from("app_settings").select("value").eq("bot_id", requireBotId()).eq("key", "instagram_direct_bot_features").maybeSingle(); try { return directFeaturesSchema.parse(JSON.parse(data?.value || "{}")); } catch { return { catalog: true, search: true, cart: true, checkout: true }; } });
export const saveInstagramDirectBotFeaturesFn = createServerFn({ method: "POST" }).validator((d: unknown) => directFeaturesSchema.parse(d)).handler(async ({ data }) => { await requireAdminWithModule(); const s = await db(); const { error } = await s.from("app_settings").upsert({ bot_id: requireBotId(), key: "instagram_direct_bot_features", value: JSON.stringify(data), updated_at: new Date().toISOString() }); if (error) throw new Error(error.message); return { ok: true }; });

export const getInstagramConversationsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ accountId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { listZernioConversations } = await import("./zernio.server");
    await requireAdminWithModule();
    return { conversations: await listZernioConversations(data.accountId) };
  });

export const getInstagramConversationMessagesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ accountId: z.string().min(1), conversationId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { listZernioConversationMessages } = await import("./zernio.server");
    await requireAdminWithModule();
    return { messages: await listZernioConversationMessages(data.accountId, data.conversationId) };
  });

export const sendInstagramConversationMessageFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ accountId: z.string().min(1), conversationId: z.string().min(1), message: z.string().trim().min(1).max(1000) }).parse(d))
  .handler(async ({ data }) => {
    const { sendZernioInboxMessage } = await import("./zernio.server");
    await requireAdminWithModule();
    return await sendZernioInboxMessage(data.conversationId, data.accountId, data.message);
  });

export const getInstagramDashboardFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const { listCommentAutomations } = await import("./zernio.server");
    await requireAdminWithModule();
    const s = await db();
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceIso = since.toISOString();
    const [automations, logsResult, ordersResult] = await Promise.all([
      listCommentAutomations(),
      s.from("zernio_logs").select("event_type, status, created_at").gte("created_at", sinceIso),
      s.from("orders").select("total, status, created_at").eq("platform", "instagram").gte("created_at", sinceIso),
    ]);
    const rules = automations.automations || [];
    const totals = rules.reduce(
      (summary: { triggered: number; dms: number; clicks: number }, rule: any) => ({
        triggered: summary.triggered + Number(rule.stats?.triggered || 0),
        dms: summary.dms + Number(rule.stats?.dmsSent || 0),
        clicks: summary.clicks + Number(rule.stats?.linkClicks || 0),
      }),
      { triggered: 0, dms: 0, clicks: 0 },
    );
    const orders = ordersResult.data || [];
    return {
      periodDays: 30,
      automation: { rules: rules.length, ...totals },
      direct: {
        incoming: (logsResult.data || []).filter((log: any) => log.event_type === "message.received").length,
        errors: (logsResult.data || []).filter((log: any) => log.status === "error").length,
      },
      orders: {
        total: orders.length,
        paid: orders.filter((order: any) => ["paid", "delivered"].includes(order.status)).length,
        revenue: orders.filter((order: any) => ["paid", "delivered"].includes(order.status)).reduce((sum: number, order: any) => sum + Number(order.total || 0), 0),
      },
    };
  });

export const registerInstagramWebhookFn = createServerFn({ method: "POST" }).handler(async () => {
  const { registerZernioWebhook } = await import("./zernio.server");
  await requireAdminWithModule();

  const origin = requireAppOrigin();

  const webhookUrl = `${origin.replace(/\/$/, "")}/api/public/zernio/webhook`;
  return await registerZernioWebhook(webhookUrl);
});

const PublishInstagramPostInput = z
  .object({
    accountId: z.string().min(1),
    content: z.string().max(2200).default(""),
    mediaUrls: z.array(z.string().url()).min(1).max(10),
    mediaType: z.enum(["image", "video"]),
    contentType: z.enum(["feed", "story"]).default("feed"),
    scheduledFor: z.string().datetime().optional(),
    firstComment: z.string().max(2200).optional(),
    shareToFeed: z.boolean().optional(),
    collaborators: z.array(z.string().min(1).max(30)).max(3).optional(),
    isAiGenerated: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.contentType === "story" && data.mediaUrls.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["mediaUrls"], message: "Story принимает ровно один файл." });
    }
    if (data.mediaType === "video" && data.mediaUrls.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["mediaUrls"], message: "Reel принимает ровно один видеоролик." });
    }
    if (data.scheduledFor && new Date(data.scheduledFor).getTime() <= Date.now()) {
      ctx.addIssue({ code: "custom", path: ["scheduledFor"], message: "Время публикации должно быть в будущем." });
    }
  });

/** Publishing is part of the Instagram Automation product, not a separate module. */
export const createInstagramPostFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => PublishInstagramPostInput.parse(d))
  .handler(async ({ data }) => {
    const { createInstagramPost } = await import("./zernio.server");
    await requireAdminWithModule();
    return createInstagramPost({
      ...data,
      contentType: data.contentType === "story" ? "story" : undefined,
      collaborators: data.collaborators?.map((username) => username.replace(/^@/, "").trim()).filter(Boolean),
    });
  });

// ─── Automations via Zernio API ───────────────────────────────────────────────

/**
 * Получить список Comment-to-DM автоматизаций напрямую из Zernio
 */
export const getAutomationsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listCommentAutomations } = await import("./zernio.server");
  await requireAdminWithModule();
  const res = await listCommentAutomations();
  
  // Добавляем флаг replyToAll для удобства фронтенда
  if (res.automations) {
    res.automations = res.automations.map((a: any) => ({
      ...a,
      replyToAll: !a.keywords || a.keywords.length === 0
    }));
  }
  
  return res;
});

/**
 * Создать Comment-to-DM автоматизацию через Zernio API
 */
export const saveAutomationFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().optional(),
        originalPlatformPostId: z.string().optional().nullable(),
        originalTrigger: z.enum(["comment", "story_reply"]).optional(),
        accountId: z.string().min(1, "Укажите accountId"),
        profileId: z.any().optional(),
        name: z.string().min(1, "Укажите название"),
        keywords: z.array(z.string()).default([]),
        replyToAll: z.boolean().optional().default(false),
        matchMode: z.enum(["exact", "contains"]).default("contains"),
        dmMessage: z.string().default(""),
        commentReply: z.string().default(""),
        trigger: z.enum(["comment", "story_reply"]).default("comment"),
        platformPostId: z.string().optional().nullable(),
        postId: z.string().optional().nullable(),
        postTitle: z.string().max(500).optional(),
        buttons: z.array(z.object({ type: z.enum(["url", "postback", "phone"]), title: z.string().min(1), url: z.string().optional(), payload: z.string().optional(), phone: z.string().optional() })).max(3).optional(),
        dmMessageVariations: z.array(z.string()).max(5).optional(),
        commentReplyVariations: z.array(z.string()).max(5).optional(),
        linkTracking: z.boolean().optional(), clickTag: z.string().max(100).optional(), isActive: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { createCommentAutomation, deleteCommentAutomation, ensureDefaultZernioProfile, updateCommentAutomation } = await import("./zernio.server");
    await requireAdminWithModule();
    if (data.platformPostId && data.platformPostId === data.accountId) {
      throw new Error("Выбран ID аккаунта вместо ID публикации. Обновите список и выберите пост заново.");
    }
    
    let profileId = typeof data.profileId === "string" ? data.profileId : "";
    if (!profileId) {
      const defaultProfile = await ensureDefaultZernioProfile();
      profileId = defaultProfile._id;
    }

    const { id: automationId, originalPlatformPostId, originalTrigger, replyToAll, ...automationData } = data;
    
    // Если включен режим "Отвечать всем", очищаем ключевые слова, 
    // но ТОЛЬКО если выбран конкретный пост. 
    // На уровне "Все посты" отвечать на всё опасно (конфликты с другими ботами).
    const isSpecificPost = !!automationData.platformPostId;
    if (replyToAll && isSpecificPost) {
      automationData.keywords = [];
    } else if (replyToAll && !isSpecificPost) {
      // Если это не конкретный пост, игнорируем флаг replyToAll и требуем ключи
      if (!automationData.keywords || automationData.keywords.length === 0) {
        throw new Error("Для автоматизации на все посты необходимо указать хотя бы одно ключевое слово.");
      }
    }

    const automation = {
      ...automationData,
      profileId,
    };
    // Zernio PATCH cannot change platformPostId, postId, or trigger. If those
    // fields are unchanged, preserve the rule and its statistics with PATCH.
    if (automationId) {
      if (originalPlatformPostId === data.platformPostId && (originalTrigger || "comment") === data.trigger) {
        return await updateCommentAutomation(automationId, automation);
      }
      // Target changed: create first. This keeps the old working rule intact
      // when Zernio rejects the new post ID or returns a validation error.
      const created = await createCommentAutomation(automation);
      if (!created.ok) return created;
      const deleted = await deleteCommentAutomation(automationId);
      if (!deleted.ok) throw new Error("Новое правило создано, но старое не удалось удалить");
      return created;
    }
    return await createCommentAutomation(automation);
  });

/**
 * Удалить автоматизацию через Zernio API
 */
export const deleteAutomationFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { deleteCommentAutomation } = await import("./zernio.server");
    await requireAdminWithModule();
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
    const { updateCommentAutomation } = await import("./zernio.server");
    await requireAdminWithModule();
    return await updateCommentAutomation(data.id, { isActive: data.isActive });
  });

/**
 * Получить логи конкретной автоматизации из Zernio API
 */
export const getAutomationLogsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { getCommentAutomationLogs } = await import("./zernio.server");
    await requireAdminWithModule();
    return await getCommentAutomationLogs(data.id);
  });

// ─── Webhook logs (наша БД) ───────────────────────────────────────────────────

export const getInstagramLogsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminWithModule();

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
export const disconnectInstagramAccountFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ accountId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { disconnectZernioAccount } = await import("./zernio.server");
    await requireAdminWithModule();
    return await disconnectZernioAccount(data.accountId);
  });

export const getZernioPostsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ accountId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { listZernioPosts } = await import("./zernio.server");
    await requireAdminWithModule();
    const posts = await listZernioPosts(data.accountId);
    return { posts };
  });

export const cancelInstagramPostFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ postId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { deleteZernioPost } = await import("./zernio.server");
    await requireAdminWithModule();
    return await deleteZernioPost(data.postId);
  });

export const retryInstagramPostFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ postId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { retryZernioPost } = await import("./zernio.server");
    await requireAdminWithModule();
    return await retryZernioPost(data.postId);
  });

/**
 * Что мы знаем о собеседниках из Direct: подписан ли человек, сколько у него
 * подписчиков, верифицирован ли аккаунт.
 *
 * Эти данные приходят в каждом входящем событии, но до недавнего времени
 * терялись при разборе (см. parseZernioMessage) — колонка `bot_users.metadata`
 * была заведена под них и стояла пустой у всех. Теперь они собираются, и здесь
 * отдаются экрану Direct, чтобы продавец видел, с кем разговаривает.
 *
 * У диалогов, начатых до починки, метаданных нет и не появится задним числом —
 * такие просто не попадут в ответ, и интерфейс ничего про них не покажет.
 */
export const getInstagramContactProfilesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ participantIds: z.array(z.string()).max(100) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdminWithModule();
    if (data.participantIds.length === 0) return { profiles: {} };

    const s = await db();
    const userKeys = data.participantIds.map((id) => `ig_${id}`);
    const { data: rows, error } = await s
      .from("bot_users")
      .select("user_key, metadata")
      .in("user_key", userKeys);

    if (error) {
      console.error("[instagram.functions] getInstagramContactProfiles error:", error);
      return { profiles: {} };
    }

    const profiles: Record<
      string,
      { isFollower?: boolean; followerCount?: number; isVerified?: boolean }
    > = {};
    for (const row of rows ?? []) {
      const meta = row.metadata;
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) continue;
      const { isFollower, followerCount, isVerified } = meta as Record<string, unknown>;
      // Пустую карточку не отдаём: интерфейсу нужно отличать «не подписан» от
      // «мы про этого человека ничего не знаем».
      if (isFollower === undefined && followerCount === undefined && isVerified === undefined) {
        continue;
      }
      profiles[row.user_key.replace(/^ig_/, "")] = {
        isFollower: typeof isFollower === "boolean" ? isFollower : undefined,
        followerCount: typeof followerCount === "number" ? followerCount : undefined,
        isVerified: typeof isVerified === "boolean" ? isVerified : undefined,
      };
    }
    return { profiles };
  });
