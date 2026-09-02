import type { Json } from "@/integrations-supabase/types";
import type { TelegramWebAppUser } from "./telegram-init-data.server";
import type { DeliveryLangChoice } from "./product-materials";
import { logger } from "./logger.server";

type CartListRow = {
  id: string;
  quantity: number;
  product_variant_id: string | null;
  products: {
    id: string;
    name: string;
    price: number | string;
    currency: string | null;
    country_prices: Json;
    file_path?: string | null;
    file_name?: string | null;
    file_path_kz?: string | null;
    file_name_kz?: string | null;
    file_url?: string | null;
    file_url_kz?: string | null;
    fulfillment_kind?: string | null;
    product_material_files?: Array<{
      language: string;
      file_path: string | null;
      file_name: string | null;
      sort_order: number;
    }> | null;
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
  quantityLocked: boolean;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function miniAppUserContext(telegram_id: number): Promise<{
  countryCode: string | null;
  locale: string | null;
  deliveryLanguage: DeliveryLangChoice | null;
  fulfillmentType: string | null;
  deliveryFee: number;
}> {
  const s = await db();
  const { data } = await s
    .from("bot_users")
    .select("state")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  const state = data?.state;
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const value = state as {
      country_code?: string;
      locale?: string;
      checkout_lang_choice?: DeliveryLangChoice;
      checkout_fulfillment_type?: string;
      checkout_delivery_fee?: number;
    };
    return {
      countryCode: value.country_code?.trim() || null,
      locale: value.locale?.trim() || null,
      deliveryLanguage: value.checkout_lang_choice ?? null,
      fulfillmentType: value.checkout_fulfillment_type ?? null,
      deliveryFee: Number(value.checkout_delivery_fee) || 0,
    };
  }
  return {
    countryCode: null,
    locale: null,
    deliveryLanguage: null,
    fulfillmentType: null,
    deliveryFee: 0,
  };
}

export async function miniAppCountryCode(telegram_id: number): Promise<string | null> {
  return (await miniAppUserContext(telegram_id)).countryCode;
}

export async function listMiniAppCart(telegram_id: number): Promise<MiniAppCartLine[]> {
  const context = await miniAppUserContext(telegram_id);
  const s = await db();
  const { data: items, error } = await s
    .from("cart_items")
    .select(
      "id, quantity, product_variant_id, products(id, name, price, currency, country_prices, fulfillment_kind, file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz, product_material_files(language, file_path, file_name, sort_order)), product_variants(id, name, price)",
    )
    .eq("telegram_id", telegram_id);
  if (error) {
    logger.error("mini_app.cart_list_failed", { err: error, telegram_id });
    return [];
  }

  const { resolvePrice } = await import("./pricing.server");
  const { availableMaterialLanguages, deliveryPriceMultiplier } =
    await import("./product-materials");
  const lines: MiniAppCartLine[] = [];
  for (const it of (items ?? []) as CartListRow[]) {
    const p = it.products;
    if (!p) continue;
    const money = await resolvePrice(p, context.countryCode, it.product_variants);
    const multiplier = deliveryPriceMultiplier(
      context.deliveryLanguage,
      availableMaterialLanguages(p).length,
    );
    const lineTotal = Number(money.amount) * multiplier * Number(it.quantity);
    const displayName = it.product_variants ? `${p.name} (${it.product_variants.name})` : p.name;
    lines.push({
      id: it.id,
      quantity: it.quantity,
      product_id: p.id,
      product_variant_id: it.product_variant_id,
      name: displayName,
      line_total: lineTotal,
      currency: money.currency,
      quantityLocked: p.fulfillment_kind !== "physical",
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
    logger.error("mini_app.cart_remove_failed", {
      err: error,
      telegram_id,
      cart_item_id,
    });
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
  if (!state.locale) {
    state.locale = locale;
    await s
      .from("bot_users")
      .update({ state: state as Json })
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

export async function miniAppCartSummary(telegram_id: number, items: MiniAppCartLine[]) {
  const context = await miniAppUserContext(telegram_id);
  const lineSubtotal = items.reduce((sum, row) => sum + row.line_total, 0);
  const subtotal =
    lineSubtotal + (context.fulfillmentType === "delivery" ? context.deliveryFee : 0);
  const { miniAppCartDiscountSummary } = await import("./bot.server");
  return miniAppCartDiscountSummary(telegram_id, subtotal);
}

export async function miniAppPendingPayment(telegram_id: number) {
  const { miniAppPendingPayment: loadPendingPayment } = await import("./bot.server");
  return loadPendingPayment(telegram_id);
}

export async function miniAppChangeDiscount(
  telegram_id: number,
  action:
    "promo_apply" | "promo_clear" | "gift_apply" | "gift_clear" | "points_use" | "points_clear",
  code?: string,
) {
  const { miniAppUpdateDiscount } = await import("./bot.server");
  return miniAppUpdateDiscount(telegram_id, action, code);
}

export async function miniAppCheckoutInChat(telegram_id: number) {
  const { miniAppOpenCartInChat } = await import("./bot.server");
  return miniAppOpenCartInChat(telegram_id);
}

export async function miniAppRunCheckout(telegram_id: number, body: Record<string, unknown>) {
  const { miniAppProcessCheckout } = await import("./mini-app-checkout.server");
  return miniAppProcessCheckout(
    telegram_id,
    body as import("./mini-app-checkout.server").MiniAppCheckoutBody,
  );
}
