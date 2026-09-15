declare const process: any;

import type { UniversalBusinessProfile, UniversalGoal, UniversalNiche } from "./profile";
import {
  getPresetKnowledgeDocs,
  type KnowledgeDocument,
  WESTERN_FLOWERS_DOCS,
  ALMATY_SUPPLEMENTS_DOCS,
} from "./knowledge";
import { universalConsultantApiKey, universalConsultantModel, UNIVERSAL_AI_TIMEOUT_MS } from "./claude";
import { logger } from "@/lib/logger.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export type ProfilerInput = {
  brandName?: string;
  instagramUsername?: string;
  websiteUrl?: string;
  bio?: string;
  recentPosts?: string[];
  rawDescription?: string;
  desiredGoal?: UniversalGoal;
};

export type ProfilerOutput = {
  profile: UniversalBusinessProfile;
  knowledgeDocs: KnowledgeDocument[];
  summary: string;
};

/**
 * Эвристический анализатор бизнеса (работает мгновенно без внешних API и как надежный fallback)
 */
export function heuristicAnalyzeBusiness(input: ProfilerInput): ProfilerOutput {
  const hay = [
    input.brandName || "",
    input.instagramUsername || "",
    input.bio || "",
    ...(input.recentPosts || []),
    input.rawDescription || "",
  ]
    .join(" ")
    .toLowerCase();

  let niche: UniversalNiche = "general";
  let goal: UniversalGoal = input.desiredGoal || "direct_sales";
  let currency: "KZT" | "RUB" | "USD" | "EUR" = "KZT";
  let countries: string[] = ["KZ"];
  let toneOfVoice: UniversalBusinessProfile["tone_of_voice"] = "friendly_expert";
  let medicalDisclaimer = false;
  let greetingCard = false;
  let photoBeforeDelivery = false;

  // 1. Определение ниши
  const flowerKeywords = ["цветоч", "букет", "розы", "пион", "флорист", "flower", "rose", "petal", "bloom", "floral"];
  const suppKeywords = ["бад", "витамин", "добавк", "коллаген", "омега", "нутрицио", "supplement", "d3", "omega", "health"];
  const beautyKeywords = ["салон", "маникюр", "стрижк", "массаж", "ресниц", "косметолог", "макияж", "beauty", "spa"];
  const servicesKeywords = ["созвон", "аудит", "консалтинг", "внедрени", "разработк", "юрист", "недвижим", "consulting"];

  if (flowerKeywords.some((k) => hay.includes(k))) {
    niche = "flowers";
    goal = input.desiredGoal || "direct_sales";
    toneOfVoice = "luxury_warm";
    greetingCard = true;
    photoBeforeDelivery = true;
  } else if (suppKeywords.some((k) => hay.includes(k))) {
    niche = "supplements";
    goal = input.desiredGoal || "direct_sales";
    toneOfVoice = "friendly_expert";
    medicalDisclaimer = true;
  } else if (beautyKeywords.some((k) => hay.includes(k))) {
    niche = "beauty";
    goal = input.desiredGoal || "booking";
    toneOfVoice = "friendly_expert";
  } else if (servicesKeywords.some((k) => hay.includes(k))) {
    niche = "services";
    goal = input.desiredGoal || "book_call";
    toneOfVoice = "formal";
  }

  // 2. Определение региона и валюты
  if (hay.includes("$") || hay.includes("usd") || hay.includes("usa") || hay.includes("dollar") || hay.includes("united states")) {
    currency = "USD";
    countries = ["US", "GLOBAL"];
  } else if (hay.includes("€") || hay.includes("eur") || hay.includes("euro")) {
    currency = "EUR";
    countries = ["EU", "GLOBAL"];
  } else if (hay.includes("₽") || hay.includes("rub") || hay.includes("росси") || hay.includes("рубл")) {
    currency = "RUB";
    countries = ["RU"];
  } else {
    currency = "KZT";
    countries = ["KZ"];
  }

  const brandName =
    input.brandName?.trim() ||
    (input.instagramUsername ? "@" + input.instagramUsername.replace(/^@/, "") : "Онлайн-бутик");

  const profile: UniversalBusinessProfile = {
    brand_name: brandName,
    niche,
    goal,
    website_url: input.websiteUrl,
    instagram_username: input.instagramUsername,
    tone_of_voice: toneOfVoice,
    primary_language: currency === "USD" || currency === "EUR" ? "en" : "ru",
    countries,
    currency,
    delivery_info:
      niche === "flowers"
        ? "Доставка день в день ко времени. Фото букета перед отправкой в чат."
        : niche === "supplements"
        ? "Яндекс Доставка по городу день в день. СДЭК по стране."
        : "Курьерская доставка и самовывоз.",
    payment_info:
      currency === "USD"
        ? "Direct checkout via Stripe (Apple Pay, Google Pay, Cards)."
        : currency === "KZT"
        ? "Оплата через Kaspi Pay (Kaspi QR, выставление счета)."
        : "Онлайн-оплата картой / перевод.",
    medical_disclaimer_enabled: medicalDisclaimer,
    greeting_card_enabled: greetingCard,
    photo_before_delivery_enabled: photoBeforeDelivery,
  };

  // 3. Формирование базы знаний
  let knowledgeDocs: KnowledgeDocument[] = [];
  if (niche === "flowers") {
    knowledgeDocs = [...WESTERN_FLOWERS_DOCS];
  } else if (niche === "supplements") {
    knowledgeDocs = [...ALMATY_SUPPLEMENTS_DOCS];
  } else {
    knowledgeDocs = [
      {
        id: "doc_general_catalog",
        title: "Каталог и услуги",
        category: "Ассортимент",
        content: input.rawDescription || input.bio || "Полный перечень услуг и товаров компании.",
      },
      {
        id: "doc_general_terms",
        title: "Условия работы и заказ",
        category: "Сервис",
        content: "График работы: ежедневно. Условия доставки: " + (profile.delivery_info || "") + " Способы оплаты: " + (profile.payment_info || ""),
      },
    ];
  }

  if (input.recentPosts && input.recentPosts.length > 0) {
    knowledgeDocs.push({
      id: "doc_instagram_posts",
      title: "Публикации и актуальные предложения из Instagram",
      category: "Instagram",
      content: input.recentPosts.map((p, i) => "• Публикация #" + (i + 1) + ": " + p).join("\n\n"),
    });
  }

  const summary = "Проанализирован бизнес «" + brandName + "». Ниша: " + niche + ", главная цель: " + goal + ", валюта: " + currency + ", документов в базе знаний: " + knowledgeDocs.length + ".";

  return { profile, knowledgeDocs, summary };
}

