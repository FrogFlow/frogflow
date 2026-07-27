/**
 * Unipile API client (Instagram).
 * Uses canonical identifier types per Unipile docs:
 * - post comments/replies: Unipile post_id + comment_id
 * - Instagram DMs: recipient provider_messaging_id (see Unipile send-messages docs)
 * - v1 messaging: multipart/form-data on /api/v1/chats
 */

import { createHmac } from "node:crypto";

function unipileBaseUrl(): string {
  const raw = (process.env.UNIPILE_DSN || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!raw) throw new Error("UNIPILE_DSN is not configured");
  return `https://${raw}`;
}

function apiKey(): string {
  const key = process.env.UNIPILE_API_KEY?.trim();
  if (!key) throw new Error("UNIPILE_API_KEY is not configured");
  return key;
}

export function isUnipileConfigured(): boolean {
  return Boolean(process.env.UNIPILE_DSN?.trim() && process.env.UNIPILE_API_KEY?.trim());
}

export type UnipileFetchMeta = {
  route: string;
  accountIdFlavor?: "v1" | "v2" | "stored";
};

async function unipileFetch<T = any>(
  path: string,
  init?: RequestInit & { query?: Record<string, string | undefined> },
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${unipileBaseUrl()}${path.startsWith("/") ? "" : "/"}${path}`);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }
  const { query: _q, ...rest } = init || {};
  const isFormData = typeof FormData !== "undefined" && rest.body instanceof FormData;
  const res = await fetch(url.toString(), {
    ...rest,
    headers: {
      accept: "application/json",
      ...(isFormData ? {} : { "content-type": "application/json" }),
      "X-API-KEY": apiKey(),
      ...(rest.headers || {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.message || json?.error || json?.title || text || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return json as T;
}

const v2MessagingDisabledAccounts = new Set<string>();

function markV2MessagingUnavailable(accountId: string) {
  v2MessagingDisabledAccounts.add(accountId.trim());
}

export function isV2MessagingDisabled(accountId: string): boolean {
  return v2MessagingDisabledAccounts.has(accountId.trim());
}

export async function createInstagramAuthLink(params: {
  redirectUri: string;
  notifyUrl?: string;
  expiresOn: string;
  name?: string;
}): Promise<{ url: string }> {
  const body: Record<string, unknown> = {
    type: "create",
    providers: ["INSTAGRAM"],
    api_url: unipileBaseUrl(),
    expiresOn: params.expiresOn,
    success_redirect_url: params.redirectUri,
    failure_redirect_url: params.redirectUri,
    name: params.name || "Instagram",
    config: {
      instagram: {
        allow_methods: ["credentials", "cookies"],
      },
    },
  };
  if (params.notifyUrl) body.notify_url = params.notifyUrl;

  const data = await unipileFetch<any>("/api/v1/hosted/accounts/link", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const url = data?.url || data?.data?.url || data?.link;
  if (!url) throw new Error("Unipile did not return auth URL");
  return { url };
}

export async function listAccounts(): Promise<any[]> {
  const data = await unipileFetch<any>("/api/v1/accounts");
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export async function getAccount(accountId: string): Promise<any> {
  return await unipileFetch<any>(`/api/v1/accounts/${encodeURIComponent(accountId)}`);
}

function accountIgIdentifiers(account: any, accountId: string): string[] {
  const ids: string[] = [];
  const push = (v: unknown) => {
    const s = String(v || "").trim().replace(/^@/, "");
    if (s && !ids.includes(s)) ids.push(s);
  };
  push(account?.connection_params?.username);
  push(account?.connection_params?.id);
  push(account?.connection_params?.user_id);
  push(account?.connection_params?.im?.id);
  push(account?.username);
  push(account?.name);
  push(account?.provider_id);
  push(account?.sources?.[0]?.id);
  push("me");
  push(accountId);
  return ids;
}

/** Canonical post id for comments/replies API. */
export function igCommentsPostId(p: any): string {
  if (p?.object === "Post") return String(p.id || "").trim();
  return String(
    p?.provider_id ||
      p?.social_id ||
      p?.specifics?.instagram?.provider_id ||
      p?.specifics?.instagram?.media_id ||
      p?.id ||
      p?.post_id ||
      "",
  ).trim();
}

function extractTextField(raw: unknown, max = 200): string {
  if (typeof raw === "string") return raw.slice(0, max);
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const nested = o.text ?? o.caption ?? o.body ?? o.content ?? o.message ?? "";
    if (typeof nested === "string") return nested.slice(0, max);
  }
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === "string" ? x : (x as any)?.text || ""))
      .filter(Boolean)
      .join(" ")
      .slice(0, max);
  }
  return "";
}

function extractPostCaption(p: any): string {
  return extractTextField(p?.text ?? p?.caption ?? p?.title ?? p?.description ?? "", 200);
}

export function extractCommentText(c: any): string {
  return extractTextField(c?.text ?? c?.message ?? c?.body ?? c?.content ?? "", 2000);
}

function mapPostItem(p: any): IgPostSummary | null {
  const commentsPostId = igCommentsPostId(p);
  if (!commentsPostId) return null;
  const displayId = String(p.id || commentsPostId);
  const caption = extractPostCaption(p);
  const created = p.created_at || p.parsed_datetime || p.date || p.timestamp;
  const thumb =
    (typeof p.preview_image === "string" ? p.preview_image : p.preview_image?.url) ||
    p.attachments?.[0]?.url ||
    p.attachments?.[0]?.thumbnail_url ||
    p.thumbnail_url ||
    p.picture_url ||
    undefined;
  const shortcode =
    p.shortcode ||
    p.specifics?.instagram?.shortcode ||
    (typeof p.share_url === "string"
      ? p.share_url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i)?.[1]
      : null) ||
    undefined;
  return {
    id: displayId,
    commentsPostId,
    caption,
    created_at: created ? String(created) : undefined,
    thumbnail_url: thumb ? String(thumb) : undefined,
    shortcode: shortcode ? String(shortcode) : undefined,
  };
}

function mapPostsPayload(data: any): IgPostSummary[] {
  const items =
    data?.data ||
    data?.items ||
    data?.posts ||
    (Array.isArray(data) ? data : []);
  return (items as any[]).map(mapPostItem).filter((p): p is IgPostSummary => Boolean(p));
}

export type IgPostSummary = {
  id: string;
  commentsPostId: string;
  caption: string;
  created_at?: string;
  thumbnail_url?: string;
  shortcode?: string;
};

export async function listOwnPosts(accountId: string, limit = 30): Promise<IgPostSummary[]> {
  const accId = await resolveUnipileAccountId(accountId);
  const v2AccId = await resolveUnipileV2AccountId(accountId);
  if (v2AccId) {
    try {
      const data = await unipileFetch<any>(`/v2/${encodeURIComponent(v2AccId)}/users/me/posts`, {
        query: { limit: String(limit) },
      });
      const mapped = mapPostsPayload(data);
      if (mapped.length) return mapped;
    } catch {
      // fall through to v1
    }
  }

  let account: any = null;
  try {
    account = await getAccount(accountId);
  } catch {
    account = null;
  }
  const identifiers = accountIgIdentifiers(account, accountId);
  const errors: string[] = [];

  for (const identifier of identifiers) {
    try {
      const data = await unipileFetch<any>(`/api/v1/users/${encodeURIComponent(identifier)}/posts`, {
        query: { account_id: accId, limit: String(limit) },
      });
      const mapped = mapPostsPayload(data);
      if (mapped.length) return mapped;
    } catch (e: any) {
      errors.push(`${identifier}: ${e?.message || e}`);
    }
  }

  if (errors.length) {
    throw new Error(
      `Не удалось загрузить посты. Пробовали: ${identifiers.join(", ")}. Ошибки: ${errors.slice(0, 3).join(" | ")}`,
    );
  }
  return [];
}

export function extractIgShortcode(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const m = raw.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i);
  if (m?.[1]) return m[1];
  if (/^[A-Za-z0-9_-]{5,20}$/.test(raw) && !raw.includes("/")) return raw;
  return null;
}

function toUnipileV2AccountId(accountIdV1: string): string {
  const id = (accountIdV1 || "").trim();
  if (!id) return id;
  if (/^acc_/.test(id)) return id;
  return `acc_${id}`;
}

export async function resolveUnipileV2AccountId(storedId: string): Promise<string> {
  const id = (storedId || "").trim();
  if (!id) return id;
  const v1IdInput = id.replace(/^acc_/, "");
  try {
    const accounts = await listAccounts();
    const match = accounts.find(
      (a) =>
        String(a.id || "").trim() === id ||
        String(a.id || "").trim() === v1IdInput ||
        String(a.account_id || "").trim() === id ||
        String(a.account_id || "").trim() === v1IdInput,
    );
    const v2Acc = String(match?.account_id || match?.id || "").trim();
    if (!v2Acc) return toUnipileV2AccountId(v1IdInput);
    return toUnipileV2AccountId(v2Acc.replace(/^acc_/, ""));
  } catch {
    return toUnipileV2AccountId(v1IdInput);
  }
}

export async function resolveUnipileAccountId(storedId: string): Promise<string> {
  const id = storedId.trim();
  if (!id) return id;
  const v1IdInput = id.replace(/^acc_/, "");
  try {
    const accounts = await listAccounts();
    const match = accounts.find(
      (a) =>
        String(a.id || "").trim() === id ||
        String(a.id || "").trim() === v1IdInput ||
        String(a.account_id || "").trim() === id ||
        String(a.account_id || "").trim() === v1IdInput,
    );
    const v1Acc = String(match?.id || match?.account_id || v1IdInput).trim();
    return v1Acc.replace(/^acc_/, "");
  } catch {
    return v1IdInput;
  }
}

export async function fetchIgPostRaw(accountId: string, postIdOrShortcode: string): Promise<any> {
  const v1AccId = await resolveUnipileAccountId(accountId);
  const v2AccId = await resolveUnipileV2AccountId(accountId);
  if (v2AccId) {
    try {
      return await unipileFetch<any>(
        `/v2/${encodeURIComponent(v2AccId)}/posts/${encodeURIComponent(postIdOrShortcode)}`,
      );
    } catch {
      // fall through to v1
    }
  }
  return await unipileFetch<any>(`/api/v1/posts/${encodeURIComponent(postIdOrShortcode)}`, {
    query: { account_id: v1AccId },
  });
}

export async function resolveIgPost(
  accountId: string,
  urlOrShortcodeOrId: string,
): Promise<IgPostSummary> {
  const shortcode = extractIgShortcode(urlOrShortcodeOrId);
  const candidates = [shortcode, urlOrShortcodeOrId.trim()].filter(Boolean) as string[];
  const tried = new Set<string>();
  let lastErr = "";

  for (const candidate of candidates) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    try {
      const data = await fetchIgPostRaw(accountId, candidate);
      const mapped = mapPostItem(data);
      if (!mapped) throw new Error("empty post id in response");
      return mapped;
    } catch (e: any) {
      lastErr = e?.message || String(e);
    }
  }
  throw new Error(lastErr || "Пост не найден в Unipile");
}

export type IgCanonicalIds = {
  commentUnipileId: string | null;
  authorProfileId: string | null;
  authorMessagingIdentifier: string | null;
  dedupeUserId: string | null;
  chatId: string | null;
  isSyntheticCommentId: boolean;
  raw: Record<string, string | null>;
};

export type IgComment = {
  /** Local dedupe key for ig_comment_actions — may be synthetic when Unipile id is missing */
  id: string;
  commentUnipileId: string | null;
  text?: string;
  username?: string;
  created_at?: string;
  ids: IgCanonicalIds;
};

function pickStr(...values: unknown[]): string | null {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return null;
}

export async function resolveInstagramDmRecipient(
  accountId: string,
  hints: {
    messagingId?: string | null;
    profileId?: string | null;
    username?: string | null;
  },
): Promise<{ recipientId: string | null; source: string }> {
  const messagingId = pickStr(hints.messagingId);
  if (messagingId) return { recipientId: messagingId, source: "comment.messaging_id" };

  const v1AccId = await resolveUnipileAccountId(accountId);
  const lookupIds = [
    pickStr(hints.profileId),
    pickStr(hints.username?.replace(/^@/, "")),
  ].filter(Boolean) as string[];

  for (const identifier of lookupIds) {
    try {
      const data = await unipileFetch<any>(`/api/v1/users/${encodeURIComponent(identifier)}`, {
        query: { account_id: v1AccId },
      });
      const resolved = pickStr(
        data.provider_messaging_id,
        data.messaging_identifier,
        data.messaging_id,
        data.specifics?.instagram?.provider_messaging_id,
      );
      if (resolved) return { recipientId: resolved, source: `users/${identifier}:provider_messaging_id` };
    } catch {
      // try next identifier
    }
  }

  return { recipientId: null, source: "none" };
}

function localCommentDedupeKey(c: any, text: string): string {
  const author = c.username || c.author?.username || c.author_id || c.user_id || "anon";
  const ts = c.created_at || c.date || c.timestamp || "";
  const base = `${author}:${text.slice(0, 120)}:${ts}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return `local_${h.toString(16)}`;
}

