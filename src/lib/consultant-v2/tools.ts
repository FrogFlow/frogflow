import { CONSULTANT_TOOLS } from "@/lib/consultant/tools";

/**
 * Инструменты консультанта v2. Курса среди них нет: рубли считает код
 * (currency.ts), модель пишет только тенге.
 *
 *
 * Данные — те же, что у v1: поиск по прайсу, карточка, база знаний, курс,
 * товары публикации. Передача менеджеру — одним инструментом с причиной:
 * решение звать человека принимает модель, а не правила в коде до неё.
 * remember_customer — память о покупателе между сообщениями: что он уже
 * сказал, то не переспрашивается.
 */

const DATA_TOOL_NAMES = new Set([
  "search_products",
  "search_knowledge",
  "get_product",
  "get_catalog_link",
  "get_story_product",
]);

export const HANDOFF_REASONS = [
  "purchase",
  "wholesale",
  "complaint",
  "human",
  "photo",
  "no_answer",
] as const;
export type V2HandoffReason = (typeof HANDOFF_REASONS)[number];

export const V2_PROFILE_FIELDS = [
  "looking_for",
  "for_whom",
  "size",
  "color",
  "budget",
  "country",
  "city",
  "name",
  "phone",
  "notes",
] as const;
export type V2Profile = Partial<Record<(typeof V2_PROFILE_FIELDS)[number], string>>;

/**
 * Поиск v1 велел на широкий запрос «сказать, чем известна марка» — отсюда
 * в прогонах v2 «PIP — голландская марка, известна качественным текстилем».
 * У v2 стиль задан примерами менеджера, поэтому описание поиска без этого.
 */
const V2_SEARCH_DESCRIPTION =
  "Search the live catalog by free text, category, size, firmness or color. Use before naming any item, price or color. Empty list means nothing matched — do not invent items and do not offer a different category instead. The result reports total_matches: when it is larger than the number of returned cards, say the total and offer to narrow the choice. A broad request (only a brand or a category, no size and no color) comes back as a summary with ask_size_and_color: then do NOT list items — say in one line what there is and from what price, and ask one question about size or color.";

export const V2_TOOLS = [
  ...CONSULTANT_TOOLS.filter((t) => DATA_TOOL_NAMES.has(t.name)).map((t) =>
    t.name === "search_products" ? { ...t, description: V2_SEARCH_DESCRIPTION } : t,
  ),
  {
    name: "handoff_to_manager",
    description:
      "Передать диалог живому менеджеру. Только по причинам из промпта: purchase, wholesale, complaint, human, photo, no_answer. После вызова напишите покупателю одну короткую фразу, что менеджер сейчас подключится, — и больше ничего.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", enum: [...HANDOFF_REASONS] },
        summary: {
          type: "string",
          description:
            "Что нужно покупателю, одной-двумя фразами для менеджера: товар, размер, цвет, количество, вопрос.",
        },
        customer_phone: {
          type: "string",
          description: "Телефон покупателя, только если он сам написал его в чате.",
        },
      },
      required: ["reason", "summary"],
    },
  },
  {
    name: "remember_customer",
    description:
      "Запомнить, что покупатель сказал о своей задаче: что ищет, для кого, размер, цвет, бюджет, страна, город, имя, телефон. Вызывайте, когда узнали новое. В следующих сообщениях это придёт вам в пометке «Что известно о покупателе».",
    input_schema: {
      type: "object",
      properties: {
        looking_for: { type: "string", description: "Что ищет: категория, товар." },
        for_whom: { type: "string", description: "Для кого или для чего: подарок маме, гостевая спальня." },
        size: { type: "string" },
        color: { type: "string" },
        budget: { type: "string", description: "Бюджет словами покупателя." },
        country: { type: "string", description: "Казахстан, Россия или другая страна." },
        city: { type: "string" },
        name: { type: "string" },
        phone: { type: "string", description: "Только если покупатель сам написал." },
        notes: { type: "string", description: "Другое важное для выбора." },
      },
    },
  },
] as const;

/** Сливает новое о покупателе с тем, что уже известно. Пустые значения не стирают старые. */
export function mergeProfile(current: V2Profile | undefined, input: Record<string, unknown>): V2Profile {
  const next: V2Profile = { ...(current ?? {}) };
  for (const field of V2_PROFILE_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) next[field] = value.trim().slice(0, 200);
  }
  return next;
}

const PROFILE_LABELS: Record<(typeof V2_PROFILE_FIELDS)[number], string> = {
  looking_for: "ищет",
  for_whom: "для кого",
  size: "размер",
  color: "цвет",
  budget: "бюджет",
  country: "страна",
  city: "город",
  name: "имя",
  phone: "телефон",
  notes: "ещё",
};

/** Пометка для модели: что уже известно о покупателе. Пусто — пометки нет. */
export function formatProfile(profile: V2Profile | undefined): string {
  if (!profile) return "";
  const lines = V2_PROFILE_FIELDS.filter((f) => profile[f]).map(
    (f) => `${PROFILE_LABELS[f]}: ${profile[f]}`,
  );
  return lines.length ? `[Что известно о покупателе — ${lines.join("; ")}]` : "";
}

/**
 * Что известно о покупателе — строкой в карточке менеджеру: для кого, размер,
 * цвет, откуда. Телефон идёт отдельно, в контакты.
 */
export function profileForManager(profile: V2Profile | undefined): string {
  if (!profile) return "";
  const parts = [
    profile.looking_for,
    profile.for_whom,
    profile.size && `размер ${profile.size}`,
    profile.color,
    profile.budget && `бюджет ${profile.budget}`,
    [profile.city, profile.country].filter(Boolean).join(", "),
    profile.name && `зовут ${profile.name}`,
    profile.notes,
  ].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length ? `О покупателе: ${parts.join("; ")}`.slice(0, 200) : "";
}

export function isHandoffReason(value: unknown): value is V2HandoffReason {
  return typeof value === "string" && (HANDOFF_REASONS as readonly string[]).includes(value);
}