/**
 * ИИ-профайлер на базе Claude (глубокий семантический анализ описания и постов)
 */
export async function analyzeBusinessWithAI(input: ProfilerInput): Promise<ProfilerOutput> {
  const apiKey = universalConsultantApiKey();
  if (!apiKey) {
    logger.info("universal_profiler.using_heuristic_fallback_no_api_key");
    return heuristicAnalyzeBusiness(input);
  }

  const promptContent = [
    "Вы — ведущий ИИ-бизнес-аналитик. Вам переданы данные компании (Instagram-аккаунт, шапка профиля, посты, сайт или описание).",
    "Проведите полный анализ бизнеса и верните строгий JSON-объект следующей структуры:",
    JSON.stringify({
      brand_name: "Название бренда",
      niche: "flowers | supplements | textiles | beauty | services | general",
      goal: "direct_sales | book_call | booking | expert_faq",
      tone_of_voice: "luxury_warm | friendly_expert | formal | casual",
      primary_language: "ru | kk | en",
      countries: ["KZ"],
      currency: "KZT | USD | RUB | EUR",
      delivery_info: "Краткие условия доставки",
      payment_info: "Краткие способы оплаты",
      medical_disclaimer_enabled: true,
      greeting_card_enabled: true,
      photo_before_delivery_enabled: true,
      custom_instructions: "Особые указания по ведению диалога",
      summary: "Краткое резюме анализа бизнеса в 2 предложениях",
      documents: [{ id: "уникальный id", title: "Заголовок", category: "Категория", content: "Текст" }]
    }, null, 2),
    "",
    "ВХОДНЫЕ ДАННЫЕ:",
    "Бренд: " + (input.brandName || "Не указан"),
    "Instagram: " + (input.instagramUsername || "Не указан"),
    "Сайт: " + (input.websiteUrl || "Не указан"),
    "Шапка профиля (Bio): " + (input.bio || "Не указано"),
    "Описание: " + (input.rawDescription || "Не указано"),
    "Посты: " + ((input.recentPosts || []).join("\n---\n") || "Нет"),
    "Желаемая цель: " + (input.desiredGoal || "Определить автоматически")
  ].join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: universalConsultantModel(),
        max_tokens: 1500,
        system: "Верните ТОЛЬКО валидный JSON без вступительного текста и без блоков markdown. Только чистый JSON.",
        messages: [{ role: "user", content: promptContent }],
      }),
      signal: AbortSignal.timeout(UNIVERSAL_AI_TIMEOUT_MS),
    });

    if (!res.ok) {
      logger.warn("universal_profiler.ai_failed_using_heuristic", { status: res.status });
      return heuristicAnalyzeBusiness(input);
    }

    const data: any = await res.json();
    const rawText = (data.content?.[0]?.text || "").trim();
    const cleanJson = rawText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleanJson);

    const profile: UniversalBusinessProfile = {
      brand_name: parsed.brand_name || input.brandName || "Бизнес Консультант",
      niche: parsed.niche || "general",
      goal: parsed.goal || input.desiredGoal || "direct_sales",
      website_url: input.websiteUrl,
      instagram_username: input.instagramUsername,
      tone_of_voice: parsed.tone_of_voice || "friendly_expert",
      primary_language: parsed.primary_language || "ru",
      countries: parsed.countries || ["KZ"],
      currency: parsed.currency || "KZT",
      delivery_info: parsed.delivery_info,
      payment_info: parsed.payment_info,
      medical_disclaimer_enabled: parsed.medical_disclaimer_enabled ?? (parsed.niche === "supplements"),
      greeting_card_enabled: parsed.greeting_card_enabled ?? (parsed.niche === "flowers"),
      photo_before_delivery_enabled: parsed.photo_before_delivery_enabled ?? (parsed.niche === "flowers"),
      custom_instructions: parsed.custom_instructions,
    };

    const knowledgeDocs: KnowledgeDocument[] = Array.isArray(parsed.documents) && parsed.documents.length > 0
      ? parsed.documents
      : getPresetKnowledgeDocs(profile.niche);

    return {
      profile,
      knowledgeDocs,
      summary: parsed.summary || ("Анализ завершен для " + profile.brand_name),
    };
  } catch (err) {
    logger.warn("universal_profiler.exception_using_heuristic", { error: String(err) });
    return heuristicAnalyzeBusiness(input);
  }
}

