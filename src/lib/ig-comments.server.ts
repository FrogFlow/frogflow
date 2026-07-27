import {
  isInstagramDmBlockedError,
  isRetryableInstagramDmError,
  listPostComments,
  extractCommentText,
  type IgComment,
  type IgOutgoingAttachment,
  isUnipileConfigured,
  replyToInstagramComment,
  sendInstagramDm,
} from "./unipile.server";

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC");
}

type Rule = {
  id: string;
  keyword: string;
  comment_reply_text?: string | null;
  reply_text: string;
  dm_file_path?: string | null;
  dm_file_name?: string | null;
  dm_file_kind?: string | null;
  post_id: string;
  comments_post_id?: string | null;
  post_shortcode?: string | null;
};

type LeadRow = {
  id: string;
  post_id: string;
  keyword_id: string | null;
  provider_user_id: string;
  author_profile_id: string | null;
  dm_recipient_id: string | null;
  unipile_comment_id: string | null;
  username: string | null;
  first_comment_id: string | null;
  last_comment_id: string | null;
  last_comment_text: string | null;
  comment_replied_at: string | null;
  dm_status: string;
  dm_attempts: number;
  first_dm_attempt_at: string | null;
  next_retry_at: string | null;
  retry_until_at: string | null;
  dm_sent_at: string | null;
  closed_reason: string | null;
  last_error: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const RETRY_WINDOW_MS = 30 * 60 * 1000;
const RETRY_INTERVAL_MS = 2 * 60 * 1000;

export function findMatchingKeyword(commentText: string, keywords: Rule[]): Rule | null {
  const hay = normalize(commentText || "");
  if (!hay) return null;
  for (const kw of keywords) {
    const needle = normalize(kw.keyword || "").trim();
    if (!needle) continue;
    if (hay.includes(needle)) return kw;
  }
  return null;
}

function commentIdentity(c: IgComment) {
  const username = String(c.username || "")
    .trim()
    .replace(/^@/, "");
  return {
    dedupeUserId: c.ids.dedupeUserId || "",
    authorProfileId: c.ids.authorProfileId,
    dmRecipientId: c.ids.authorMessagingIdentifier,
    commentUnipileId: c.commentUnipileId,
    canReply: Boolean(c.commentUnipileId && !c.ids.isSyntheticCommentId),
    canDm: Boolean(c.ids.authorMessagingIdentifier),
    username,
    rawIds: c.ids.raw,
  };
}

function retryAt(fromMs = Date.now()) {
  return new Date(fromMs + RETRY_INTERVAL_MS).toISOString();
}

function retryUntil(fromMs = Date.now()) {
  return new Date(fromMs + RETRY_WINDOW_MS).toISOString();
}

function isRetryExpired(lead: LeadRow, nowMs = Date.now()) {
  return Boolean(lead.retry_until_at && new Date(lead.retry_until_at).getTime() <= nowMs);
}

function actionCommentId(base: string, suffix?: string) {
  return suffix ? `${base}:${suffix}` : base;
}

async function logAction(s: any, row: Record<string, unknown>) {
  await s
    .from("ig_comment_actions")
    .insert(row)
    .then(() => undefined)
    .catch(() => undefined);
}

async function loadDmAttachment(path?: string | null, name?: string | null): Promise<IgOutgoingAttachment | null> {
  if (!path) return null;
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data, error } = await supabaseAdmin.storage.from("product-files").download(path);
  if (error || !data) throw new Error(error?.message || "Не удалось загрузить вложение");
  const arrayBuffer = await data.arrayBuffer();
  const filename = name?.trim() || path.split("/").pop() || "attachment";
  return {
    filename,
    contentType: data.type || "application/octet-stream",
    contentBase64: Buffer.from(arrayBuffer).toString("base64"),
  };
}

