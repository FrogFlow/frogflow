/**
 * Чистая логика воронки продаж FrogFlow — от поиска лида до закрытия.
 * Без БД и без Anthropic: пороги, дедуп, канал касания, расписание follow-up.
 * Сервер (leads.server.ts) только читает/пишет строки и вызывает ИИ.
 *
 * Автоматизируем всё, что не ломает площадки: поиск, оценка, квалификация,
 * черновик, очередь «сегодня», дожим, проигрыш по тишине. Первое сообщение
 * в WhatsApp/Instagram оператор отправляет сам (один клик открывает чат с
 * текстом) — холодная рассылка в мессенджеры с сервера это спам и бан.
 */

export type PipelineSettings = {
  qualifyMinScore: number;
  rejectMaxScore: number;
  followUpDays: number;
  maxFollowUps: number;
  autoHunt: boolean;
  autoEmail: boolean;
  lostAfterDays: number;
};

export const DEFAULT_PIPELINE: PipelineSettings = {
  qualifyMinScore: 75,
  rejectMaxScore: 45,
  followUpDays: 3,
  maxFollowUps: 2,
  autoHunt: true,
  autoEmail: false,
  lostAfterDays: 21,
};

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function parsePipelineSettings(raw: string | null | undefined): PipelineSettings {
  if (!raw?.trim()) return { ...DEFAULT_PIPELINE };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      qualifyMinScore: clampInt(parsed.qualifyMinScore, 50, 99, DEFAULT_PIPELINE.qualifyMinScore),
      rejectMaxScore: clampInt(parsed.rejectMaxScore, 0, 70, DEFAULT_PIPELINE.rejectMaxScore),
      followUpDays: clampInt(parsed.followUpDays, 1, 14, DEFAULT_PIPELINE.followUpDays),
      maxFollowUps: clampInt(parsed.maxFollowUps, 0, 5, DEFAULT_PIPELINE.maxFollowUps),
      autoHunt: parsed.autoHunt !== false,
      autoEmail: parsed.autoEmail === true,
      lostAfterDays: clampInt(parsed.lostAfterDays, 7, 90, DEFAULT_PIPELINE.lostAfterDays),
    };
  } catch {
    return { ...DEFAULT_PIPELINE };
  }
}

export type ScoreDecision = "qualify" | "reject" | "hold";

export function decideAfterScore(score: number, s: PipelineSettings): ScoreDecision {
  if (score >= s.qualifyMinScore) return "qualify";
  if (score <= s.rejectMaxScore) return "reject";
  return "hold";
}

export type NextAction = { action: string | null; at: string | null };

function addUtcDays(now: Date, days: number): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Что делать дальше после смены стадии — очередь «Сегодня» строится отсюда. */
export function nextActionForStage(
  stage: string,
  now: Date,
  s: PipelineSettings,
): NextAction {
  switch (stage) {
    case "new":
      return { action: "Оценить и квалифицировать", at: now.toISOString() };
    case "qualified":
      return { action: "Написать первое сообщение", at: now.toISOString() };
    case "contacted":
      return {
        action: "Проверить ответ или дожать",
        at: addUtcDays(now, s.followUpDays),
      };
    case "replied":
      return { action: "Закрыть интерес: горячий или отказ", at: addUtcDays(now, 1) };
    case "hot":
      return { action: "Закрыть сделку — онбординг", at: addUtcDays(now, 1) };
    default:
      return { action: null, at: null };
  }
}

export type FollowUpLead = {
  stage: string;
  contacted_at: string | null;
  replied_at: string | null;
  follow_up_count: number;
};

export function shouldFollowUp(lead: FollowUpLead, now: Date, s: PipelineSettings): boolean {
  if (lead.stage !== "contacted") return false;
  if (lead.replied_at) return false;
  if (!lead.contacted_at) return false;
  if (lead.follow_up_count >= s.maxFollowUps) return false;
  const due = new Date(lead.contacted_at);
  due.setUTCDate(due.getUTCDate() + s.followUpDays * (lead.follow_up_count + 1));
  return due.getTime() <= now.getTime();
}