export function extractCommentCanonicalIds(c: any, text = extractCommentText(c)): IgCanonicalIds {
  const author = c?.author || {};
  const commentUnipileId = pickStr(c.id, c.comment_id, c.provider_id, c.pk, c.social_id);
  const authorMessagingIdentifier = pickStr(
    author.provider_messaging_id,
    c.provider_messaging_id,
    c.messaging_id,
    c.attendee_id,
    author.messaging_identifier,
    author.messaging_id,
    c.author?.messaging_identifier,
  );
  const authorProfileId = pickStr(c.author_id, c.user_id, author.id, author.provider_id, author.user_id);
  const dedupeUserId = authorProfileId || authorMessagingIdentifier;
  const chatId = authorMessagingIdentifier;
  const isSyntheticCommentId = !commentUnipileId;
  return {
    commentUnipileId,
    authorProfileId,
    authorMessagingIdentifier,
    dedupeUserId,
    chatId,
    isSyntheticCommentId,
    raw: {
      comment_id: pickStr(c.comment_id),
      id: pickStr(c.id),
      provider_id: pickStr(c.provider_id),
      author_id: pickStr(c.author_id),
      user_id: pickStr(c.user_id),
      attendee_id: pickStr(c.attendee_id),
      messaging_id: pickStr(c.messaging_id),
      provider_messaging_id: pickStr(c.provider_messaging_id, author.provider_messaging_id),
      author_messaging_identifier: pickStr(author.messaging_identifier),
      author_messaging_id: pickStr(author.messaging_id),
      author_profile_id: pickStr(author.id, author.provider_id),
    },
  };
}

