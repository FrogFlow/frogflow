/**
 * Ensure Telegram webhook URL matches this deployment (self-heal if cleared).
 *
 * Two entry points share one job. `ensureTelegramWebhook` talks to a single
 * bot via the shared `tg()` helper (which reads TELEGRAM_BOT_TOKEN itself) —
 * this deployment's own cron. `ensureDidWebhooks` talks to two independent
 * bots — shop and, for clients selling VIP access, a second bot with its own
 * token — so it calls the Telegram API directly per bot instead.
 */

import { tg } from "./telegram.server";

function publicAppOrigin(): string {
  return (
    process.env.PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  ).replace(/\/$/, "");
}

/**
 * Имеет ли этот деплой право распоряжаться вебхуком своего бота.
 *
 * Самовосстановление задумано против случайно сброшенного вебхука, но при двух
 * живых деплоях с одним токеном оно превращается в перетягивание каната: у
 * каждого свой PUBLIC_APP_URL, каждый считает чужой адрес неправильным и
 * возвращает бота себе. Так после переезда клиента старый деплой отбирал бота
 * обратно каждые несколько минут — ловили на Развивашке и на Анастасии.
 *
 * Владельца называет панель: bots.app_url. Если он заполнен и указывает не на
 * нас — молчим. Это делает базу единственным источником истины о том, где
 * живёт бот, ровно как со статусом и модулями.
 *
 * Если app_url пуст (клиента ещё не завели в панели) или прочитать его не
 * вышло — ведём себя как раньше и восстанавливаем вебхук: потерять
 * самолечение из-за недоступной базы хуже, чем изредка перетянуть канат.
 */
async function ownsWebhook(): Promise<{ allowed: boolean; owner: string | null }> {
  const botId = process.env.BOT_ID?.trim();
  const mine = publicAppOrigin();
  if (!botId || !mine) return { allowed: true, owner: null };

  try {
    const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
    const { data } = await supabaseAdmin.from("bots").select("app_url").eq("id", botId).single();
    const owner = (data?.app_url || "").trim().replace(/\/$/, "");
    if (!owner) return { allowed: true, owner: null };
    return { allowed: owner === mine, owner };
  } catch {
    return { allowed: true, owner: null };
  }
}

export function expectedWebhookUrl(): string {
  return `${publicAppOrigin()}/api/public/telegram/webhook`;
}

export type EnsureWebhookResult = {
  ok: boolean;
  action: "unchanged" | "set" | "error" | "not_owner";
  expected: string;
  previousUrl: string;
  currentUrl?: string;
  pending_update_count?: number;
  error?: string;
};

export async function ensureTelegramWebhook(): Promise<EnsureWebhookResult> {
  const expected = expectedWebhookUrl();

  const own = await ownsWebhook();
  if (!own.allowed) {
    return {
      ok: true,
      action: "not_owner",
      expected,
      previousUrl: "",
      error: `Бот закреплён в панели за ${own.owner}, этот деплой вебхук не трогает`,
    };
  }

  try {
    const info = await tg("getWebhookInfo", {});
    if (!info.ok) {
      return {
        ok: false,
        action: "error",
        expected,
        previousUrl: "",
        error: info.description || "getWebhookInfo failed",
      };
    }

    const result = (info.result || {}) as {
      url?: string;
      pending_update_count?: number;
    };
    const previousUrl = (result.url || "").trim();
    const pending = result.pending_update_count ?? 0;

    if (previousUrl === expected) {
      return {
        ok: true,
        action: "unchanged",
        expected,
        previousUrl,
        currentUrl: previousUrl,
        pending_update_count: pending,
      };
    }

    const payload: Record<string, string | boolean> = {
      url: expected,
      drop_pending_updates: false,
    };
    const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
    if (secret) payload.secret_token = secret;

    const set = await tg("setWebhook", payload);
    if (!set.ok) {
      return {
        ok: false,
        action: "error",
        expected,
        previousUrl,
        error: set.description || "setWebhook failed",
      };
    }

    const after = await tg("getWebhookInfo", {});
    const afterUrl = ((after.result as { url?: string } | undefined)?.url || "").trim() || expected;

    console.log("[webhook] restored", { previousUrl, afterUrl });
    try {
      const { syncBotPublicDescription } = await import("./bot.server");
      await syncBotPublicDescription();
    } catch (e) {
      console.error("[webhook] syncBotPublicDescription", e);
    }
    return {
      ok: true,
      action: "set",
      expected,
      previousUrl,
      currentUrl: afterUrl,
      pending_update_count: pending,
    };
  } catch (e) {
    return {
      ok: false,
      action: "error",
      expected,
      previousUrl: "",
      error: (e as Error).message,
    };
  }
}

// ─── Dual-bot variant, for clients with a separate VIP-group bot ──────────

