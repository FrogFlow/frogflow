export type UniversalGoal = "direct_sales" | "book_call" | "booking" | "expert_faq";

export type UniversalNiche =
  | "flowers"
  | "supplements"
  | "textiles"
  | "beauty"
  | "services"
  | "general";

export type UniversalBusinessProfile = {
  brand_name: string;
  niche: UniversalNiche;
  goal: UniversalGoal;
  website_url?: string;
  instagram_username?: string;
  tone_of_voice: "friendly_expert" | "formal" | "luxury_warm" | "casual";
  primary_language: "ru" | "kk" | "en";
  countries: string[];
  currency: "KZT" | "RUB" | "USD" | "EUR";
  delivery_info?: string;
  payment_info?: string;
  medical_disclaimer_enabled?: boolean;
  greeting_card_enabled?: boolean;
  photo_before_delivery_enabled?: boolean;
  custom_instructions?: string;
};

/**
 * Пресет для западных цветочных магазинов (США / Европа)
 */
export const WESTERN_FLOWERS_PRESET: UniversalBusinessProfile = {
  brand_name: "Bloom & Petal Boutique",
  niche: "flowers",
  goal: "direct_sales",
  tone_of_voice: "luxury_warm",
  primary_language: "en",
  countries: ["US", "EU"],
  currency: "USD",
  delivery_info: "Same-day delivery for orders placed before 1:00 PM. Morning (9am-1pm) and afternoon (1pm-6pm) delivery windows.",
  payment_info: "Direct payment via Stripe checkout link (Apple Pay, Google Pay, Visa/Mastercard).",
  greeting_card_enabled: true,
  photo_before_delivery_enabled: true,
  custom_instructions:
    "Guide customers through Occasion -> Budget Category -> Recipient & Delivery Date -> Complimentary Postcard Message. Mention that our florist will send a BloomSnap (photo of the assembled bouquet) before delivery.",
};

/**
 * Пресет для алматинского бизнеса по БАДам и витаминам
 */
export const ALMATY_SUPPLEMENTS_PRESET: UniversalBusinessProfile = {
  brand_name: "Almaty Wellness & Bio Supplements",
  niche: "supplements",
  goal: "direct_sales",
  tone_of_voice: "friendly_expert",
  primary_language: "ru",
  countries: ["KZ"],
  currency: "KZT",
  delivery_info: "Яндекс Доставка по Алматы в день заказа (от 1500 ₸). Доставка по Казахстану СДЭК / Казпочта (1–3 дня).",
  payment_info: "Оплата через Kaspi Pay (Kaspi QR / перевод на реквизиты ИП).",
  medical_disclaimer_enabled: true,
  custom_instructions:
    "Консультируйте строго на основе официальных инструкций и сертификатов препаратов. Всегда включайте краткий дисклеймер о том, что продукция является биологически активной добавкой к пище и не заменяет консультацию врача.",
};

/**
 * Пресет для бутика текстиля (BOVI)
 */
export const BOVI_TEXTILES_PRESET: UniversalBusinessProfile = {
  brand_name: "BOVI",
  niche: "textiles",
  goal: "direct_sales",
  website_url: "https://bovi.kz",
  instagram_username: "bovi.kz",
  tone_of_voice: "luxury_warm",
  primary_language: "ru",
  countries: ["KZ", "RU"],
  currency: "KZT",
  delivery_info: "Доставка по Казахстану курьером. Доставка в Россию службой СДЭК по тарифам СДЭК.",
  payment_info: "Оплата по Kaspi QR / переводом в KZT, для РФ — перевод в рублях по курсу.",
};

/**
 * Разрешение дефолтного пресета по нише или идентификатору бота
 */
export function resolvePresetProfile(niche?: string, botId?: string): UniversalBusinessProfile {
  const normNiche = (niche || "").toLowerCase();
  const normBotId = (botId || "").toLowerCase();

  if (normNiche === "flowers" || normBotId.includes("flower") || normBotId.includes("petal")) {
    return WESTERN_FLOWERS_PRESET;
  }
  if (
    normNiche === "supplements" ||
    normBotId.includes("supplement") ||
    normBotId.includes("bad") ||
    normBotId.includes("vitamin") ||
    normBotId.includes("almaty")
  ) {
    return ALMATY_SUPPLEMENTS_PRESET;
  }
  if (normNiche === "textiles" || normBotId.includes("bovi")) {
    return BOVI_TEXTILES_PRESET;
  }

  return {
    brand_name: "Бизнес Консультант",
    niche: "general",
    goal: "direct_sales",
    tone_of_voice: "friendly_expert",
    primary_language: "ru",
    countries: ["KZ", "RU"],
    currency: "KZT",
    delivery_info: "Доставка курьером или самовывоз.",
    payment_info: "Удобные способы онлайн-оплаты.",
  };
}
