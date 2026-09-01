import type { TelegramWebAppUser } from "./telegram-init-data.server";

type CartListRow = {
  id: string;
  quantity: number;
  product_variant_id: string | null;
  products: {
    id: string;
    name: string;
    price: number | string;
    currency: string | null;
    country_prices: unknown;
  } | null;
  product_variants: { id: string; name: string; price: number | string } | null;
};

export type MiniAppCartLine = {
  id: string;
  quantity: number;
  product_id: string;
  product_variant_id: string | null;
  name: string;
  line_total: number;
  currency: string;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function miniAppCountryCode(telegram_id: number): Promise<string | null> {
  const s = await db();
  const { data } = await s.from("bot_users").select("state").eq("telegram_id", telegram_id).maybeSingle();
  const state = data?.state;
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const code = (state as { country_code?: string }).country_code;
    return code?.trim() || null;
  }
  return null;
}

export async function listMiniAppCart(telegram_id: number): Promise<MiniAppCartLine[]> {
  const countryCode = await miniAppCountryCode(telegram_id);
  const s = await db();
  const { data: items, error } = await s
    .from("cart_items")
    .select(
      "id, quantity, product_variant_id, products(id, name, price, currency, country_prices), product_variants(id, name, price)",
    )
    .eq("telegram_id", telegram_id);
  if (error) {
    console.error("[mini-app] listMiniAppCart", error);
    return [];
  }

  const { resolvePrice } = await import("./pricing.server");
  const lines: MiniAppCartLine[] = [];
  for (const it of (items ?? []) as CartListRow[]) {
    const p = it.products;
    if (!p) continue;
    const money = await resolvePrice(p, countryCode, it.product_variants);
    const lineTotal = Number(money.amount) * Number(it.quantity);
    const displayName = it.product_variants ? `${p.name} (${it.product_variants.name})` : p.name;
    lines.push({
      id: it.id,
      quantity: it.quantity,
      product_id: p.id,
      product_variant_id: it.product_variant_id,
      name: displayName,
      line_total: lineTotal,
      currency: money.currency,
    });
  }
  return lines;
}

export async function removeMiniAppCartItem(
  telegram_id: number,
  cart_item_id: string,
): Promise<boolean> {
  const s = await db();
  const { error, count } = await s
    .from("cart_items")
    .delete({ count: "exact" })
    .eq("telegram_id", telegram_id)
    .eq("id", cart_item_id);
  if (error) {
    console.error("[mini-app] removeMiniAppCartItem", error);
    return false;
  }
  return (count ?? 0) > 0;
}

export async function ensureMiniAppBotUser(user: TelegramWebAppUser) {
  const { ensureTelegramBotUser } = await import("./bot.server");
  const { miniAppLocaleFromTelegram } = await import("./mini-app-i18n");
  const row = await ensureTelegramBotUser({
    id: user.id,
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    language_code: user.language_code,
  });
  const locale = miniAppLocaleFromTelegram(user.language_code);
  const s = await db();
  const state =
    row.state && typeof row.state === "object" && !Array.isArray(row.state)
      ? { ...(row.state as Record<string, unknown>) }
      : {};
  if (state.locale !== locale) {
    state.locale = locale;
    await s
      .from("bot_users")
      .update({ state })
      .eq("telegram_id", user.id);
  }
  return row;
}

export async function miniAppAddProduct(
  telegram_id: number,
  product_id: string,
  product_variant_id?: string | null,
) {
  const { miniAppAddToCart } = await import("./bot.server");
  return miniAppAddToCart(telegram_id, product_id, product_variant_id);
}

export async function miniAppSetCartQuantity(
  telegram_id: number,
  cart_item_id: string,
  quantity: number,
) {
  const { miniAppUpdateCartQuantity } = await import("./bot.server");
  return miniAppUpdateCartQuantity(telegram_id, cart_item_id, quantity);
}

export async function miniAppCheckoutInChat(telegram_id: number) {
  const { miniAppOpenCartInChat } = await import("./bot.server");
  return miniAppOpenCartInChat(telegram_id);
}

export async function miniAppRunCheckout(
  telegram_id: number,
  body: Record<string, unknown>,
) {
  const { miniAppProcessCheckout } = await import("./mini-app-checkout.server");
  return miniAppProcessCheckout(telegram_id, body as import("./mini-app-checkout.server").MiniAppCheckoutBody);
}