/** Collect post identifiers — prefer stored canonical comments_post_id when provided. */
export async function resolvePostIdCandidates(
  accountId: string,
  postId: string,
  shortcode?: string | null,
  canonicalCommentsPostId?: string | null,
): Promise<string[]> {
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = String(v ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  };

  if (canonicalCommentsPostId) push(canonicalCommentsPostId);
  push(postId);
  push(shortcode);

  if (canonicalCommentsPostId && canonicalCommentsPostId === postId) {
    return out;
  }

  const tryRaw = (raw: any) => {
    push(igCommentsPostId(raw));
    push(raw?.social_id);
    push(raw?.provider_id);
    push(raw?.id);
    push(raw?.specifics?.instagram?.provider_id);
    push(raw?.specifics?.instagram?.id);
    push(raw?.specifics?.instagram?.media_id);
    if (typeof raw?.share_url === "string") {
      push(extractIgShortcode(raw.share_url));
    }
  };

  for (const key of [postId, shortcode].filter(Boolean)) {
    try {
      tryRaw(await fetchIgPostRaw(accountId, key!));
    } catch {
      // ignore
    }
  }

  return out;
}

function commentItemsFromPayload(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  const buckets = [
    data.items,
    data.data,
    data.comments,
    data.results,
    data.object === "Comment" ? [data] : null,
  ];
  for (const b of buckets) {
    if (Array.isArray(b) && b.length) return b;
  }
  return [];
}