/**
 * Сохранение проанализированного профиля и базы знаний в app_settings
 */
export async function saveBusinessProfileToBot(botId: string, output: ProfilerOutput): Promise<void> {
  const s = await db();
  const now = new Date().toISOString();

  await s.from("app_settings").upsert([
    {
      bot_id: botId,
      key: "consultant_profile",
      value: JSON.stringify(output.profile),
      updated_at: now,
    },
    {
      bot_id: botId,
      key: "consultant_knowledge",
      value: JSON.stringify(output.knowledgeDocs),
      updated_at: now,
    },
    {
      bot_id: botId,
      key: "consultant_profile_summary",
      value: output.summary,
      updated_at: now,
    },
  ]);
}
/**
 * Автоматический анализ профиля прямо из подключенного аккаунта Zernio
 */
export async function autoProfileFromZernioAccount(params: {
  botId: string;
  accountId: string;
  brandName?: string;
  desiredGoal?: UniversalGoal;
}): Promise<ProfilerOutput> {
  let postsContent: string[] = [];
  let username: string | undefined;

  try {
    const { listZernioPosts, listZernioAccounts } = await import("@/lib/zernio.server");
    const [posts, accounts] = await Promise.allSettled([
      listZernioPosts(params.accountId),
      listZernioAccounts(),
    ]);

    if (posts.status === "fulfilled" && Array.isArray(posts.value)) {
      postsContent = posts.value
        .map((p) => {
          const caption = (p.caption || p.text || (p as any).title) as string | undefined;
          return typeof caption === "string" ? caption.trim() : "";
        })
        .filter((c) => c.length > 10)
        .slice(0, 10);
    }

    if (accounts.status === "fulfilled" && Array.isArray(accounts.value)) {
      const match = accounts.value.find((a) => a._id === params.accountId);
      if (match) {
        username = match.username;
      }
    }
  } catch (err) {
    logger.warn("universal_profiler.fetch_zernio_failed", { error: String(err) });
  }

  const output = await analyzeBusinessWithAI({
    brandName: params.brandName,
    instagramUsername: username,
    recentPosts: postsContent,
    desiredGoal: params.desiredGoal,
  });

  await saveBusinessProfileToBot(params.botId, output);
  return output;
}