type EnsureOne = {
  name: "SHOP" | "VIP";
  ok: boolean;
  action: "unchanged" | "set" | "skipped" | "error" | "not_owner";
  expected: string;
  previousUrl: string;
  currentUrl?: string;
  pending_update_count?: number;
  last_error_message?: string | null;
  error?: string;
};

async function tgApi(
  token: string,
  method: string,
  payload: Record<string, unknown> = {},
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json().catch(() => ({ ok: false }))) as {
    ok: boolean;
    result?: unknown;
    description?: string;
  };
}

async function ensureOne(
  name: "SHOP" | "VIP",
  token: string | undefined,
  path: string,
  secret: string,
): Promise<EnsureOne> {
  const expected = `${publicAppOrigin()}${path}`;
  if (!token) {
    return {
      name,
      ok: false,
      action: "skipped",
      expected,
      previousUrl: "",
      error: `${name === "VIP" ? "VIP_BOT_TOKEN" : "TELEGRAM_BOT_TOKEN"} not set`,
    };
  }

  try {
    const info = await tgApi(token, "getWebhookInfo");
    if (!info.ok) {
      return {
        name,
        ok: false,
        action: "error",
        expected,
        previousUrl: "",
        error: info.description || "getWebhookInfo failed",
      };
    }

    const r = (info.result || {}) as {
      url?: string;
      pending_update_count?: number;
      last_error_message?: string;
    };
    const previousUrl = (r.url || "").trim();
    const pending = r.pending_update_count ?? 0;
    const lastErr = r.last_error_message || null;

    // Re-set if URL wrong/empty OR Telegram reports delivery errors (often 401 secret mismatch)
    const needsSet = previousUrl !== expected || !!lastErr;

    if (!needsSet) {
      return {
        name,
        ok: true,
        action: "unchanged",
        expected,
        previousUrl,
        currentUrl: previousUrl,
        pending_update_count: pending,
        last_error_message: lastErr,
      };
    }

    const payload: Record<string, unknown> = {
      url: expected,
      drop_pending_updates: false,
    };
    if (secret) payload.secret_token = secret;

    const set = await tgApi(token, "setWebhook", payload);
    if (!set.ok) {
      return {
        name,
        ok: false,
        action: "error",
        expected,
        previousUrl,
        error: set.description || "setWebhook failed",
        last_error_message: lastErr,
      };
    }

    const after = await tgApi(token, "getWebhookInfo");
    const afterUrl = ((after.result as { url?: string } | undefined)?.url || "").trim() || expected;

    console.log(`[webhook-ensure] ${name} restored`, {
      previousUrl,
      afterUrl,
      hadError: !!lastErr,
    });

    // Only the shop bot has a public profile (name/description) worth keeping
    // in sync — the VIP bot's profile isn't customer-facing the same way.
    if (name === "SHOP") {
      try {
        const { syncBotPublicDescription } = await import("./bot.server");
        await syncBotPublicDescription();
      } catch (e) {
        console.error("[webhook-ensure] syncBotPublicDescription", e);
      }
    }

    return {
      name,
      ok: true,
      action: "set",
      expected,
      previousUrl,
      currentUrl: afterUrl,
      pending_update_count: pending,
      last_error_message: lastErr,
    };
  } catch (e) {
    return {
      name,
      ok: false,
      action: "error",
      expected,
      previousUrl: "",
      error: (e as Error).message,
    };
  }
}

/** Ensure shop + VIP webhooks point at this deployment (and matching secret_token). */
export async function ensureDidWebhooks(): Promise<{ ok: boolean; bots: EnsureOne[] }> {
  // Проверка владельца одна на оба бота: они принадлежат одному арендатору и
  // переезжают вместе.
  const own = await ownsWebhook();
  if (!own.allowed) {
    const note = `Бот закреплён в панели за ${own.owner}, этот деплой вебхук не трогает`;
    return {
      ok: true,
      bots: (["SHOP", "VIP"] as const).map((name) => ({
        name,
        ok: true,
        action: "not_owner" as const,
        expected: "",
        previousUrl: "",
        error: note,
      })),
    };
  }

  const shopSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  const vipSecret = (
    process.env.VIP_TELEGRAM_WEBHOOK_SECRET ||
    process.env.TELEGRAM_WEBHOOK_SECRET ||
    ""
  ).trim();

  const bots = await Promise.all([
    ensureOne("SHOP", process.env.TELEGRAM_BOT_TOKEN, "/api/public/telegram/webhook", shopSecret),
    ensureOne("VIP", process.env.VIP_BOT_TOKEN, "/api/public/telegram/webhook-vip", vipSecret),
  ]);

  return { ok: bots.every((b) => b.ok || b.action === "skipped"), bots };
}