function mapCommentItem(c: any): IgComment | null {
  const text = extractCommentText(c);
  const ids = extractCommentCanonicalIds(c, text);
  const id = ids.commentUnipileId || localCommentDedupeKey(c, text);
  if (!id) return null;
  const author = c.author;
  return {
    id,
    commentUnipileId: ids.commentUnipileId,
    text,
    username: c.username || author?.username || author?.name || author?.display_name || "",
    created_at: c.created_at || c.date || c.timestamp || c.parsed_datetime,
    ids,
  };
}

async function fetchCommentsPage(
  accountId: string,
  postId: string,
  cursor?: string,
): Promise<{ items: any[]; nextCursor?: string; error?: string; path?: string }> {
  const v1AccId = await resolveUnipileAccountId(accountId);
  const v2AccId = await resolveUnipileV2AccountId(accountId);
  const v1Query: Record<string, string | undefined> = { account_id: v1AccId, limit: "50" };
  if (cursor) v1Query.cursor = cursor;

  const attempts: { path: string; query?: Record<string, string | undefined> }[] = [];
  if (v2AccId) {
    attempts.push({
      path: `/v2/${encodeURIComponent(v2AccId)}/posts/${encodeURIComponent(postId)}/comments`,
      query: { limit: "50", sort_by: "MOST_RECENT", cursor },
    });
  }
  attempts.push({ path: `/api/v1/posts/${encodeURIComponent(postId)}/comments`, query: v1Query });

  let lastErr = "";
  for (const { path, query } of attempts) {
    try {
      const data = await unipileFetch<any>(path, { query });
      const items = commentItemsFromPayload(data);
      const next = data?.cursor || data?.next_cursor || data?.paging?.next_cursor;
      return { items, nextCursor: next ? String(next) : undefined, path };
    } catch (e: any) {
      lastErr = e?.message || String(e);
    }
  }
  return { items: [], error: lastErr };
}

