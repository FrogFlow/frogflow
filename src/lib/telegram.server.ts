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

/**
 * Централизованное логирование чата с менеджером (registry.ts:
 * manager_chat). У бота нет единой точки, через которую проходят все
 * автоответы — switch(menuAction) и обработчики callback-кнопок в
 * bot.server.ts разбросаны по файлу на тысячи строк, — а tg() наоборот,
 * единственная точка, через которую проходит буквально любая отправка
 * sendMessage. Поэтому лог исходящих реплик бота живёт здесь, а не в
 * каждом месте, где бот что-то отвечает.
 *
 * Фильтр — позитивный, а не «список ID админов»: логируем только когда
 * chat_id уже есть в bot_users этого бота (значит это отслеживаемый
 * клиент). Уведомления на admin_chat_id почти всегда мимо этого фильтра,
 * потому что админ обычно не оформлял заказ через тот же Telegram ID —
 * но не гарантированно: если оператор сам когда-то протестировал бота под
 * тем же ID, что указан как admin_chat_id, эти уведомления попадут в
 * список переписок как «разговор с самим собой». Известное, принятое
 * ограничение v1 — не приватностный риск (это его собственные данные в
 * его собственной панели), не решается сейчас.
 *
 * hasModule — первая проверка и самая дешёвая (кеш 60с в модуле modules),
 * чтобы боты без этого модуля не платили лишним походом в базу на каждый
 * sendMessage.
 *
 * Помимо sendMessage логируются sendPhoto/sendDocument (карточки товаров,
 * файлы) — у них текст лежит в caption, а не в text. Без этого в
 * /admin/manager-chat пропадали все ответы бота с картинкой (например,
 * карточка товара с кнопкой «В корзину»).
 */
const OUTBOUND_LOG_METHODS = new Set(["sendMessage", "sendPhoto", "sendDocument"]);

async function logOutboundIfCustomer(method: string, payload: unknown): Promise<void> {
  if (!OUTBOUND_LOG_METHODS.has(method)) return;
  if (typeof payload !== "object" || payload === null) return;
  const chatId = (payload as { chat_id?: unknown }).chat_id;
  const text =
    (payload as { text?: unknown; caption?: unknown }).text ??
    (payload as { caption?: unknown }).caption;
  if (typeof chatId !== "number" || typeof text !== "string" || !text) return;

  try {
    const { hasModule } = await import("./modules/modules.server");
    if (!(await hasModule("manager_chat"))) return;

    const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
    const { data: known } = await supabaseAdmin
      .from("bot_users")
      .select("telegram_id")
      .eq("telegram_id", chatId)
      .maybeSingle();
    if (!known) return;

    const { recordMessage } = await import("./manager-chat.server");
    await recordMessage({ telegramId: chatId, direction: "out", sender: "bot", text });
  } catch (e) {
    console.error("[manager-chat] outbound auto-log failed", e);
  }
}

export async function tg(method: string, payload: unknown, opts?: { skipChatLog?: boolean }) {
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
    if (data?.ok !== false && !opts?.skipChatLog) {
      await logOutboundIfCustomer(method, payload);
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
