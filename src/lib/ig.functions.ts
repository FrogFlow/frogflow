import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./admin-session.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

async function settingsMap() {
  const s = await db();
  const { data } = await s.from("app_settings").select("key, value");
  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.key] = row.value ?? "";
  return map;
}

async function upsertSetting(key: string, value: string) {
  const s = await db();
  const { error } = await s.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export const getIgDashboard = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const map = await settingsMap();
  const [{ count: keywords }, { count: posts }, { count: exclusions }, { count: actions }] = await Promise.all([
    s.from("ig_keywords").select("*", { count: "exact", head: true }).eq("is_active", true),
    s.from("ig_watched_posts").select("*", { count: "exact", head: true }).eq("is_active", true),
    s.from("ig_exclusions").select("*", { count: "exact", head: true }),
    s.from("ig_comment_actions").select("*", { count: "exact", head: true }),
  ]);
  const { data: lastPoll } = await s
    .from("ig_poll_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { isUnipileConfigured } = await import("./unipile.server");
  return {
    configured: isUnipileConfigured(),
    accountId: map.unipile_account_id || "",
    accountName: map.unipile_account_name || "",
    accountStatus: map.unipile_account_status || "",
    dmEnabled: map.ig_dm_enabled === "true",
    defaultReply: map.ig_default_reply || "",
    lastPoll: lastPoll || null,
    counts: {
      keywords: keywords ?? 0,
      posts: posts ?? 0,
      exclusions: exclusions ?? 0,
      actions: actions ?? 0,
    },
  };
});

export const getIgAccountSettings = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const map = await settingsMap();
  const { isUnipileConfigured } = await import("./unipile.server");
  return {
    configured: isUnipileConfigured(),
    accountId: map.unipile_account_id || "",
    accountName: map.unipile_account_name || "",
    accountStatus: map.unipile_account_status || "",
    dmEnabled: map.ig_dm_enabled === "true",
    defaultReply: map.ig_default_reply || "",
  };
});

export const saveIgAccountSettings = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        accountId: z.string().optional(),
        accountName: z.string().optional(),
        dmEnabled: z.boolean(),
        defaultReply: z.string().max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    if (data.accountId !== undefined) await upsertSetting("unipile_account_id", data.accountId.trim());
    if (data.accountName !== undefined) await upsertSetting("unipile_account_name", data.accountName.trim());
    await upsertSetting("ig_dm_enabled", data.dmEnabled ? "true" : "false");
    await upsertSetting("ig_default_reply", data.defaultReply);
    return { ok: true as const };
  });

export const createIgAuthLink = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const { createInstagramAuthLink, isUnipileConfigured } = await import("./unipile.server");
  if (!isUnipileConfigured()) throw new Error("UNIPILE_DSN / UNIPILE_API_KEY не настроены");
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("PUBLIC_APP_URL не настроен");
  const expiresOn = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { url } = await createInstagramAuthLink({
    redirectUri: `${base}/admin/ig/account`,
    notifyUrl: `${base}/api/public/unipile/webhook`,
    expiresOn,
    name: "shop-instagram",
  });
  return { url };
});

export const syncIgAccountsFromUnipile = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const { listAccounts, isUnipileConfigured } = await import("./unipile.server");
  if (!isUnipileConfigured()) throw new Error("Unipile не настроен");
  const accounts = await listAccounts();
  const ig = accounts.find(
    (a) =>
      String(a.type || a.provider || a.source || "").toUpperCase().includes("INSTAGRAM") ||
      String(a.name || "").toLowerCase().includes("instagram"),
  );
  if (!ig) return { ok: false as const, message: "Instagram-аккаунт в Unipile не найден" };
  const id = String(ig.id || ig.account_id || "");
  const name = String(ig.name || ig.username || ig.display_name || id);
  const status = String(ig.status || ig.connection_status || "");
  await upsertSetting("unipile_account_id", id);
  await upsertSetting("unipile_account_name", name);
  if (status) await upsertSetting("unipile_account_status", status);
  return { ok: true as const, accountId: id, accountName: name, status };
});

/** Recent posts of the connected IG account — for picking in Rules UI. */
export const listIgRecentPosts = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { listOwnPosts, isUnipileConfigured } = await import("./unipile.server");
  if (!isUnipileConfigured()) throw new Error("Unipile не настроен");
  const map = await settingsMap();
  const accountId = (map.unipile_account_id || "").trim();
  if (!accountId) throw new Error("Сначала подключите Instagram-аккаунт");
  return await listOwnPosts(accountId, 40);
});

/** Paste Instagram post URL / shortcode → Unipile provider_id for the rule. */
export const resolveIgPostLink = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ url: z.string().min(3).max(500) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { resolveIgPost, isUnipileConfigured } = await import("./unipile.server");
    if (!isUnipileConfigured()) throw new Error("Unipile не настроен");
    const map = await settingsMap();
    const accountId = (map.unipile_account_id || "").trim();
    if (!accountId) throw new Error("Сначала подключите Instagram-аккаунт");
    return await resolveIgPost(accountId, data.url);
  });

// —— keywords ——
export const listIgKeywords = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data, error } = await s.from("ig_keywords").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

const KeywordInput = z.object({
  id: z.string().uuid().optional(),
  post_id: z.string().min(1).max(200),
  post_shortcode: z.string().max(100).optional().nullable(),
  post_note: z.string().max(2000).optional().nullable(),
  keyword: z.string().min(1).max(200),
  reply_text: z.string().min(1).max(4000),
  is_active: z.boolean().default(true),
});

