import {
  listPostComments,
  sendInstagramDm,
  isUnipileConfigured,
  extractCommentText,
  type IgComment,
} from "./unipile.server";

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC");
}

type Rule = { id: string; keyword: string; reply_text: string; post_id: string };

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

function commentAuthor(c: IgComment): { userId: string; username: string } {
  const userId = String(
    c.author_id ||
      c.attendee_id ||
      c.messaging_id ||
      c.user_id ||
      c.author?.provider_id ||
      c.author?.messaging_id ||
      c.author?.id ||
      c.author?.user_id ||
      "",
  ).trim();
  const username = String(c.username || c.author?.username || "").trim().replace(/^@/, "");
  return { userId, username };
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

  const defaultReply = (settings.ig_default_reply || "").trim();
  const logAllComments = settings.ig_log_all_comments === "true";

  const [{ data: keywords }, { data: exclusions }] = await Promise.all([
    s.from("ig_keywords").select("id, keyword, reply_text, post_id").eq("is_active", true),
    s.from("ig_exclusions").select("provider_user_id, username"),
  ]);

  const rules: Rule[] = (keywords ?? [])
    .filter((k) => k.post_id && String(k.post_id).trim())
    .map((k) => ({
      id: k.id,
      keyword: k.keyword,
      reply_text: k.reply_text,
      post_id: String(k.post_id).trim(),
    }));

  if (!rules.length) {
    const result = base({ note: "no active rules", rulesCount: 0, postsPolled: 0 });
    await savePollRun(s, result, startedAt, "skipped", "Нет активных правил");
    return result;
  }

  const byPost = new Map<string, Rule[]>();
  for (const r of rules) {
    const list = byPost.get(r.post_id) || [];
    list.push(r);
    byPost.set(r.post_id, list);
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

  for (const [postId, postRules] of byPost) {
    if (sent >= maxDms) break;
    postsPolled++;
    let comments: IgComment[] = [];
    try {
      comments = await listPostComments(accountId, postId, { maxPages: 3 });
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

      if (!kw) {
        if (logAllComments) {
          const { data: seen } = await s
            .from("ig_comment_actions")
            .select("id")
            .eq("post_id", postId)
            .eq("comment_id", comment.id)
            .maybeSingle();
          if (!seen) {
            const { userId, username } = commentAuthor(comment);
            await s.from("ig_comment_actions").insert({
              post_id: postId,
              comment_id: comment.id,
              provider_user_id: userId || null,
              username: username || null,
              comment_text: text.slice(0, 1000),
              status: "no_match",
            });
          }
        }
        continue;
      }
      matched++;

      const { userId, username } = commentAuthor(comment);
      if ((userId && exclIds.has(userId)) || (username && exclNames.has(username.toLowerCase()))) {
        skipped++;
        await s.from("ig_comment_actions").insert({
          post_id: postId,
          comment_id: comment.id,
          provider_user_id: userId || null,
          username: username || null,
          keyword_id: kw.id,
          comment_text: text.slice(0, 1000),
          status: "excluded",
        }).then(() => undefined).catch(() => undefined);
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

      if (userId) {
        const { data: prior } = await s
          .from("ig_comment_actions")
          .select("id")
          .eq("keyword_id", kw.id)
          .eq("provider_user_id", userId)
          .eq("status", "sent")
          .limit(1)
          .maybeSingle();
        if (prior) {
          skipped++;
          await s.from("ig_comment_actions").insert({
            post_id: postId,
            comment_id: comment.id,
            provider_user_id: userId,
            username: username || null,
            keyword_id: kw.id,
            comment_text: text.slice(0, 1000),
            status: "skipped_duplicate_user",
          });
          continue;
        }
      }

      const reply = (kw.reply_text || defaultReply || "").trim();
      if (!reply) {
        skipped++;
        continue;
      }
      if (!userId) {
        await s.from("ig_comment_actions").insert({
          post_id: postId,
          comment_id: comment.id,
          username: username || null,
          keyword_id: kw.id,
          comment_text: text.slice(0, 1000),
          status: "error",
          error_message: "missing author id",
        });
        skipped++;
        continue;
      }

      try {
        await sendInstagramDm({ accountId, attendeeId: userId, text: reply });
        await s.from("ig_comment_actions").insert({
          post_id: postId,
          comment_id: comment.id,
          provider_user_id: userId,
          username: username || null,
          keyword_id: kw.id,
          comment_text: text.slice(0, 1000),
          status: "sent",
        });
        if (!exclIds.has(userId)) {
          await s.from("ig_exclusions").insert({
            provider_user_id: userId,
            username: username || null,
            reason: "auto: already messaged by bot",
          });
          exclIds.add(userId);
        }
        sent++;
      } catch (e: any) {
        const msg = e?.message || String(e);
        errors.push(msg);
        await s.from("ig_comment_actions").insert({
          post_id: postId,
          comment_id: comment.id,
          provider_user_id: userId,
          username: username || null,
          keyword_id: kw.id,
          comment_text: text.slice(0, 1000),
          status: "error",
          error_message: msg.slice(0, 500),
        });
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
