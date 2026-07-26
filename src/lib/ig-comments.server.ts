import { listPostComments, sendInstagramDm, isUnipileConfigured, type IgComment } from "./unipile.server";

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC");
}

/** Case-insensitive substring match (plan: substring). */
export function findMatchingKeyword(
  commentText: string,
  keywords: { id: string; keyword: string; reply_text: string }[],
): { id: string; keyword: string; reply_text: string } | null {
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
    c.author_id || c.user_id || c.author?.id || c.author?.provider_id || "",
  ).trim();
  const username = String(c.username || c.author?.username || "").trim().replace(/^@/, "");
  return { userId, username };
}

export async function processIgCommentPoll(opts?: { maxDms?: number }) {
  const maxDms = opts?.maxDms ?? 20;
  if (!isUnipileConfigured()) {
    return { ok: false as const, error: "Unipile not configured", scanned: 0, matched: 0, sent: 0, skipped: 0 };
  }

  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const s = supabaseAdmin;

  const { data: settingsRows } = await s.from("app_settings").select("key, value");
  const settings: Record<string, string> = {};
  for (const row of settingsRows ?? []) settings[row.key] = row.value ?? "";

  if (settings.ig_dm_enabled !== "true") {
    return { ok: true as const, skippedReason: "ig_dm_enabled=false", scanned: 0, matched: 0, sent: 0, skipped: 0 };
  }

  const accountId = (settings.unipile_account_id || "").trim();
  if (!accountId) {
    return { ok: false as const, error: "unipile_account_id empty", scanned: 0, matched: 0, sent: 0, skipped: 0 };
  }

  const defaultReply = (settings.ig_default_reply || "").trim();

  const [{ data: posts }, { data: keywords }, { data: exclusions }] = await Promise.all([
    s.from("ig_watched_posts").select("*").eq("is_active", true),
    s.from("ig_keywords").select("id, keyword, reply_text").eq("is_active", true),
    s.from("ig_exclusions").select("provider_user_id, username"),
  ]);

  const kwList = keywords ?? [];
  if (!posts?.length || !kwList.length) {
    return { ok: true as const, scanned: 0, matched: 0, sent: 0, skipped: 0, note: "no posts or keywords" };
  }

  const exclIds = new Set(
    (exclusions ?? [])
      .map((e) => (e.provider_user_id || "").trim())
      .filter(Boolean),
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
  const errors: string[] = [];

  for (const post of posts) {
    if (sent >= maxDms) break;
    let comments: IgComment[] = [];
    try {
      comments = await listPostComments(accountId, post.post_id);
    } catch (e: any) {
      errors.push(`post ${post.post_id}: ${e?.message || e}`);
      continue;
    }

    for (const comment of comments) {
      if (sent >= maxDms) break;
      scanned++;
      const text = comment.text || "";
      const kw = findMatchingKeyword(text, kwList);
      if (!kw) continue;
      matched++;

      const { userId, username } = commentAuthor(comment);
      if ((userId && exclIds.has(userId)) || (username && exclNames.has(username.toLowerCase()))) {
        skipped++;
        continue;
      }

      // Already processed this comment?
      const { data: existing } = await s
        .from("ig_comment_actions")
        .select("id")
        .eq("post_id", post.post_id)
        .eq("comment_id", comment.id)
        .maybeSingle();
      if (existing) {
        skipped++;
        continue;
      }

      // Already DM'd this user for this keyword?
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
            post_id: post.post_id,
            comment_id: comment.id,
            provider_user_id: userId || null,
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
          post_id: post.post_id,
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
          post_id: post.post_id,
          comment_id: comment.id,
          provider_user_id: userId,
          username: username || null,
          keyword_id: kw.id,
          comment_text: text.slice(0, 1000),
          status: "sent",
        });
        // Auto-exclude after successful DM so we don't spam
        if (userId && !exclIds.has(userId)) {
          const { error: exclErr } = await s.from("ig_exclusions").insert({
            provider_user_id: userId,
            username: username || null,
            reason: "auto: already messaged by bot",
          });
          if (!exclErr) exclIds.add(userId);
          else exclIds.add(userId); // duplicate unique — still treat as excluded
        }
        sent++;
      } catch (e: any) {
        const msg = e?.message || String(e);
        errors.push(msg);
        await s.from("ig_comment_actions").insert({
          post_id: post.post_id,
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

  return { ok: true as const, scanned, matched, sent, skipped, errors: errors.slice(0, 10) };
}