async function upsertLeadFromComment(
  s: any,
  params: {
    rule: Rule;
    postId: string;
    dedupeUserId: string;
    authorProfileId: string | null;
    dmRecipientId: string | null;
    commentUnipileId: string | null;
    username: string;
    commentId: string;
    commentText: string;
  },
): Promise<LeadRow> {
  const now = new Date().toISOString();
  const { data: existing } = await s
    .from("ig_post_leads")
    .select("*")
    .eq("post_id", params.postId)
    .eq("provider_user_id", params.dedupeUserId)
    .maybeSingle();

  const baseFields = {
    keyword_id: params.rule.id,
    author_profile_id: params.authorProfileId,
    dm_recipient_id: params.dmRecipientId,
    unipile_comment_id: params.commentUnipileId,
    username: params.username || null,
    last_comment_id: params.commentId,
    last_comment_text: params.commentText.slice(0, 1000),
    is_active: true,
    updated_at: now,
  };

  if (!existing) {
    const { data, error } = await s
      .from("ig_post_leads")
      .insert({
        post_id: params.postId,
        provider_user_id: params.dedupeUserId,
        first_comment_id: params.commentId,
        ...baseFields,
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message || "Не удалось создать lead");
    return data as LeadRow;
  }

  const update: Record<string, unknown> = { ...baseFields };
  if (params.dmRecipientId) update.dm_recipient_id = params.dmRecipientId;
  if (params.commentUnipileId) update.unipile_comment_id = params.commentUnipileId;

  if (
    existing.last_comment_id !== params.commentId &&
    ["dm_failed", "dm_gave_up", "new", "waiting_messaging_id"].includes(existing.dm_status || "")
  ) {
    update.dm_status = params.dmRecipientId ? "new" : "waiting_messaging_id";
    update.dm_attempts = 0;
    update.first_dm_attempt_at = null;
    update.next_retry_at = null;
    update.retry_until_at = null;
    update.closed_reason = params.dmRecipientId ? null : "missing_messaging_id";
    update.last_error = null;
  }

  const { data, error } = await s
    .from("ig_post_leads")
    .update(update)
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message || "Не удалось обновить lead");
  return data as LeadRow;
}

async function markLeadGaveUp(
  s: any,
  lead: LeadRow,
  reason: string,
  errorMessage?: string,
) {
  const now = new Date().toISOString();
  await s
    .from("ig_post_leads")
    .update({
      dm_status: "dm_gave_up",
      closed_reason: reason,
      last_error: errorMessage || null,
      next_retry_at: null,
      is_active: false,
      updated_at: now,
    })
    .eq("id", lead.id);
  await logAction(s, {
    post_id: lead.post_id,
    comment_id: actionCommentId(lead.last_comment_id || lead.id, "giveup"),
    provider_user_id: lead.provider_user_id,
    username: lead.username,
    keyword_id: lead.keyword_id,
    lead_id: lead.id,
    comment_text: lead.last_comment_text,
    status: "dm_gave_up",
    error_message: (errorMessage || reason).slice(0, 500),
    attempt_no: lead.dm_attempts,
  });
}

