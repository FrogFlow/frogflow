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
  comments_post_id: z.string().max(200).optional().nullable(),
  post_shortcode: z.string().max(100).optional().nullable(),
  post_note: z.string().max(2000).optional().nullable(),
  keyword: z.string().min(1).max(200),
  comment_reply_text: z.string().max(4000).optional().nullable(),
  reply_text: z.string().min(1).max(4000),
  dm_file_path: z.string().max(500).optional().nullable(),
  dm_file_name: z.string().max(255).optional().nullable(),
  dm_file_kind: z.string().max(100).optional().nullable(),
  is_active: z.boolean().default(true),
});

export const saveIgKeyword = createServerFn({ method: "POST" })
  .validator((d: unknown) => KeywordInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const now = new Date().toISOString();

    let postId = data.post_id.trim();
    let commentsPostId = data.comments_post_id?.trim() || postId;
    let postDisplayId = postId;
    let shortcode = data.post_shortcode?.trim() || null;
    const note = data.post_note?.trim() || null;

    const map = await settingsMap();
    const accountId = (map.unipile_account_id || "").trim();
    if (accountId && postId) {
      const { resolveIgPost, isUnipileConfigured } = await import("./unipile.server");
      if (isUnipileConfigured()) {
        try {
          const resolved = await resolveIgPost(accountId, shortcode || postId);
          commentsPostId = resolved.commentsPostId;
          postDisplayId = resolved.id;
          postId = resolved.commentsPostId;
          shortcode = resolved.shortcode || shortcode;
        } catch {
          // keep user-provided id
        }
      }
    }

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
          comments_post_id: commentsPostId,
          post_display_id: postDisplayId,
          post_shortcode: shortcode,
          is_active: true,
          updated_at: now,
        })
        .eq("id", existingPost.id);
    } else {
      const { error: postErr } = await s.from("ig_watched_posts").insert({
        post_id: postId,
        comments_post_id: commentsPostId,
        post_display_id: postDisplayId,
        post_shortcode: shortcode,
        caption_snapshot: note,
        is_active: true,
      });
      if (postErr) throw new Error(postErr.message);
    }

    const row = {
      post_id: postId,
      comments_post_id: commentsPostId,
      post_shortcode: shortcode,
      post_note: note,
      keyword: data.keyword.trim(),
      comment_reply_text: data.comment_reply_text?.trim() || null,
      reply_text: data.reply_text,
      dm_file_path: data.dm_file_path?.trim() || null,
      dm_file_name: data.dm_file_name?.trim() || null,
      dm_file_kind: data.dm_file_kind?.trim() || null,
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
  comments_post_id: z.string().max(200).optional().nullable(),
  post_display_id: z.string().max(200).optional().nullable(),
  post_shortcode: z.string().max(100).optional().nullable(),
  caption_snapshot: z.string().max(2000).optional().nullable(),
  is_active: z.boolean().default(true),
});

export const saveIgWatchedPost = createServerFn({ method: "POST" })
  .validator((d: unknown) => PostInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const now = new Date().toISOString();
    const map = await settingsMap();
    const accountId = (map.unipile_account_id || "").trim();
    let postId = data.post_id.trim();
    let commentsPostId = data.comments_post_id?.trim() || postId;
    let postDisplayId = data.post_display_id?.trim() || postId;
    let shortcode = data.post_shortcode?.trim() || null;

    if (accountId && postId) {
      const { resolveIgPost, isUnipileConfigured } = await import("./unipile.server");
      if (isUnipileConfigured()) {
        try {
          const resolved = await resolveIgPost(accountId, shortcode || postId);
          commentsPostId = resolved.commentsPostId;
          postDisplayId = resolved.id;
          postId = resolved.commentsPostId;
          shortcode = resolved.shortcode || shortcode;
        } catch {
          // keep user-provided id
        }
      }
    }

    if (data.id) {
      const { error } = await s
        .from("ig_watched_posts")
        .update({
          post_id: postId,
          comments_post_id: commentsPostId,
          post_display_id: postDisplayId,
          post_shortcode: shortcode,
          caption_snapshot: data.caption_snapshot || null,
          is_active: data.is_active,
          updated_at: now,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await s.from("ig_watched_posts").insert({
        post_id: postId,
        comments_post_id: commentsPostId,
        post_display_id: postDisplayId,
        post_shortcode: shortcode,
        caption_snapshot: data.caption_snapshot || null,
        is_active: data.is_active,
      });
      if (error) throw new Error(error.message);
    }
    await s
      .from("ig_post_leads")
      .update({ is_active: data.is_active, updated_at: now })
      .eq("post_id", data.post_id.trim());
    return { ok: true as const };
  });

export const deleteIgWatchedPost = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { data: row } = await s.from("ig_watched_posts").select("post_id").eq("id", data.id).maybeSingle();
    if (row?.post_id) {
      await s
        .from("ig_post_leads")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("post_id", row.post_id);
    }
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

export const listIgLeads = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data: rows, error } = await s
    .from("ig_post_leads")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const keywordIds = [...new Set((rows ?? []).map((r) => r.keyword_id).filter(Boolean))];
  const postIds = [...new Set((rows ?? []).map((r) => r.post_id).filter(Boolean))];
  let kwMap: Record<string, string> = {};
  let postMap: Record<string, string> = {};

  if (keywordIds.length) {
    const { data: kws } = await s.from("ig_keywords").select("id, keyword").in("id", keywordIds);
    kwMap = Object.fromEntries((kws ?? []).map((k) => [k.id, k.keyword]));
  }
  if (postIds.length) {
    const { data: posts } = await s.from("ig_watched_posts").select("post_id, caption_snapshot").in("post_id", postIds);
    postMap = Object.fromEntries((posts ?? []).map((p) => [p.post_id, p.caption_snapshot || ""]));
  }

  return (rows ?? []).map((r) => ({
    ...r,
    keyword_label: r.keyword_id ? kwMap[r.keyword_id] || "—" : "—",
    post_note: postMap[r.post_id] || "",
  }));
});