export const saveIgKeyword = createServerFn({ method: "POST" })
  .validator((d: unknown) => KeywordInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const now = new Date().toISOString();
    // post_id must be Unipile provider_id for comments API
    const postId = data.post_id.trim();
    const note = data.post_note?.trim() || null;
    const shortcode = data.post_shortcode?.trim() || null;

    const { data: existingPost } = await s
      .from("ig_watched_posts")
      .select("id")
      .eq("post_id", postId)
      .maybeSingle();
    if (existingPost) {
      await s
        .from("ig_watched_posts")
        .update({
          caption_snapshot: note,
          is_active: true,
          updated_at: now,
        })
        .eq("id", existingPost.id);
    } else {
      const { error: postErr } = await s.from("ig_watched_posts").insert({
        post_id: postId,
        caption_snapshot: note,
        is_active: true,
      });
      if (postErr) throw new Error(postErr.message);
    }

    const row = {
      post_id: postId,
      post_shortcode: shortcode,
      post_note: note,
      keyword: data.keyword.trim(),
      reply_text: data.reply_text,
      is_active: data.is_active,
      updated_at: now,
    };

    if (data.id) {
      const { error } = await s.from("ig_keywords").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await s.from("ig_keywords").insert(row);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const deleteIgKeyword = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { error } = await s.from("ig_keywords").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// —— posts ——
export const listIgWatchedPosts = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data, error } = await s.from("ig_watched_posts").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

const PostInput = z.object({
  id: z.string().uuid().optional(),
  post_id: z.string().min(1).max(200),
  caption_snapshot: z.string().max(2000).optional().nullable(),
  is_active: z.boolean().default(true),
});

export const saveIgWatchedPost = createServerFn({ method: "POST" })
  .validator((d: unknown) => PostInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const now = new Date().toISOString();
    if (data.id) {
      const { error } = await s
        .from("ig_watched_posts")
        .update({
          post_id: data.post_id.trim(),
          caption_snapshot: data.caption_snapshot || null,
          is_active: data.is_active,
          updated_at: now,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await s.from("ig_watched_posts").insert({
        post_id: data.post_id.trim(),
        caption_snapshot: data.caption_snapshot || null,
        is_active: data.is_active,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const deleteIgWatchedPost = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { error } = await s.from("ig_watched_posts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// —— exclusions ——
export const listIgExclusions = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data, error } = await s.from("ig_exclusions").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

const ExclusionInput = z.object({
  provider_user_id: z.string().max(200).optional().nullable(),
  username: z.string().max(200).optional().nullable(),
  reason: z.string().max(500).optional().nullable(),
});

export const addIgExclusion = createServerFn({ method: "POST" })
  .validator((d: unknown) => ExclusionInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const provider = data.provider_user_id?.trim() || null;
    const username = data.username?.trim() || null;
    if (!provider && !username) throw new Error("Укажите provider_user_id или username");
    const s = await db();
    const { error } = await s.from("ig_exclusions").insert({
      provider_user_id: provider,
      username,
      reason: data.reason?.trim() || null,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteIgExclusion = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { error } = await s.from("ig_exclusions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// —— log ——
export const listIgCommentActions = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data: rows, error } = await s
    .from("ig_comment_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  const keywordIds = [...new Set((rows ?? []).map((r) => r.keyword_id).filter(Boolean))];
  let kwMap: Record<string, string> = {};
  if (keywordIds.length) {
    const { data: kws } = await s.from("ig_keywords").select("id, keyword").in("id", keywordIds);
    kwMap = Object.fromEntries((kws ?? []).map((k) => [k.id, k.keyword]));
  }
  return (rows ?? []).map((r) => ({
    ...r,
    keyword_label: r.keyword_id ? kwMap[r.keyword_id] || "—" : "—",
  }));
});

export const listIgPollRuns = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data, error } = await s
    .from("ig_poll_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const runIgPollNow = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const { processIgCommentPoll } = await import("./ig-comments.server");
  return await processIgCommentPoll({ maxDms: 20 });
});

/** Re-resolve post_id to provider_id for existing rules (one-time fix). */
export const migrateIgRulePostIds = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const { resolveIgPost, igCommentsPostId, fetchIgPostRaw, isUnipileConfigured } = await import(
    "./unipile.server"
  );
  if (!isUnipileConfigured()) throw new Error("Unipile не настроен");
  const map = await settingsMap();
  const accountId = (map.unipile_account_id || "").trim();
  if (!accountId) throw new Error("Сначала подключите Instagram-аккаунт");

  const s = await db();
  const { data: rules } = await s.from("ig_keywords").select("*");
  let updated = 0;
  const errors: string[] = [];

  for (const rule of rules ?? []) {
    const current = String(rule.post_id || "").trim();
    if (!current) continue;
    try {
      let newId: string;
      let shortcode: string | null = rule.post_shortcode;
      try {
        const raw = await fetchIgPostRaw(accountId, current);
        newId = igCommentsPostId(raw);
        shortcode = raw?.shortcode || rule.post_shortcode || null;
      } catch {
        const resolved = await resolveIgPost(accountId, current);
        newId = resolved.commentsPostId;
        shortcode = resolved.shortcode || null;
      }
      if (!newId) throw new Error("empty provider id");
      if (newId !== current) {
        await s
          .from("ig_keywords")
          .update({
            post_id: newId,
            post_shortcode: shortcode,
            updated_at: new Date().toISOString(),
          })
          .eq("id", rule.id);
        await s.from("ig_watched_posts").upsert(
          {
            post_id: newId,
            caption_snapshot: rule.post_note,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "post_id" },
        );
        updated++;
      }
    } catch (e: any) {
      errors.push(`${rule.keyword}: ${e?.message || e}`);
    }
  }
  return { ok: true as const, updated, errors };
});