async function sendLeadDm(
  s: any,
  accountId: string,
  lead: LeadRow,
  rule: Rule,
  opts?: { actionId?: string; isRetry?: boolean; debugInfo?: Record<string, unknown> },
): Promise<"sent" | "pending" | "failed" | "gave_up" | "skipped" | "waiting"> {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const actionId = opts?.actionId || actionCommentId(lead.last_comment_id || lead.id, opts?.isRetry ? "retry" : "dm");
  const dmRecipientId = (lead.dm_recipient_id || "").trim();

  if (lead.dm_status === "dm_sent") return "skipped";
  if (!dmRecipientId) {
    await s
      .from("ig_post_leads")
      .update({
        dm_status: "waiting_messaging_id",
        closed_reason: "missing_messaging_id",
        last_error: "Нет messaging_identifier для Instagram DM",
        updated_at: now,
      })
      .eq("id", lead.id);
    await logAction(s, {
      post_id: lead.post_id,
      comment_id: actionCommentId(actionId, "no-messaging-id"),
      provider_user_id: lead.provider_user_id,
      username: lead.username,
      keyword_id: rule.id,
      lead_id: lead.id,
      comment_text: lead.last_comment_text,
      status: "waiting_messaging_id",
      error_message: "Нет messaging_identifier",
      attempt_no: lead.dm_attempts,
      debug_info: opts?.debugInfo || null,
    });
    return "waiting";
  }

  if (opts?.isRetry && isRetryExpired(lead, nowMs)) {
    await markLeadGaveUp(s, lead, "retry_window_expired");
    return "gave_up";
  }

  try {
    const attachment = await loadDmAttachment(rule.dm_file_path, rule.dm_file_name);
    const hadAttachment = Boolean(attachment);
    const result = await sendInstagramDm({
      accountId,
      attendeeId: dmRecipientId,
      text: rule.reply_text,
      attachment,
    });
    const attachmentFailed = hadAttachment && !result.attachmentSent;
    await s
      .from("ig_post_leads")
      .update({
        dm_status: "dm_sent",
        dm_attempts: (lead.dm_attempts || 0) + 1,
        dm_sent_at: now,
        first_dm_attempt_at: lead.first_dm_attempt_at || now,
        next_retry_at: null,
        retry_until_at: lead.retry_until_at || retryUntil(nowMs),
        closed_reason: null,
        last_error: attachmentFailed
          ? `DM text sent, file failed: ${result.attachmentError || "unknown"}`
          : null,
        updated_at: now,
      })
      .eq("id", lead.id);
    await logAction(s, {
      post_id: lead.post_id,
      comment_id: actionId,
      provider_user_id: lead.provider_user_id,
      username: lead.username,
      keyword_id: rule.id,
      lead_id: lead.id,
      comment_text: lead.last_comment_text,
      status: attachmentFailed ? "dm_sent_no_file" : "dm_sent",
      attempt_no: (lead.dm_attempts || 0) + 1,
      debug_info: {
        ...(opts?.debugInfo || {}),
        dmRecipientId,
        route: result.route,
        attachmentSent: result.attachmentSent,
        attachmentError: result.attachmentError || null,
        dmFilePath: rule.dm_file_path || null,
      },
    });
    return "sent";
  } catch (e: any) {
    const msg = e?.message || String(e);
    const attempts = (lead.dm_attempts || 0) + 1;
    if (isInstagramDmBlockedError(e)) {
      const expired =
        Boolean(lead.retry_until_at) && new Date(lead.retry_until_at as string).getTime() <= nowMs;
      if (expired) {
        await markLeadGaveUp(s, lead, "dm_closed", msg);
        return "gave_up";
      }
      await s
        .from("ig_post_leads")
        .update({
          dm_status: "pending",
          dm_attempts: attempts,
          first_dm_attempt_at: lead.first_dm_attempt_at || now,
          next_retry_at: retryAt(nowMs),
          retry_until_at: lead.retry_until_at || retryUntil(nowMs),
          closed_reason: "dm_closed",
          last_error: msg.slice(0, 500),
          updated_at: now,
        })
        .eq("id", lead.id);
      await logAction(s, {
        post_id: lead.post_id,
        comment_id: actionId,
        provider_user_id: lead.provider_user_id,
        username: lead.username,
        keyword_id: rule.id,
        lead_id: lead.id,
        comment_text: lead.last_comment_text,
        status: "dm_pending",
        error_message: msg.slice(0, 500),
        attempt_no: attempts,
        debug_info: { ...(opts?.debugInfo || {}), dmRecipientId },
      });
      return "pending";
    }
    if (isRetryableInstagramDmError(e)) {
      const expired =
        Boolean(lead.retry_until_at) && new Date(lead.retry_until_at as string).getTime() <= nowMs;
      if (expired) {
        await markLeadGaveUp(s, lead, "retry_window_expired", msg);
        return "gave_up";
      }
      await s
        .from("ig_post_leads")
        .update({
          dm_status: "pending",
          dm_attempts: attempts,
          first_dm_attempt_at: lead.first_dm_attempt_at || now,
          next_retry_at: retryAt(nowMs),
          retry_until_at: lead.retry_until_at || retryUntil(nowMs),
          closed_reason: "temporary_error",
          last_error: msg.slice(0, 500),
          updated_at: now,
        })
        .eq("id", lead.id);
      await logAction(s, {
        post_id: lead.post_id,
        comment_id: actionCommentId(actionId, "retryable"),
        provider_user_id: lead.provider_user_id,
        username: lead.username,
        keyword_id: rule.id,
        lead_id: lead.id,
        comment_text: lead.last_comment_text,
        status: "dm_pending",
        error_message: msg.slice(0, 500),
        attempt_no: attempts,
        debug_info: { ...(opts?.debugInfo || {}), dmRecipientId },
      });
      return "pending";
    }

    await s
      .from("ig_post_leads")
      .update({
        dm_status: "dm_failed",
        dm_attempts: attempts,
        first_dm_attempt_at: lead.first_dm_attempt_at || now,
        next_retry_at: null,
        closed_reason: "send_error",
        last_error: msg.slice(0, 500),
        updated_at: now,
      })
      .eq("id", lead.id);
    await logAction(s, {
      post_id: lead.post_id,
      comment_id: actionId,
      provider_user_id: lead.provider_user_id,
      username: lead.username,
      keyword_id: rule.id,
      lead_id: lead.id,
      comment_text: lead.last_comment_text,
      status: "dm_failed",
      error_message: msg.slice(0, 500),
      attempt_no: attempts,
      debug_info: { ...(opts?.debugInfo || {}), dmRecipientId },
    });
    return "failed";
  }
}

