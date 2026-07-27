/**
 * Unipile API client (Instagram).
 * Docs: https://developer.unipile.com/
 *
 * Env:
 * - UNIPILE_DSN — host like api1.unipile.com:13111 (no https://)
 * - UNIPILE_API_KEY — access token
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
    // Credentials OTP often fails on IG; cookies (sessionid) is the reliable path
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
  // last resort — sometimes docs allow account id context only with username
  push(accountId);
  return ids;
}

function extractPostCaption(p: any): string {
  const raw = p?.text ?? p?.caption ?? p?.title ?? p?.description ?? "";
  if (typeof raw === "string") return raw.slice(0, 200);
  if (raw && typeof raw === "object") {
    const nested =
      raw.text ?? raw.caption ?? raw.body ?? raw.content ?? raw.message ?? "";
    if (typeof nested === "string") return nested.slice(0, 200);
  }
  // Sometimes caption is array of text runs
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === "string" ? x : x?.text || ""))
      .filter(Boolean)
      .join(" ")
      .slice(0, 200);
  }
  return "";
}

function mapPostsPayload(data: any): IgPostSummary[] {
  const items = data?.items || data?.data || data?.posts || (Array.isArray(data) ? data : []);
  return (items as any[])
    .map((p) => {
      const id = String(p.id || p.provider_id || p.social_id || p.post_id || "");
      const caption = extractPostCaption(p);
      const created = p.created_at || p.parsed_datetime || p.date || p.timestamp;
      const thumb =
        (typeof p.preview_image === "string" ? p.preview_image : p.preview_image?.url) ||
        p.attachments?.[0]?.url ||
        p.attachments?.[0]?.thumbnail_url ||
        p.thumbnail_url ||
        p.picture_url ||
        undefined;
      return {
        id,
        caption,
        created_at: created ? String(created) : undefined,
        thumbnail_url: thumb ? String(thumb) : undefined,
      };
    })
    .filter((p) => p.id);
}

export type IgPostSummary = {
  id: string;
  caption: string;
  created_at?: string;
  thumbnail_url?: string;
};

/** Own feed posts — try username / provider_id / me until Unipile returns items. */
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

/** Instagram URL or shortcode → Unipile provider post id (needed for comments). */
export function extractIgShortcode(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const m = raw.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i);
  if (m?.[1]) return m[1];
  if (/^[A-Za-z0-9_-]{5,20}$/.test(raw) && !raw.includes("/")) return raw;
  return null;
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
      const data = await unipileFetch<any>(`/api/v1/posts/${encodeURIComponent(candidate)}`, {
        query: { account_id: accountId },
      });
      const id = String(data?.id || data?.provider_id || data?.social_id || candidate);
      const caption = String(data?.text || data?.caption || "").slice(0, 200);
      if (!id) throw new Error("empty post id in response");
      return { id, caption, created_at: data?.parsed_datetime || data?.date };
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
  author?: { id?: string; username?: string; provider_id?: string };
  user_id?: string;
  username?: string;
  created_at?: string;
};

export async function listPostComments(accountId: string, postId: string): Promise<IgComment[]> {
  // DSN API (common): GET /api/v1/posts/{post_id}/comments?account_id=
  // Some docs show: GET /api/v1/accounts/{account_id}/posts/{post_id}/comments
  let data: any;
  try {
    data = await unipileFetch<any>(`/api/v1/posts/${encodeURIComponent(postId)}/comments`, {
      query: { account_id: accountId },
    });
  } catch {
    data = await unipileFetch<any>(
      `/api/v1/accounts/${encodeURIComponent(accountId)}/posts/${encodeURIComponent(postId)}/comments`,
    );
  }
  const items = data?.items || data?.data || data?.comments || (Array.isArray(data) ? data : []);
  return (items as any[])
    .map((c) => ({
      id: String(c.id || c.comment_id || ""),
      text: c.text || c.message || c.body || "",
      author_id: String(
        c.author_id || c.user_id || c.author?.id || c.author?.provider_id || c.author?.user_id || "",
      ),
      author: c.author,
      username: c.username || c.author?.username || c.author?.name || "",
      created_at: c.created_at || c.date || c.timestamp,
    }))
    .filter((c) => c.id);
}

/** Start a new DM or send into existing chat. */
export async function sendInstagramDm(params: {
  accountId: string;
  /** Recipient messaging identifier / provider user id */
  attendeeId: string;
  text: string;
}): Promise<any> {
  // Prefer start new chat with attendees
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
    // Fallback: some accounts use messaging_id as chat_id
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
    // If no secret configured, accept in dev but log
    console.warn("[unipile] UNIPILE_WEBHOOK_SECRET not set — skipping signature check");
    return true;
  }
  // Unipile signs with webhook endpoint secret; exact algorithm varies by version.
  // Accept matching header value or HMAC if provided as hex.
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
