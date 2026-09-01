import { formatMiniAppMoney } from "./mini-app-catalog.server";
import { miniAppCountryCode } from "./mini-app-cart.server";
import {
  isMiniAppFulfillmentType,
  isMiniAppPaymentMethod,
  isValidMiniAppIsoDate,
  normalizeMiniAppPhone,
  normalizeMiniAppText,
} from "./mini-app-validation";

export type MiniAppCheckoutBody = {
  contact_phone?: string;
  country_code?: string;
  fulfillment_type?: "pickup" | "delivery";
  fulfillment_date?: string;
  delivery_zone_id?: string;
  fulfillment_address?: string;
  fulfillment_note?: string;
  delivery_language?: string;
  payment_method?: "robokassa" | "manual";
};

export type MiniAppCheckoutResponse = {
  step?: string;
  countries?: Array<{ code: string; name: string }>;
  pickup?: boolean;
  delivery?: boolean;
  minDate?: string;
  zones?: Array<{ id: string; name: string; fee: number; feeLabel: string }>;
  languages?: Array<{ code: string; name: string }>;
  paymentUrl?: string;
  amountLabel?: string;
  instructions?: string;
  qrImageUrl?: string;
  message?: string;
  error?: string;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function miniAppProcessCheckout(
  telegram_id: number,
  body: MiniAppCheckoutBody,
): Promise<MiniAppCheckoutResponse> {
  const s = await db();
  const { data: row } = await s
    .from("bot_users")
    .select("*")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  if (!row) return { step: "error", error: "no_user" };

  if (body.contact_phone !== undefined) {
    const phone = normalizeMiniAppPhone(body.contact_phone);
    if (!phone) {
      return { step: "need_contact", error: "invalid_contact" };
    }
    await s.from("bot_users").update({ contact_phone: phone }).eq("telegram_id", telegram_id);
    row.contact_phone = phone;
  }

  if (body.country_code?.trim()) {
    const { miniAppSetCountry } = await import("./bot.server");
    const changed = await miniAppSetCountry(telegram_id, body.country_code.trim());
    if (!changed) return { step: "error", error: "invalid_country" };
    const st =
      row.state && typeof row.state === "object" && !Array.isArray(row.state)
        ? { ...(row.state as Record<string, unknown>) }
        : {};
    st.country_code = body.country_code.trim();
    row.state = st;
  }

  if (body.payment_method) {
    if (!isMiniAppPaymentMethod(body.payment_method)) {
      return { step: "error", error: "invalid_payment_method" };
    }
    const { completeMiniAppPayment } = await import("./bot.server");
    return mapPlaceOrderResult(await completeMiniAppPayment(telegram_id, body.payment_method));
  }

  const statePatch: Record<string, unknown> = {};
  if (body.fulfillment_type !== undefined && !isMiniAppFulfillmentType(body.fulfillment_type)) {
    return { step: "error", error: "invalid_fulfillment_type" };
  }
  if (body.fulfillment_type) {
    const { fulfillmentOptionsEnabled } = await import("./fulfillment.server");
    const enabled = await fulfillmentOptionsEnabled();
    if (
      (body.fulfillment_type === "pickup" && !enabled.pickup) ||
      (body.fulfillment_type === "delivery" && !enabled.delivery)
    ) {
      return { step: "error", error: "fulfillment_unavailable" };
    }
    statePatch.checkout_fulfillment_type = body.fulfillment_type;
    statePatch.checkout_delivery_zone_id = undefined;
    statePatch.checkout_delivery_zone_name = undefined;
    statePatch.checkout_delivery_fee = undefined;
    statePatch.checkout_fulfillment_address = undefined;
  }
  if (body.fulfillment_date) {
    const { maxLeadTimeDaysInCart, todayInAppTZ, addDaysToIsoDate } =
      await import("./fulfillment.server");
    const minDate = addDaysToIsoDate(todayInAppTZ(), await maxLeadTimeDaysInCart(telegram_id));
    if (!isValidMiniAppIsoDate(body.fulfillment_date, minDate)) {
      return { step: "need_fulfillment_date", minDate, error: "invalid_fulfillment_date" };
    }
    statePatch.checkout_fulfillment_at = body.fulfillment_date;
  }
  if (body.fulfillment_address !== undefined) {
    const address = normalizeMiniAppText(body.fulfillment_address, 500, true);
    if (!address) return { step: "need_address", error: "invalid_address" };
    statePatch.checkout_fulfillment_address = address;
  }
  if (body.fulfillment_note !== undefined) {
    statePatch.checkout_fulfillment_note =
      normalizeMiniAppText(body.fulfillment_note, 500, false) ?? "";
  }
  if (body.delivery_language !== undefined) {
    const { isDeliveryLangChoice } = await import("./product-materials");
    if (!isDeliveryLangChoice(body.delivery_language)) {
      return { step: "error", error: "invalid_delivery_language" };
    }
    statePatch.checkout_lang_choice = body.delivery_language;
  }

  if (body.delivery_zone_id) {
    const { activeDeliveryZones } = await import("./fulfillment.server");
    const zones = await activeDeliveryZones();
    const zone = zones.find((z) => z.id === body.delivery_zone_id);
    if (!zone) return { step: "error", error: "invalid_delivery_zone" };
    statePatch.checkout_delivery_zone_id = zone.id;
    statePatch.checkout_delivery_zone_name = zone.name;
    statePatch.checkout_delivery_fee = Number(zone.price) || 0;
  }

  if (Object.keys(statePatch).length > 0) {
    const { miniAppMergeState } = await import("./bot.server");
    await miniAppMergeState(telegram_id, statePatch);
    const merged =
      row.state && typeof row.state === "object" && !Array.isArray(row.state)
        ? { ...(row.state as Record<string, unknown>), ...statePatch }
        : statePatch;
    row.state = merged;
  }

  const needs = await miniAppCheckoutNeeds(telegram_id, row);
  if (needs) return needs;

  const { placeOrderForMiniApp } = await import("./bot.server");
  const result = await placeOrderForMiniApp(telegram_id, body.payment_method);
  return mapPlaceOrderResult(result);
}

export async function miniAppCheckoutNeeds(
  telegram_id: number,
  row?: { contact_phone?: string | null; state?: unknown },
): Promise<MiniAppCheckoutResponse | null> {
  const s = await db();
  let user = row;
  if (!user) {
    const { data } = await s
      .from("bot_users")
      .select("contact_phone, state")
      .eq("telegram_id", telegram_id)
      .maybeSingle();
    user = data;
  }
  if (!user) return { step: "error", error: "no_user" };

  const { count } = await s
    .from("cart_items")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", telegram_id);
  if (!count) return { step: "error", error: "empty_cart" };

  if (!user.contact_phone?.trim()) {
    return { step: "need_contact" };
  }

  const state =
    user.state && typeof user.state === "object" && !Array.isArray(user.state)
      ? (user.state as Record<string, unknown>)
      : {};
  const countryCode = typeof state.country_code === "string" ? state.country_code : null;
  if (!countryCode) {
    const { data: methods } = await s
      .from("payment_methods")
      .select("country_code, country_name")
      .eq("is_active", true)
      .order("sort_order");
    return {
      step: "need_country",
      countries: (methods ?? []).map((m) => ({
        code: m.country_code as string,
        name: m.country_name as string,
      })),
    };
  }

  const {
    cartFulfillmentKind,
    fulfillmentOptionsEnabled,
    maxLeadTimeDaysInCart,
    todayInAppTZ,
    addDaysToIsoDate,
    activeDeliveryZones,
  } = await import("./fulfillment.server");

  if ((await cartFulfillmentKind(telegram_id)) === "physical") {
    const { pickup, delivery } = await fulfillmentOptionsEnabled();
    let effectiveType = state.checkout_fulfillment_type as string | undefined;
    if (!effectiveType) {
      if (pickup && delivery) {
        return { step: "need_fulfillment_type", pickup, delivery };
      }
      effectiveType = delivery ? "delivery" : "pickup";
      const { miniAppMergeState } = await import("./bot.server");
      await miniAppMergeState(telegram_id, {
        checkout_fulfillment_type: effectiveType,
      });
      state.checkout_fulfillment_type = effectiveType;
    }
    const minDays = await maxLeadTimeDaysInCart(telegram_id);
    const minDate = addDaysToIsoDate(todayInAppTZ(), minDays);
    const fulfillmentDate =
      typeof state.checkout_fulfillment_at === "string" ? state.checkout_fulfillment_at : "";
    if (!isValidMiniAppIsoDate(fulfillmentDate, minDate)) {
      return { step: "need_fulfillment_date", minDate };
    }
    if (effectiveType === "delivery") {
      const zones = await activeDeliveryZones();
      if (zones.length > 0 && !state.checkout_delivery_zone_id) {
        const { currencyForCountry, defaultCountryCode } = await import("./pricing.server");
        const currency =
          (await currencyForCountry(countryCode ?? (await defaultCountryCode()))) ?? "KZT";
        return {
          step: "need_delivery_zone",
          zones: zones.map((z) => ({
            id: z.id,
            name: z.name,
            fee: Number(z.price) || 0,
            feeLabel: formatMiniAppMoney(Number(z.price) || 0, currency),
          })),
        };
      }
      if (!state.checkout_fulfillment_address) {
        return { step: "need_address" };
      }
    }
    if (state.checkout_fulfillment_note === undefined) {
      return { step: "need_fulfillment_note" };
    }
  }

  const { hasModule } = await import("./modules/modules.server");
  if ((await hasModule("multi_language")) && !state.checkout_lang_choice) {
    const { data: timing } = await s
      .from("app_settings")
      .select("value")
      .eq("key", "delivery_lang_timing")
      .maybeSingle();
    if ((timing?.value ?? "after") === "before") {
      const { data: items } = await s
        .from("cart_items")
        .select(
          "products(file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz, product_material_files(language, file_path, file_name, sort_order))",
        )
        .eq("telegram_id", telegram_id);
      const { MATERIAL_LANGUAGES, availableMaterialLanguages } =
        await import("./product-materials");
      const { localeNames, localeFlags } = await import("./i18n");
      const available = new Set<string>();
      for (const item of items ?? []) {
        for (const language of availableMaterialLanguages(item.products)) {
          available.add(language);
        }
      }
      const languages = MATERIAL_LANGUAGES.filter((language) => available.has(language));
      if (languages.length > 1) {
        return {
          step: "need_delivery_language",
          languages: [
            ...languages.map((code) => ({
              code,
              name: `${localeFlags[code]} ${localeNames[code]}`,
            })),
            { code: "all", name: "🌐 All / Все" },
          ],
        };
      }
    }
  }

  return null;
}

function mapPlaceOrderResult(
  result: import("./bot.server").MiniAppPlaceOrderResult,
): MiniAppCheckoutResponse {
  if (!result.ok) return { step: "error", error: result.error };
  if (result.type === "choose_payment") {
    return { step: "choose_payment", amountLabel: result.amountLabel };
  }
  if (result.type === "robokassa") {
    return {
      step: "robokassa",
      paymentUrl: result.paymentUrl,
      amountLabel: result.amountLabel,
    };
  }
  if (result.type === "manual_proof") {
    return {
      step: "manual_proof",
      amountLabel: result.amountLabel,
      instructions: result.instructions,
      qrImageUrl: result.qrImageUrl,
    };
  }
  return { step: "completed", message: result.message };
}

export async function miniAppDefaultCountryForCatalog(
  telegram_id?: number,
): Promise<string | null> {
  if (!telegram_id) return null;
  return miniAppCountryCode(telegram_id);
}