export type CommentsFetchDebug = {
  postIdTried: string;
  count: number;
  error?: string;
  path?: string;
  sample?: {
    id: string;
    commentUnipileId: string | null;
    text: string;
    username: string;
    dedupeUserId: string | null;
    dmRecipientId: string | null;
    isSyntheticCommentId: boolean;
    rawIds?: Record<string, string | null>;
  };
};

export async function listPostComments(
  accountId: string,
  postId: string,
  opts?: {
    maxPages?: number;
    shortcode?: string | null;
    canonicalCommentsPostId?: string | null;
    debug?: CommentsFetchDebug[];
  },
): Promise<IgComment[]> {
  const maxPages = opts?.maxPages ?? 3;
  const candidates = await resolvePostIdCandidates(
    accountId,
    postId,
    opts?.shortcode,
    opts?.canonicalCommentsPostId,
  );
  const all: IgComment[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    let cursor: string | undefined;
    let foundOnThis = 0;

    for (let page = 0; page < maxPages; page++) {
      const { items, nextCursor, error, path } = await fetchCommentsPage(accountId, candidate, cursor);
      if (opts?.debug && page === 0) {
        const first = items[0];
        const mapped = first ? mapCommentItem(first) : null;
        opts.debug.push({
          postIdTried: candidate,
          count: items.length,
          error,
          path,
          sample: mapped
            ? {
                id: mapped.id,
                commentUnipileId: mapped.commentUnipileId,
                text: (mapped.text || "").slice(0, 80),
                username: mapped.username || "",
                dedupeUserId: mapped.ids.dedupeUserId,
                dmRecipientId: mapped.ids.authorMessagingIdentifier,
                isSyntheticCommentId: mapped.ids.isSyntheticCommentId,
                rawIds: mapped.ids.raw,
              }
            : undefined,
        });
      }

      for (const c of items) {
        const mapped = mapCommentItem(c);
        if (mapped && !seen.has(mapped.id)) {
          seen.add(mapped.id);
          all.push(mapped);
          foundOnThis++;
        }
      }

      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    if (foundOnThis > 0) break;
  }

  return all;
}

export type IgOutgoingAttachment = {
  filename: string;
  contentType: string;
  contentBase64: string;
};

function buildV1ChatFormData(params: {
  accountId: string;
  attendeeId?: string;
  text: string;
  attachment?: IgOutgoingAttachment | null;
}): FormData {
  const form = new FormData();
  form.append("account_id", params.accountId);
  form.append("text", params.text);
  if (params.attendeeId) {
    // https://developer.unipile.com/docs/send-messages — attendees_ids for Instagram = provider_messaging_id
    form.append("attendees_ids", params.attendeeId);
  }
  if (params.attachment) {
    const bytes = Buffer.from(params.attachment.contentBase64, "base64");
    const blob = new Blob([bytes], { type: params.attachment.contentType || "application/octet-stream" });
    // https://developer.unipile.com/docs/send-messages — multipart field is "attachments"
    form.append("attachments", blob, params.attachment.filename);
  }
  return form;
}

export function isInstagramDmBlockedError(error: unknown): boolean {
  const msg = String((error as any)?.message || error || "").toLowerCase();
  if (!msg) return false;
  return [
    "can't message this account",
    "cannot message this account",
    "can't send messages",
    "cannot send messages",
    "not allowed to message",
    "user is unavailable",
    "recipient is unavailable",
    "privacy",
    "closed direct",
    "direct is disabled",
    "forbidden",
    "422",
  ].some((needle) => msg.includes(needle));
}

export function isRetryableInstagramDmError(error: unknown): boolean {
  const msg = String((error as any)?.message || error || "").toLowerCase();
  if (!msg) return false;
  return [
    "504 gateway time-out",
    "gateway time-out",
    "request timed out",
    "request_timeout",
    "timeout",
    "temporarily unavailable",
    "service unavailable",
    "bad gateway",
    "internal server error",
    "503",
  ].some((needle) => msg.includes(needle));
}

export function isPermanentInstagramDmSchemaError(error: unknown): boolean {
  const msg = String((error as any)?.message || error || "").toLowerCase();
  if (!msg) return false;
  return [
    "invalid parameters",
    "unexpected field",
    "cannot post /v2/",
    "bad request",
    "400",
    "415",
  ].some((needle) => msg.includes(needle));
}

export type DmSendResult = {
  route: string;
  response: any;
  attachmentSent: boolean;
  attachmentError?: string;
};

async function sendV1StartChat(params: {
  accountId: string;
  recipientId: string;
  text: string;
  attachment?: IgOutgoingAttachment | null;
}): Promise<any> {
  const v1AccId = await resolveUnipileAccountId(params.accountId);
  return await unipileFetch(`/api/v1/chats`, {
    method: "POST",
    body: buildV1ChatFormData({
      accountId: v1AccId,
      attendeeId: params.recipientId,
      text: params.text,
      attachment: params.attachment,
    }),
  });
}

async function sendV1ExistingChatMessage(params: {
  accountId: string;
  chatId: string;
  text: string;
  attachment?: IgOutgoingAttachment | null;
}): Promise<any> {
  const v1AccId = await resolveUnipileAccountId(params.accountId);
  return await unipileFetch(`/api/v1/chats/${encodeURIComponent(params.chatId)}/messages`, {
    method: "POST",
    query: { account_id: v1AccId },
    body: buildV1ChatFormData({
      accountId: v1AccId,
      text: params.text,
      attachment: params.attachment,
    }),
  });
}

export type DmSendMode = "initial" | "retry" | "attachment_only";

async function sendV2StartChat(params: {
  accountId: string;
  recipientId: string;
  text: string;
  attachment?: IgOutgoingAttachment | null;
}): Promise<any> {
  const v2AccId = await resolveUnipileV2AccountId(params.accountId);
  return await unipileFetch(`/v2/${encodeURIComponent(v2AccId)}/chats`, {
    method: "POST",
    body: JSON.stringify({
      user_ids: [params.recipientId],
      text: params.text,
      ...(params.attachment
        ? {
            attachments: [
              {
                content: params.attachment.contentBase64,
                content_type: params.attachment.contentType,
                filename: params.attachment.filename,
              },
            ],
          }
        : {}),
    }),
  });
}

export async function replyToInstagramComment(params: {
  accountId: string;
  postId: string;
  commentId: string;
  text: string;
}): Promise<{ route: string; response: any }> {
  if (!params.commentId || params.commentId.startsWith("local_")) {
    throw new Error("Missing Unipile comment id for reply");
  }
  const v1AccId = await resolveUnipileAccountId(params.accountId);
  const v2AccId = await resolveUnipileV2AccountId(params.accountId);
  try {
    const response = await unipileFetch(
      `/v2/${encodeURIComponent(v2AccId)}/posts/${encodeURIComponent(params.postId)}/comments/${encodeURIComponent(params.commentId)}`,
      {
        method: "POST",
        body: JSON.stringify({ text: params.text }),
      },
    );
    return { route: "v2:replyToComment", response };
  } catch {
    const response = await unipileFetch(`/api/v1/posts/${encodeURIComponent(params.postId)}/comments`, {
      method: "POST",
      body: JSON.stringify({
        account_id: v1AccId,
        text: params.text,
        comment_id: params.commentId,
      }),
    });
    return { route: "v1:replyToComment", response };
  }
}

export async function sendInstagramDm(params: {
  accountId: string;
  attendeeId: string;
  text: string;
  attachment?: IgOutgoingAttachment | null;
  mode?: DmSendMode;
}): Promise<DmSendResult> {
  const recipientId = params.attendeeId.trim();
  if (!recipientId) throw new Error("Missing Instagram provider_messaging_id for DM");

  const mode = params.mode || "initial";
  const attachment = params.attachment;
  const text = params.text || "";
  const errors: string[] = [];

  // Instagram 1:1 chat_id === provider_messaging_id
  // https://developer.unipile.com/v2.0/docs/instagram-send-messages

  if (mode === "attachment_only") {
    if (!attachment) throw new Error("Attachment required for attachment_only mode");
    const response = await sendV1ExistingChatMessage({
      accountId: params.accountId,
      chatId: recipientId,
      text: "",
      attachment,
    });
    return { route: "v1:messages:attachment", response, attachmentSent: true };
  }

  if (mode === "retry") {
    try {
      const response = await sendV1ExistingChatMessage({
        accountId: params.accountId,
        chatId: recipientId,
        text,
        attachment,
      });
      return { route: "v1:messages:retry", response, attachmentSent: Boolean(attachment) };
    } catch (e: any) {
      throw new Error(`DM retry failed: ${e?.message || e}`);
    }
  }

  // Initial send: one multipart POST /api/v1/chats with text + attachments
  // https://developer.unipile.com/docs/send-messages
  try {
    const response = await sendV1StartChat({
      accountId: params.accountId,
      recipientId,
      text,
      attachment,
    });
    return { route: "v1:startChat", response, attachmentSent: Boolean(attachment) };
  } catch (e1: any) {
    errors.push(`v1 startChat: ${e1?.message || e1}`);
  }

  // Chat may already exist — prefer chat_id when known
  try {
    const response = await sendV1ExistingChatMessage({
      accountId: params.accountId,
      chatId: recipientId,
      text,
      attachment,
    });
    return { route: "v1:messages", response, attachmentSent: Boolean(attachment) };
  } catch (e2: any) {
    errors.push(`v1 messages: ${e2?.message || e2}`);
  }

  if (!isV2MessagingDisabled(params.accountId)) {
    try {
      const response = await sendV2StartChat({ ...params, recipientId, text });
      return { route: "v2:startChat", response, attachmentSent: Boolean(attachment) };
    } catch (e3: any) {
      const msg = e3?.message || String(e3);
      errors.push(`v2 startChat: ${msg}`);
      if (/cannot post \/v2\//i.test(msg)) {
        markV2MessagingUnavailable(params.accountId);
      }
    }
  }

  throw new Error(`DM send failed. ${errors.join("; ")}`);
}

export function verifyUnipileWebhookSignature(_rawBody: string, _signatureHeader: string | null): boolean {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.warn("[unipile] UNIPILE_WEBHOOK_SECRET not set — skipping signature check");
    return true;
  }
  if (!_signatureHeader) return false;
  if (_signatureHeader === secret) return true;
  try {
    const expected = createHmac("sha256", secret).update(_rawBody).digest("hex");
    return (
      _signatureHeader === expected ||
      _signatureHeader === `sha256=${expected}` ||
      _signatureHeader.toLowerCase() === expected.toLowerCase()
    );
  } catch {
    return false;
  }
}
