import { randomBytes } from "node:crypto";
import { getCachedBotUrl } from "./bot-url.server";

/** Префикс deep link: t.me/<bot>?start=wc_<token> */
export const WEB_CART_HANDOFF_START_PREFIX = "wc_";

/** Срок жизни handoff — корзина на витрине не должна жить вечно. */
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_LINES = 40;
const MAX_QTY_PER_LINE = 99;

export type WebCartHandoffItem = {
  product_id: string;
  product_variant_id?: string | null;
  quantity: number;
};

export type WebCartHandoffClaimResult =
  "ok" | "missing" | "expired" | "claimed" | "wrong_bot" | "empty";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

function botId(): string {
  const id = (process.env.BOT_ID || "").trim();
  if (!id) throw new Error("BOT_ID is not set");
  return id;
}

function newToken(): string {
  return randomBytes(16).toString("hex");
}

function parseStoredItems(raw: unknown): WebCartHandoffItem[] {
  if (!Array.isArray(raw)) return [];
  const out: WebCartHandoffItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const product_id = (row as { product_id?: unknown }).product_id;
    if (typeof product_id !== "string" || !product_id) continue;
    const variantRaw = (row as { product_variant_id?: unknown }).product_variant_id;
    const product_variant_id =
      variantRaw === null || variantRaw === undefined
        ? null
        : typeof variantRaw === "string"
          ? variantRaw
          : null;
    const qtyRaw = (row as { quantity?: unknown }).quantity;
    const quantity =
      typeof qtyRaw === "number" && Number.isFinite(qtyRaw)
        ? Math.max(1, Math.min(MAX_QTY_PER_LINE, Math.floor(qtyRaw)))
        : 1;
    out.push({ product_id, product_variant_id, quantity });
  }
  return out;
}

/**
 * Проверяет позиции корзины перед сохранением handoff: только активные
 * товары этого арендатора, вариант принадлежит товару, не «нет в наличии»
 * при включённом модуле stock.
 */
export async function validateWebCartHandoffItems(
  items: WebCartHandoffItem[],
): Promise<WebCartHandoffItem[]> {
  if (!items.length) return [];
  const limited = items.slice(0, MAX_LINES);
  const s = await db();
  const { hasModule } = await import("./modules/modules.server");
  const stockEnabled = await hasModule("stock");

  const validated: WebCartHandoffItem[] = [];

  for (const item of limited) {
    const { data: product } = await s
      .from("products")
      .select("id, is_active, stock_quantity, fulfillment_kind")
      .eq("id", item.product_id)
      .maybeSingle();
    if (!product?.is_active) continue;

    if (item.product_variant_id) {
      const { data: variant } = await s
        .from("product_variants")
        .select("id")
        .eq("id", item.product_variant_id)
        .eq("product_id", item.product_id)
        .maybeSingle();
      if (!variant) continue;
    }

    if (stockEnabled && product.stock_quantity !== null && product.stock_quantity <= 0) {
      continue;
    }

    validated.push({
      product_id: item.product_id,
      product_variant_id: item.product_variant_id ?? null,
      quantity: item.quantity,
    });
  }

  return validated;
}

export type CreateWebCartHandoffResult =
  | { ok: true; url: string; token: string }
  | { ok: false; reason: "empty" | "no_bot_url" | "bot_unavailable" };

/**
 * Сохраняет корзину с витрины и возвращает deep link в Telegram-бот.
 */
export async function createWebCartHandoff(
  items: WebCartHandoffItem[],
): Promise<CreateWebCartHandoffResult> {
  const validated = await validateWebCartHandoffItems(items);
  if (!validated.length) return { ok: false, reason: "empty" };

  const botUrl = await getCachedBotUrl();
  if (!botUrl) return { ok: false, reason: "no_bot_url" };

  const token = newToken();
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString();
  const s = await db();

  const { error } = await s.from("web_cart_handoffs").insert({
    token,
    bot_id: botId(),
    items: validated,
    expires_at: expiresAt,
  });

  if (error) {
    console.error("[web-storefront-handoff] insert failed", error);
    return { ok: false, reason: "bot_unavailable" };
  }

  const startParam = `${WEB_CART_HANDOFF_START_PREFIX}${token}`;
  const url = `${botUrl}?start=${encodeURIComponent(startParam)}`;
  return { ok: true, url, token };
}

/**
 * Переносит позиции handoff в cart_items покупателя в Telegram.
 */
export async function claimWebCartHandoff(
  telegramId: number,
  token: string,
): Promise<WebCartHandoffClaimResult> {
  const trimmed = token.trim();
  if (!trimmed) return "missing";

  const s = await db();
  const { data: row, error } = await s
    .from("web_cart_handoffs")
    .select("bot_id, items, expires_at, claimed_at")
    .eq("token", trimmed)
    .maybeSingle();

  if (error) {
    console.error("[web-storefront-handoff] load failed", error);
    return "missing";
  }
  if (!row) return "missing";
  if (row.bot_id !== botId()) return "wrong_bot";
  if (row.claimed_at) return "claimed";
  if (new Date(row.expires_at as string).getTime() < Date.now()) return "expired";

  const items = parseStoredItems(row.items);
  if (!items.length) return "empty";

  const { importCartItemsForHandoff } = await import("./bot.server");
  const { imported } = await importCartItemsForHandoff(telegramId, items);
  if (imported === 0) return "empty";

  const { error: claimError } = await s
    .from("web_cart_handoffs")
    .update({
      claimed_at: new Date().toISOString(),
      claimed_telegram_id: telegramId,
    })
    .eq("token", trimmed)
    .is("claimed_at", null);

  if (claimError) {
    console.error("[web-storefront-handoff] claim mark failed", claimError);
  }

  return "ok";
}