export function shouldMarkLost(lead: FollowUpLead, now: Date, s: PipelineSettings): boolean {
  if (lead.stage !== "contacted") return false;
  if (lead.replied_at) return false;
  if (!lead.contacted_at) return false;
  if (lead.follow_up_count < s.maxFollowUps) return false;
  const deadline = new Date(lead.contacted_at);
  deadline.setUTCDate(deadline.getUTCDate() + s.lostAfterDays);
  return deadline.getTime() <= now.getTime();
}

export function isActionDue(nextActionAt: string | null | undefined, now: Date): boolean {
  if (!nextActionAt) return false;
  const t = new Date(nextActionAt).getTime();
  return Number.isFinite(t) && t <= now.getTime();
}

export type HuntCandidate = {
  business_name: string;
  niche?: string | null;
  city?: string | null;
  website_url?: string | null;
  instagram_handle?: string | null;
  phone?: string | null;
  email?: string | null;
  signals?: string | null;
};

export type ExistingLeadKey = {
  business_name: string;
  website_url: string | null;
  instagram_handle: string | null;
  phone: string | null;
  email: string | null;
};

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "").replace(/\/+$/, "").toLowerCase();
}

export function normalizeUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/** СНГ: 8XXXXXXXXXX и +7… это один номер. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

export function isDuplicate(candidate: HuntCandidate, existing: ExistingLeadKey[]): boolean {
  const name = candidate.business_name.trim().toLowerCase();
  const url = candidate.website_url ? normalizeUrl(candidate.website_url) : "";
  const ig = candidate.instagram_handle ? normalizeHandle(candidate.instagram_handle) : "";
  const phone = candidate.phone ? normalizePhone(candidate.phone) : "";
  const email = candidate.email?.trim().toLowerCase() ?? "";
  for (const row of existing) {
    if (name && row.business_name.trim().toLowerCase() === name) return true;
    if (url && row.website_url && normalizeUrl(row.website_url) === url) return true;
    if (ig && row.instagram_handle && normalizeHandle(row.instagram_handle) === ig) return true;
    if (phone.length >= 10 && row.phone && normalizePhone(row.phone) === phone) return true;
    if (email && row.email?.trim().toLowerCase() === email) return true;
  }
  return false;
}

export type OutreachChannel = "whatsapp" | "email" | "instagram" | "phone" | "none";

export function pickOutreachChannel(lead: {
  email: string | null;
  phone: string | null;
  instagram_handle: string | null;
}): OutreachChannel {
  if (lead.phone?.trim()) return "whatsapp";
  if (lead.email?.trim()) return "email";
  if (lead.instagram_handle?.trim()) return "instagram";
  return "none";
}

export function whatsappHref(phone: string, text?: string | null): string {
  const n = normalizePhone(phone);
  const base = `https://wa.me/${n}`;
  if (!text?.trim()) return base;
  return `${base}?text=${encodeURIComponent(text.trim())}`;
}

export function mailtoHref(email: string, subject: string, body: string): string {
  return `mailto:${email.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function instagramHref(handle: string): string {
  const name = normalizeHandle(handle);
  if (/^https?:\/\//i.test(handle.trim())) return handle.trim();
  return `https://www.instagram.com/${name}/`;
}

/** Ротация запросов ICP по СНГ — крон берёт один в сутки, кнопка в панели — несколько. */
export const HUNT_QUERIES: string[] = [
  "кондитерская бенто торт заказ WhatsApp Instagram Алматы",
  "цветы доставка букет заказ WhatsApp Instagram Ташкент",
  "салон красоты запись WhatsApp без онлайн-записи Казахстан",
  "детский клуб развивающий центр запись WhatsApp Бишкек",
  "печать футболок мерч заказ WhatsApp Алматы",
  "барбершоп запись Instagram WhatsApp Ташкент",
  "фотограф свадьба запись Direct Instagram Ереван",
  "торты на заказ WhatsApp Баку бенто",
  "цветочный магазин заказ WhatsApp Душанбе",
  "кондитерская Instagram Direct заказ Астана",
  "маникюр частный мастер запись WhatsApp Алматы",
  "оптом детская одежда WhatsApp Instagram Казахстан",
  "йога студия запись WhatsApp Бишкек",
  "доставка цветов Тбилиси Instagram WhatsApp",
];

