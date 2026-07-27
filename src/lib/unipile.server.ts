/**
 * Unipile API client (Instagram).
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
  const res = await fetch(url.toString(), {
    ...rest,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
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

/** ID for comments API — Instagram needs provider_id, not display id. */
export function igCommentsPostId(p: any): string {
  return String(
    p?.provider_id ||
      p?.social_id ||
      p?.specifics?.instagram?.provider_id ||
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
  const items = data?.items || data?.data || data?.posts || (Array.isArray(data) ? data : []);
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
        query: { account_id: accountId, limit: String(limit) },
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

export async function fetchIgPostRaw(accountId: string, postIdOrShortcode: string): Promise<any> {
  return await unipileFetch<any>(`/api/v1/posts/${encodeURIComponent(postIdOrShortcode)}`, {
    query: { account_id: accountId },
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

export type IgComment = {
  id: string;
  text?: string;
  author_id?: string;
  author?: {
    id?: string;
    username?: string;
    provider_id?: string;
    messaging_id?: string;
    user_id?: string;
  };
  user_id?: string;
  username?: string;
  attendee_id?: string;
  messaging_id?: string;
  created_at?: string;
};

function mapCommentItem(c: any): IgComment | null {
  const id = String(c.id || c.comment_id || "");
  if (!id) return null;
  const text = extractCommentText(c);
  const author = c.author;
  const author_id = String(
    c.author_id ||
      c.user_id ||
      author?.provider_id ||
      author?.messaging_id ||
      author?.id ||
      author?.user_id ||
      c.attendee_id ||
      c.messaging_id ||
      "",
  ).trim();
  return {
    id,
    text,
    author_id,
    author,
    user_id: c.user_id,
    username: c.username || author?.username || author?.name || "",
    attendee_id: c.attendee_id,
    messaging_id: c.messaging_id,
    created_at: c.created_at || c.date || c.timestamp,
  };
}

export async function listPostComments(
  accountId: string,
  postId: string,
  opts?: { maxPages?: number },
): Promise<IgComment[]> {
  const maxPages = opts?.maxPages ?? 3;
  const all: IgComment[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    let data: any;
    const query: Record<string, string | undefined> = { account_id: accountId };
    if (cursor) query.cursor = cursor;

    try {
      data = await unipileFetch<any>(`/api/v1/posts/${encodeURIComponent(postId)}/comments`, { query });
    } catch {
      data = await unipileFetch<any>(
        `/api/v1/accounts/${encodeURIComponent(accountId)}/posts/${encodeURIComponent(postId)}/comments`,
        { query },
      );
    }

    const items = data?.items || data?.data || data?.comments || (Array.isArray(data) ? data : []);
    for (const c of items as any[]) {
      const mapped = mapCommentItem(c);
      if (mapped && !seen.has(mapped.id)) {
        seen.add(mapped.id);
        all.push(mapped);
      }
    }

    const next = data?.cursor || data?.next_cursor || data?.paging?.next_cursor;
    if (!next || next === cursor) break;
    cursor = String(next);
  }

  return all;
}

export async function sendInstagramDm(params: {
  accountId: string;
  attendeeId: string;
  text: string;
}): Promise<any> {
  try {
    return await unipileFetch(`/api/v1/chats`, {
      method: "POST",
      body: JSON.stringify({
        account_id: params.accountId,
        attendees_ids: [params.attendeeId],
        text: params.text,
      }),
    });
  } catch (e1: any) {
    try {
      return await unipileFetch(`/api/v1/chats/${encodeURIComponent(params.attendeeId)}/messages`, {
        method: "POST",
        query: { account_id: params.accountId },
        body: JSON.stringify({ text: params.text }),
      });
    } catch (e2: any) {
      throw new Error(e1?.message || e2?.message || "Failed to send Instagram DM");
    }
  }
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
