/** Telegram Bot API base. Use Local Bot API for files >50MB (up to ~2GB). */
function apiBase(): string {
  return (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
}

function token() {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return t;
}

function botUrl(method: string) {
  return `${apiBase()}/bot${token()}/${method}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type TelegramLocale = "ru" | "kk" | "en" | "uz";
const localeCache = new Map<number, { value: TelegramLocale; expires: number }>();

async function localeForChat(chatId: unknown): Promise<TelegramLocale> {
  const id = Number(chatId);
  if (!Number.isFinite(id)) return "ru";
  const cached = localeCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
    const { data } = await supabaseAdmin
      .from("bot_users")
      .select("state")
      .eq("telegram_id", id)
      .maybeSingle();
    const locale = (data?.state as { locale?: unknown } | null)?.locale;
    const value: TelegramLocale = locale === "kk" || locale === "en" || locale === "uz" ? locale : "ru";
    localeCache.set(id, { value, expires: Date.now() + 5 * 60_000 });
    return value;
  } catch {
    return "ru";
  }
}

async function translate(text: string, locale: TelegramLocale): Promise<string> {
  if (locale === "ru" || !/\p{Script=Cyrillic}/u.test(text)) return text;
  try {
    const query = new URLSearchParams({ client: "gtx", sl: "ru", tl: locale, dt: "t", q: text });
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?${query}`);
    const data = (await response.json()) as Array<Array<[string]>>;
    return data[0]?.map((part) => part[0]).join("") || text;
  } catch {
    return text;
  }
}

/** Localise every customer-facing Telegram payload at the common send boundary. */
async function localizePayload(method: string, payload: unknown): Promise<unknown> {
  if (!/^send(Message|Photo|Video|Document|MediaGroup)$/.test(method) || !payload || typeof payload !== "object") return payload;
  const value = payload as Record<string, unknown>;
  const locale = await localeForChat(value.chat_id);
  if (locale === "ru") return payload;
  const next = { ...value };
  if (typeof next.text === "string") next.text = await translate(next.text, locale);
  if (typeof next.caption === "string") next.caption = await translate(next.caption, locale);
  const markup = next.reply_markup as { keyboard?: Array<Array<{ text?: string }>>; inline_keyboard?: Array<Array<{ text?: string }>> } | undefined;
  if (markup) {
    next.reply_markup = structuredClone(markup);
    for (const row of [...(next.reply_markup.keyboard ?? []), ...(next.reply_markup.inline_keyboard ?? [])]) {
      for (const button of row) if (button.text) button.text = await translate(button.text, locale);
    }
  }
  return next;
}

export async function tg(method: string, payload: unknown) {
  payload = await localizePayload(method, payload);
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(botUrl(method), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error(`[tg] fetch error on ${method}:`, e);
      await sleep(1000 * attempt);
      continue;
    }
    const data = await res.json().catch(() => ({}));

    // Telegram rate limit — wait Retry-After and try again
    if (res.status === 429) {
      const retryAfter = (data?.parameters?.retry_after as number) || attempt * 2;
      console.warn(
        `[telegram] ${method} rate limited, retrying after ${retryAfter}s (attempt ${attempt}/${MAX_RETRIES})`,
      );
      if (attempt < MAX_RETRIES) {
        await sleep(retryAfter * 1000);
        continue;
      }
    }

    // Telegram's own 5xx (unlike a network failure, this reaches Telegram but
    // it fails there) — retry with backoff same as a dropped connection.
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      console.warn(
        `[telegram] ${method} got ${res.status}, retrying (attempt ${attempt}/${MAX_RETRIES})`,
      );
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 5000));
      continue;
    }

    // editMessageText/editMessageMedia re-rendering onto identical content is
    // an expected no-op, not a real failure worth logging as one.
    const benign =
      typeof data?.description === "string" && /message is not modified/i.test(data.description);

    if ((!res.ok || (data && data.ok === false)) && !benign) {
      console.error(`[telegram] ${method} failed`, res.status, data);
    }
    return data as { ok: boolean; result?: unknown; description?: string };
  }
  return { ok: false } as { ok: boolean; result?: unknown; description?: string };
}

export async function tgSendMultipart(
  method: string,
  fields: Record<string, string | number>,
  file: { field: string; filename: string; bytes?: Uint8Array; blob?: Blob; contentType?: string },
) {
  return tgSendMultipartMany(method, fields, [file]);
}

export async function tgSendMultipartMany(
  method: string,
  fields: Record<string, string | number>,
  files: Array<{
    field: string;
    filename: string;
    bytes?: Uint8Array;
    blob?: Blob;
    contentType?: string;
  }>,
) {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    for (const file of files) {
      let b: Blob;
      if (file.blob) {
        b = file.blob;
      } else if (file.bytes) {
        b = new Blob([file.bytes.buffer as ArrayBuffer], { type: file.contentType });
      } else continue;

      fd.append(file.field, b, file.filename);
    }

    let res: Response;
    try {
      res = await fetch(botUrl(method), {
        method: "POST",
        body: fd,
      });
    } catch (e) {
      console.error(`[tgSendMultipartMany] fetch error:`, e);
      await sleep(1000 * attempt);
      continue;
    }
    const data = await res.json().catch(() => ({}));

    // Telegram rate limit — wait Retry-After and try again
    if (res.status === 429) {
      const retryAfter = (data?.parameters?.retry_after as number) || attempt * 2;
      console.warn(
        `[telegram] ${method} multipart rate limited, retrying after ${retryAfter}s (attempt ${attempt}/${MAX_RETRIES})`,
      );
      if (attempt < MAX_RETRIES) {
        await sleep(retryAfter * 1000);
        continue;
      }
    }

    // Telegram's own 5xx — retry with backoff same as a dropped connection.
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      console.warn(
        `[telegram] ${method} multipart got ${res.status}, retrying (attempt ${attempt}/${MAX_RETRIES})`,
      );
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 5000));
      continue;
    }

    if (!res.ok || (data && data.ok === false)) {
      console.error(`[telegram] ${method} multipart failed`, res.status, data);
    }
    return data as { ok: boolean; result?: unknown; description?: string };
  }
  return { ok: false } as { ok: boolean; result?: unknown; description?: string };
}

export async function downloadTelegramFile(
  file_id: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const info = await tg("getFile", { file_id });
  // @ts-expect-error dynamic
  const path = info?.result?.file_path as string | undefined;
  if (!path) return null;
  const res = await fetch(`${apiBase()}/file/bot${token()}/${path}`);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "application/octet-stream";
  return { bytes, mime };
}