export function huntQueryForDay(now: Date, offset = 0): string {
  const day = Math.floor(now.getTime() / 86_400_000);
  const i = ((day + offset) % HUNT_QUERIES.length + HUNT_QUERIES.length) % HUNT_QUERIES.length;
  return HUNT_QUERIES[i]!;
}

export type SearchHit = { title: string; url: string; snippet: string };

function decodeDuckHref(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const dest = u.searchParams.get("uddg") || u.searchParams.get("u");
    return dest ? decodeURIComponent(dest) : href;
  } catch {
    return href;
  }
}

/** Разбор html.duckduckgo.com/html — запасной поиск без ключа API. */
export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const re =
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < 12) {
    const url = decodeDuckHref(m[1] ?? "");
    const title = stripTags(m[2] ?? "").trim();
    const snippet = stripTags(m[3] ?? "").trim();
    if (!url || !title) continue;
    if (url.includes("duckduckgo.com")) continue;
    hits.push({ title, url, snippet });
  }
  if (hits.length === 0) {
    const alt = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = alt.exec(html)) && hits.length < 12) {
      const url = decodeDuckHref(m[1] ?? "");
      const title = stripTags(m[2] ?? "").trim();
      if (!url || !title || url.includes("duckduckgo.com")) continue;
      hits.push({ title, url, snippet: "" });
    }
  }
  return hits;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const EXTRACT_KEYS = [
  "business_name",
  "niche",
  "city",
  "website_url",
  "instagram_handle",
  "phone",
  "email",
  "signals",
] as const;

function asText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t === "null") return null;
  return t.slice(0, max);
}

export function clampCandidate(raw: unknown): HuntCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const business_name = asText(o.business_name, 200);
  if (!business_name) return null;
  const website_url = asText(o.website_url, 500);
  const instagram_handle = asText(o.instagram_handle, 200);
  const phone = asText(o.phone, 100);
  const email = asText(o.email, 200);
  if (!website_url && !instagram_handle && !phone && !email) return null;
  return {
    business_name,
    niche: asText(o.niche, 200),
    city: asText(o.city, 200),
    website_url,
    instagram_handle,
    phone,
    email,
    signals: asText(o.signals, 2000),
  };
}

/** Достаёт JSON-массив лидов из ответа ИИ (иногда вокруг болтовня или ```json). */
export function parseExtractedLeads(text: string): HuntCandidate[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1] ?? text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: HuntCandidate[] = [];
  for (const row of parsed) {
    const c = clampCandidate(row);
    if (c) out.push(c);
  }
  return out;
}

export function searchHitsPromptBlock(hits: SearchHit[]): string {
  return hits
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
    .join("\n");
}

export const ICP_EXTRACT_RULES =
  `FrogFlow продаёт ботов Telegram/Instagram/WhatsApp малому бизнесу СНГ, ` +
  `у которого заказ или запись идут руками в мессенджере, а сайта-корзины нет ` +
  `(кондитеры, цветы, одежда/директ, салоны, детские клубы, фотографы, мерч, инфопродукт). ` +
  `НЕ бери: YCLIENTS/Alteg/Zapis.kz/Kaspi-магазин/Salebot если уже стоят и это основной канал; ` +
  `агрегаторы вроде Flowwow; сети с полноценной онлайн-оплатой и корзиной. ` +
  `Верни СТРОГО JSON-массив объектов с полями ${EXTRACT_KEYS.join(", ")}. ` +
  `signals — что намекает на потребность в боте (1–2 предложения). ` +
  `instagram_handle с @. Пустой массив, если подходящих нет. Без текста вокруг JSON.`;