async function processPendingLeads(
  s: any,
  accountId: string,
  activePosts: Set<string>,
  rulesById: Map<string, Rule>,
  maxDms: number,
) {
  const now = new Date().toISOString();
  const { data: rows } = await s
    .from("ig_post_leads")
    .select("*")
    .eq("dm_status", "pending")
    .eq("is_active", true)
    .lte("next_retry_at", now)
    .order("next_retry_at", { ascending: true })
    .limit(maxDms);

  let sent = 0;
  const errors: string[] = [];

  for (const raw of (rows ?? []) as LeadRow[]) {
    if (sent >= maxDms) break;
    if (!activePosts.has(raw.post_id)) {
      await s
        .from("ig_post_leads")
        .update({
          is_active: false,
          dm_status: "post_disabled",
          closed_reason: "post_disabled",
          next_retry_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", raw.id);
      await logAction(s, {
        post_id: raw.post_id,
        comment_id: actionCommentId(raw.last_comment_id || raw.id, "post-disabled"),
        provider_user_id: raw.provider_user_id,
        username: raw.username,
        keyword_id: raw.keyword_id,
        lead_id: raw.id,
        comment_text: raw.last_comment_text,
        status: "post_disabled",
        attempt_no: raw.dm_attempts,
      });
      continue;
    }

    const rule = raw.keyword_id ? rulesById.get(raw.keyword_id) : null;
    if (!rule) {
      await markLeadGaveUp(s, raw, "rule_inactive");
      continue;
    }

    const status = await sendLeadDm(
      s,
      accountId,
      raw,
      rule,
      { actionId: actionCommentId(raw.last_comment_id || raw.id, `retry-${raw.dm_attempts + 1}`), isRetry: true },
    );
    if (status === "sent") sent++;
    if (status === "failed") errors.push(`lead ${raw.id}: send failed`);
    if (status === "gave_up") errors.push(`lead ${raw.id}: retry window expired`);
  }

  return { sent, errors };
}

export type IgPollResult = {
  ok: boolean;
  skippedReason?: string;
  error?: string;
  note?: string;
  scanned: number;
  matched: number;
  sent: number;
  skipped: number;
  postsPolled?: number;
  rulesCount?: number;
  errors?: string[];
};

async function savePollRun(s: any, result: IgPollResult, startedAt: string, status: string, note?: string) {
  await s.from("ig_poll_runs").insert({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status,
    rules_count: result.rulesCount ?? 0,
    posts_polled: result.postsPolled ?? 0,
    comments_scanned: result.scanned,
    matched: result.matched,
    sent: result.sent,
    skipped: result.skipped,
    errors: result.errors?.length ? result.errors.join("\n") : null,
    note: note || result.note || result.skippedReason || result.error || null,
  });
}

export async function processIgCommentPoll(opts?: { maxDms?: number }): Promise<IgPollResult> {
  const maxDms = opts?.maxDms ?? 20;
  const startedAt = new Date().toISOString();

  const base = (extra: Partial<IgPollResult>): IgPollResult => ({
    ok: true,
    scanned: 0,
    matched: 0,
    sent: 0,
    skipped: 0,
    ...extra,
  });

  if (!isUnipileConfigured()) {
    const result = base({ ok: false, error: "Unipile not configured" });
    const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
    await savePollRun(supabaseAdmin, result, startedAt, "error");
    return result;
  }

  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const s = supabaseAdmin;

  const { data: settingsRows } = await s.from("app_settings").select("key, value");
  const settings: Record<string, string> = {};
  for (const row of settingsRows ?? []) settings[row.key] = row.value ?? "";

  if (settings.ig_dm_enabled !== "true") {
    const result = base({ skippedReason: "ig_dm_enabled=false" });
    await savePollRun(s, result, startedAt, "skipped", "Авто-DM выключен");
    return result;
  }

  const accountId = (settings.unipile_account_id || "").trim();
  if (!accountId) {
    const result = base({ ok: false, error: "unipile_account_id empty" });
    await savePollRun(s, result, startedAt, "error");
    return result;
  }

  const { resolveUnipileAccountId } = await import("./unipile.server");
  const resolvedAccountId = await resolveUnipileAccountId(accountId);

  const defaultReply = (settings.ig_default_reply || "").trim();
  const logAllComments = settings.ig_log_all_comments === "true";

  const [{ data: keywords }, { data: exclusions }, { data: watchedPosts }] = await Promise.all([
    s
      .from("ig_keywords")
      .select(
        "id, keyword, comment_reply_text, reply_text, dm_file_path, dm_file_name, dm_file_kind, post_id, comments_post_id, post_shortcode",
      )
      .eq("is_active", true),
    s.from("ig_exclusions").select("provider_user_id, username"),
    s.from("ig_watched_posts").select("post_id, comments_post_id, post_shortcode, is_active"),
  ]);

  const watchedByPostId = new Map(
    (watchedPosts ?? []).map((p) => [
      String(p.post_id || "").trim(),
      {
        commentsPostId: String(p.comments_post_id || p.post_id || "").trim(),
        shortcode: p.post_shortcode || null,
        isActive: p.is_active,
      },
    ]),
  );

  const rules: Rule[] = (keywords ?? [])
    .filter((k) => k.post_id && String(k.post_id).trim())
    .map((k) => ({
      id: k.id,
      keyword: k.keyword,
      comment_reply_text: k.comment_reply_text,
      reply_text: k.reply_text,
      dm_file_path: k.dm_file_path,
      dm_file_name: k.dm_file_name,
      dm_file_kind: k.dm_file_kind,
      post_id: String(k.post_id).trim(),
      comments_post_id: k.comments_post_id || watchedByPostId.get(String(k.post_id).trim())?.commentsPostId || null,
      post_shortcode: k.post_shortcode || watchedByPostId.get(String(k.post_id).trim())?.shortcode || null,
    }));

  if (!rules.length) {
    const result = base({ note: "no active rules", rulesCount: 0, postsPolled: 0 });
    await savePollRun(s, result, startedAt, "skipped", "Нет активных правил");
    return result;
  }

  const byPost = new Map<string, { rules: Rule[]; commentsPostId?: string | null; shortcode?: string | null }>();
  for (const r of rules) {
    const entry = byPost.get(r.post_id) || {
      rules: [],
      commentsPostId: r.comments_post_id,
      shortcode: r.post_shortcode,
    };
    entry.rules.push(r);
    if (r.comments_post_id) entry.commentsPostId = r.comments_post_id;
    if (r.post_shortcode) entry.shortcode = r.post_shortcode;
    byPost.set(r.post_id, entry);
  }

  const exclIds = new Set(
    (exclusions ?? []).map((e) => (e.provider_user_id || "").trim()).filter(Boolean),
  );
  const exclNames = new Set(
    (exclusions ?? [])
      .map((e) => (e.username || "").trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  );

  let scanned = 0;
  let matched = 0;
  let sent = 0;
  let skipped = 0;
  let postsPolled = 0;
  const errors: string[] = [];

  const activePosts = new Set(
    (watchedPosts ?? [])
      .filter((p) => p.is_active)
      .map((r) => String(r.post_id || "").trim())
      .filter(Boolean),
  );
  const filteredPosts = new Map(
    [...byPost.entries()].filter(([postId]) => activePosts.has(postId)),
  );
  const rulesById = new Map(rules.map((r) => [r.id, r]));

  const pendingResult = await processPendingLeads(s, resolvedAccountId, activePosts, rulesById, maxDms);
  sent += pendingResult.sent;
  errors.push(...pendingResult.errors);

  for (const [postId, { rules: postRules, commentsPostId, shortcode }] of filteredPosts) {
    if (sent >= maxDms) break;
    postsPolled++;
    let comments: IgComment[] = [];
    const fetchDebug: import("./unipile.server").CommentsFetchDebug[] = [];
    const canonicalPostId = commentsPostId || postId;
    try {
      comments = await listPostComments(resolvedAccountId, postId, {
        maxPages: 3,
        shortcode,
        canonicalCommentsPostId: canonicalPostId,
        debug: fetchDebug,
      });
      if (comments.length === 0 && fetchDebug.length) {
        const summary = fetchDebug
          .map((d) => `${d.postIdTried}:${d.count}${d.path ? `@${d.path.split("/").slice(-2).join("/")}` : ""}${d.error ? `(${d.error})` : ""}`)
          .join("; ");
        errors.push(`post ${postId} — 0 comments. Tried: ${summary}`);
      }
    } catch (e: any) {
      const msg = `post ${postId}: ${e?.message || e}`;
      errors.push(msg);
      continue;
    }

    for (const comment of comments) {
      if (sent >= maxDms) break;
      scanned++;
      const text = comment.text || extractCommentText(comment) || "";
      const kw = findMatchingKeyword(text, postRules);
      const identity = commentIdentity(comment);

      if (!kw) {
        if (logAllComments) {
          const { data: seen } = await s
            .from("ig_comment_actions")
            .select("id")
            .eq("post_id", postId)
            .eq("comment_id", comment.id)
            .maybeSingle();
          if (!seen) {
            await logAction(s, {
              post_id: postId,
              comment_id: comment.id,
              provider_user_id: identity.dedupeUserId || null,
              username: identity.username || null,
              comment_text: text.slice(0, 1000),
              status: "no_match",
              attempt_no: 0,
              debug_info: { rawIds: identity.rawIds },
            });
          }
        }
        continue;
      }
      matched++;

      if (
        (identity.dedupeUserId && exclIds.has(identity.dedupeUserId)) ||
        (identity.username && exclNames.has(identity.username.toLowerCase()))
      ) {
        skipped++;
        await logAction(s, {
          post_id: postId,
          comment_id: comment.id,
          provider_user_id: identity.dedupeUserId || null,
          username: identity.username || null,
          keyword_id: kw.id,
          comment_text: text.slice(0, 1000),
          status: "excluded",
          attempt_no: 0,
          debug_info: { rawIds: identity.rawIds },
        });
        continue;
      }

      const { data: existing } = await s
        .from("ig_comment_actions")
        .select("id")
        .eq("post_id", postId)
        .eq("comment_id", comment.id)
        .maybeSingle();
      if (existing) {
        skipped++;
        continue;
      }

      if (identity.dedupeUserId) {
        const { data: prior } = await s
          .from("ig_post_leads")
          .select("id, dm_status")
          .eq("post_id", postId)
          .eq("provider_user_id", identity.dedupeUserId)
          .maybeSingle();
        if (prior?.dm_status === "dm_sent") {
          skipped++;
          await logAction(s, {
            post_id: postId,
            comment_id: comment.id,
            provider_user_id: identity.dedupeUserId,
            username: identity.username || null,
            keyword_id: kw.id,
            comment_text: text.slice(0, 1000),
            status: "skipped_duplicate_user",
            attempt_no: 0,
          });
          continue;
        }
      }

      const reply = (kw.reply_text || defaultReply || "").trim();
      if (!reply) {
        skipped++;
        continue;
      }
      if (!identity.dedupeUserId) {
        await logAction(s, {
          post_id: postId,
          comment_id: comment.id,
          username: identity.username || null,
          keyword_id: kw.id,
          comment_text: text.slice(0, 1000),
          status: "error",
          error_message: "missing author id",
          attempt_no: 0,
          debug_info: { rawIds: identity.rawIds },
        });
        skipped++;
        continue;
      }

      let lead: LeadRow;
      try {
        lead = await upsertLeadFromComment(s, {
          rule: kw,
          postId,
          dedupeUserId: identity.dedupeUserId,
          authorProfileId: identity.authorProfileId,
          dmRecipientId: identity.dmRecipientId,
          commentUnipileId: identity.commentUnipileId,
          username: identity.username,
          commentId: comment.id,
          commentText: text,
        });
      } catch (e: any) {
        const msg = e?.message || String(e);
        errors.push(msg);
        await logAction(s, {
          post_id: postId,
          comment_id: comment.id,
          provider_user_id: identity.dedupeUserId,
          username: identity.username || null,
          keyword_id: kw.id,
          comment_text: text.slice(0, 1000),
          status: "error",
          error_message: msg.slice(0, 500),
          attempt_no: 0,
          debug_info: { rawIds: identity.rawIds },
        });
        skipped++;
        continue;
      }

      const commentReply = (kw.comment_reply_text || "").trim();
      const replyCommentId = identity.commentUnipileId;
      if (commentReply && !lead.comment_replied_at) {
        if (!identity.canReply || !replyCommentId) {
          errors.push(`reply ${comment.id}: missing Unipile comment id`);
          await logAction(s, {
            post_id: postId,
            comment_id: actionCommentId(comment.id, "comment-reply-skip"),
            provider_user_id: identity.dedupeUserId,
            username: identity.username || null,
            keyword_id: kw.id,
            lead_id: lead.id,
            comment_text: text.slice(0, 1000),
            status: "error",
            error_message: "missing Unipile comment id for reply",
            attempt_no: 0,
            debug_info: { rawIds: identity.rawIds },
          });
        } else {
          try {
            const replyResult = await replyToInstagramComment({
              accountId: resolvedAccountId,
              postId: canonicalPostId,
              commentId: replyCommentId,
              text: commentReply,
            });
            lead = {
              ...lead,
              comment_replied_at: new Date().toISOString(),
            };
            await s
              .from("ig_post_leads")
              .update({ comment_replied_at: lead.comment_replied_at, updated_at: lead.comment_replied_at })
              .eq("id", lead.id);
            await logAction(s, {
              post_id: postId,
              comment_id: actionCommentId(comment.id, "comment-reply"),
              provider_user_id: identity.dedupeUserId,
              username: identity.username || null,
              keyword_id: kw.id,
              lead_id: lead.id,
              comment_text: text.slice(0, 1000),
              status: "comment_replied",
              attempt_no: 0,
              debug_info: {
                route: replyResult.route,
                commentUnipileId: replyCommentId,
                canonicalPostId,
              },
            });
          } catch (e: any) {
            errors.push(`reply ${comment.id}: ${e?.message || e}`);
            await logAction(s, {
              post_id: postId,
              comment_id: actionCommentId(comment.id, "comment-reply-error"),
              provider_user_id: identity.dedupeUserId,
              username: identity.username || null,
              keyword_id: kw.id,
              lead_id: lead.id,
              comment_text: text.slice(0, 1000),
              status: "error",
              error_message: String(e?.message || e).slice(0, 500),
              attempt_no: 0,
              debug_info: { commentUnipileId: replyCommentId, canonicalPostId },
            });
          }
        }
      }

      const dmStatus = await sendLeadDm(
        s,
        resolvedAccountId,
        lead,
        kw,
        {
          actionId: comment.id,
          debugInfo: {
            dedupeUserId: identity.dedupeUserId,
            dmRecipientId: identity.dmRecipientId,
            authorProfileId: identity.authorProfileId,
            commentUnipileId: identity.commentUnipileId,
            rawIds: identity.rawIds,
          },
        },
      );
      if (dmStatus === "sent") sent++;
      if (dmStatus === "failed" || dmStatus === "gave_up") {
        errors.push(`dm ${comment.id}: ${dmStatus}`);
      }
      if (dmStatus !== "sent") {
        skipped++;
      }
    }
  }

  const result: IgPollResult = {
    ok: errors.length === 0 || scanned > 0,
    scanned,
    matched,
    sent,
    skipped,
    postsPolled,
    rulesCount: rules.length,
    errors: errors.slice(0, 10),
  };
  await savePollRun(
    s,
    result,
    startedAt,
    errors.length && scanned === 0 ? "error" : "ok",
    scanned === 0 && rules.length > 0 ? "Комментарии не найдены — проверьте post_id (provider_id)" : undefined,
  );
  return result;
}