export const deleteIgLead = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { data: lead, error: fetchError } = await s
      .from("ig_post_leads")
      .select("id, post_id, provider_user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (fetchError) throw new Error(fetchError.message);
    if (!lead) throw new Error("Лид не найден");

    const { error: actionsByLeadError } = await s.from("ig_comment_actions").delete().eq("lead_id", lead.id);
    if (actionsByLeadError) throw new Error(actionsByLeadError.message);

    if (lead.post_id && lead.provider_user_id) {
      const { error: actionsByUserError } = await s
        .from("ig_comment_actions")
        .delete()
        .eq("post_id", lead.post_id)
        .eq("provider_user_id", lead.provider_user_id);
      if (actionsByUserError) throw new Error(actionsByUserError.message);
    }

    const { error } = await s.from("ig_post_leads").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
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

/** Diagnostic: try all post id variants and API paths for a rule. */
export const debugIgRuleComments = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ ruleId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const {
      listPostComments,
      resolvePostIdCandidates,
      resolveUnipileAccountId,
      resolveInstagramDmRecipient,
      isUnipileConfigured,
    } = await import("./unipile.server");
    if (!isUnipileConfigured()) throw new Error("Unipile не настроен");

    const map = await settingsMap();
    const accountId = (map.unipile_account_id || "").trim();
    if (!accountId) throw new Error("Сначала подключите Instagram-аккаунт");

    const s = await db();
    let rules: {
      id: string;
      keyword: string;
      post_id: string;
      comments_post_id?: string | null;
      post_shortcode?: string | null;
    }[] = [];
    if (data.ruleId) {
      const { data: row, error } = await s.from("ig_keywords").select("*").eq("id", data.ruleId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("Правило не найдено");
      rules = [row];
    } else {
      const { data: rows, error } = await s.from("ig_keywords").select("*").eq("is_active", true);
      if (error) throw new Error(error.message);
      rules = rows ?? [];
    }

    const resolvedAccountId = await resolveUnipileAccountId(accountId);
    const results = [];

    for (const rule of rules) {
      const postId = String(rule.post_id || "").trim();
      if (!postId) continue;
      const canonicalPostId = rule.comments_post_id || postId;
      const candidates = await resolvePostIdCandidates(
        accountId,
        postId,
        rule.post_shortcode,
        canonicalPostId,
      );
      const debug: import("./unipile.server").CommentsFetchDebug[] = [];
      const comments = await listPostComments(accountId, postId, {
        maxPages: 1,
        shortcode: rule.post_shortcode,
        canonicalCommentsPostId: canonicalPostId,
        debug,
      });
      results.push({
        ruleId: rule.id,
        keyword: rule.keyword,
        storedPostId: postId,
        canonicalCommentsPostId: canonicalPostId,
        shortcode: rule.post_shortcode,
        accountId: resolvedAccountId,
        v2MessagingDisabled: (await import("./unipile.server")).isV2MessagingDisabled(accountId),
        candidates,
        attempts: debug,
        commentsFound: comments.length,
        samples: await Promise.all(
          comments.slice(0, 3).map(async (c) => {
            const resolved = await resolveInstagramDmRecipient(accountId, {
              messagingId: c.ids.authorMessagingIdentifier,
              profileId: c.ids.authorProfileId,
              username: c.username || "",
            });
            return {
              id: c.id,
              commentUnipileId: c.commentUnipileId,
              text: (c.text || "").slice(0, 120),
              username: c.username || "",
              dedupeUserId: c.ids.dedupeUserId,
              dmRecipientId: c.ids.authorMessagingIdentifier,
              dmRecipientResolved: resolved.recipientId,
              dmRecipientSource: resolved.source,
              authorProfileId: c.ids.authorProfileId,
              canReply: Boolean(c.commentUnipileId && !c.ids.isSyntheticCommentId),
              canDm: Boolean(resolved.recipientId),
              rawIds: c.ids.raw,
            };
          }),
        ),
      });
    }

    return { ok: true as const, results };
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
        const now = new Date().toISOString();
        await s
          .from("ig_keywords")
          .update({
            post_id: newId,
            comments_post_id: newId,
            post_shortcode: shortcode,
            updated_at: now,
          })
          .eq("id", rule.id);
        await s.from("ig_watched_posts").upsert(
          {
            post_id: newId,
            comments_post_id: newId,
            post_display_id: shortcode || newId,
            post_shortcode: shortcode,
            caption_snapshot: rule.post_note,
            is_active: true,
            updated_at: now,
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
