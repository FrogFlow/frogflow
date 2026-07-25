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

export async function tg(method: string, payload: unknown) {
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
      console.warn(`[telegram] ${method} rate limited, retrying after ${retryAfter}s (attempt ${attempt}/${MAX_RETRIES})`);
      if (attempt < MAX_RETRIES) {
        await sleep(retryAfter * 1000);
        continue;
      }
    }

    if (!res.ok || (data && data.ok === false)) {
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
  files: Array<{ field: string; filename: string; bytes?: Uint8Array; blob?: Blob; contentType?: string }>,
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
      console.warn(`[telegram] ${method} multipart rate limited, retrying after ${retryAfter}s (attempt ${attempt}/${MAX_RETRIES})`);
      if (attempt < MAX_RETRIES) {
        await sleep(retryAfter * 1000);
        continue;
      }
    }

    if (!res.ok || (data && data.ok === false)) {
      console.error(`[telegram] ${method} multipart failed`, res.status, data);
    }
    return data as { ok: boolean; result?: unknown; description?: string };
  }
  return { ok: false } as { ok: boolean; result?: unknown; description?: string };
}

export async function downloadTelegramFile(file_id: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
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
