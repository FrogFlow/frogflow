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

export type IgPostSummary = {
  id: string;
  caption: string;
  created_at?: string;
  thumbnail_url?: string;
};

/** Own feed posts for the connected IG account (user_id = me). */
export async function listOwnPosts(accountId: string, limit = 30): Promise<IgPostSummary[]> {
  let data: any;
  try {
    data = await unipileFetch<any>(`/api/v1/users/me/posts`, {
      query: { account_id: accountId, limit: String(limit) },
    });
  } catch {
    // Fallback: some setups want the account's provider username as identifier
    data = await unipileFetch<any>(`/api/v1/users/${encodeURIComponent(accountId)}/posts`, {
      query: { account_id: accountId, limit: String(limit) },
    });
  }
  const items = data?.items || data?.data || data?.posts || (Array.isArray(data) ? data : []);
  return (items as any[])
    .map((p) => {
      const id = String(p.id || p.provider_id || p.post_id || "");
      const caption = String(p.text || p.caption || p.title || "").slice(0, 200);
      const created = p.created_at || p.date || p.timestamp;
      const thumb =
        p.preview_image?.url ||
        p.attachments?.[0]?.url ||
        p.attachments?.[0]?.thumbnail_url ||
        p.thumbnail_url ||
        undefined;
      return { id, caption, created_at: created ? String(created) : undefined, thumbnail_url: thumb };
    })
    .filter((p) => p.id);
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
