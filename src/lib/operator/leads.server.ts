/**
 * Лиды для собственного отдела продаж FrogFlow — поиск новых клиентов
 * (владельцев ботов), а не данные ни одного клиентского магазина.
 * MIGRATION-63-sales-leads.sql — не применена в этой среде (нет доступа к
 * боевой БД), см. MIGRATION-README.md.
 *
 * ИИ (Anthropic) здесь — только совет: оценка (score/scoreReason) и черновик
 * первого сообщения (draftMessage). Стадию пайплайна всегда двигает оператор
 * вручную — score сам по себе не отклоняет и не квалифицирует лида.
 *
 * Тот же fetch-паттерн, что и в smart-search.server.ts (тот единственный
 * рабочий пример вызова Anthropic API в проекте): голый fetch без SDK,
 * x-api-key + anthropic-version, AbortSignal.timeout. Дневной лимит/кулдаун
 * оттуда сюда не переносим — это внутренний инструмент оператора, не
 * публичный бот, которым может закидать посторонний человек.
 */
import { requireOperator } from "./guard.server";
import type { TablesUpdate } from "@/integrations-supabase/types";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 40_000;

export type LeadStage =
  "new" | "qualified" | "rejected" | "contacted" | "replied" | "hot" | "converted" | "lost";

export const LEAD_STAGES: LeadStage[] = [
  "new",
  "qualified",
  "rejected",
  "contacted",
  "replied",
  "hot",
  "converted",
  "lost",
];

export type SalesLead = {
  id: string;
  created_at: string;
  updated_at: string;
  business_name: string;
  niche: string | null;
  city: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  phone: string | null;
  email: string | null;
  signals: string | null;
  source: string;
  stage: LeadStage;
  score: number | null;
  score_reason: string | null;
  draft_message: string | null;
  notes: string | null;
  created_by: string | null;
  contacted_at: string | null;
  replied_at: string | null;
};

export type LeadInput = {
  business_name: string;
  niche?: string | null;
  city?: string | null;
  website_url?: string | null;
  instagram_handle?: string | null;
  phone?: string | null;
  email?: string | null;
  signals?: string | null;
};

export async function listLeads(filter?: { stage?: LeadStage; q?: string }): Promise<SalesLead[]> {
  await requireOperator();
  const s = await db();
  let query = s.from("sales_leads").select("*").order("created_at", { ascending: false });
  if (filter?.stage) query = query.eq("stage", filter.stage);
  if (filter?.q?.trim()) {
    const q = filter.q.trim();
    query = query.or(
      `business_name.ilike.%${q}%,niche.ilike.%${q}%,city.ilike.%${q}%,email.ilike.%${q}%`,
    );
  }
  const { data, error } = await query;
  if (error) throw new Error(`Не удалось загрузить лидов: ${error.message}`);
  return (data ?? []) as SalesLead[];
}

export async function funnelCounts(): Promise<Record<LeadStage, number>> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s.from("sales_leads").select("stage");
  if (error) throw new Error(`Не удалось посчитать воронку: ${error.message}`);
  const counts = Object.fromEntries(LEAD_STAGES.map((st) => [st, 0])) as Record<LeadStage, number>;
  for (const row of data ?? []) {
    const stage = row.stage as LeadStage;
    if (stage in counts) counts[stage]++;
  }
  return counts;
}

export async function createLead(input: LeadInput, createdBy: string): Promise<SalesLead> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s
    .from("sales_leads")
    .insert({
      business_name: input.business_name.trim(),
      niche: input.niche?.trim() || null,
      city: input.city?.trim() || null,
      website_url: input.website_url?.trim() || null,
      instagram_handle: input.instagram_handle?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      signals: input.signals?.trim() || null,
      created_by: createdBy,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Не удалось добавить лида: ${error.message}`);
  return data as SalesLead;
}

export async function updateLeadStage(id: string, stage: LeadStage): Promise<void> {
  await requireOperator();
  const s = await db();
  const patch: TablesUpdate<"sales_leads"> = { stage, updated_at: new Date().toISOString() };
  if (stage === "contacted") patch.contacted_at = new Date().toISOString();
  if (stage === "replied") patch.replied_at = new Date().toISOString();
  const { error } = await s.from("sales_leads").update(patch).eq("id", id);
  if (error) throw new Error(`Не удалось сменить стадию: ${error.message}`);
}

export async function updateLeadNotes(id: string, notes: string): Promise<void> {
  await requireOperator();
  const s = await db();
  const { error } = await s
    .from("sales_leads")
    .update({ notes: notes.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Не удалось сохранить заметку: ${error.message}`);
}

export async function deleteLead(id: string): Promise<void> {
  await requireOperator();
  const s = await db();
  const { error } = await s.from("sales_leads").delete().eq("id", id);
  if (error) throw new Error(`Не удалось удалить лида: ${error.message}`);
}

async function getLeadOrThrow(id: string): Promise<SalesLead> {
  const s = await db();
  const { data, error } = await s.from("sales_leads").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Лид не найден");
  return data as SalesLead;
}

function leadBrief(lead: SalesLead): string {
  const lines = [
    `Бизнес: ${lead.business_name}`,
    lead.niche && `Ниша: ${lead.niche}`,
    lead.city && `Город: ${lead.city}`,
    lead.website_url && `Сайт: ${lead.website_url}`,
    lead.instagram_handle && `Instagram: ${lead.instagram_handle}`,
    lead.signals && `Наблюдения: ${lead.signals}`,
  ].filter(Boolean);
  return lines.join("\n");
}

async function callAnthropic(prompt: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY не задан на этом деплое");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return json.content?.find((b) => b.type === "text")?.text ?? null;
}

/**
 * Оценка потенциала лида ИИ — только совет: score/reason сохраняются в
 * строку, но никакая стадия автоматически не двигается. Оператор сам решает,
 * квалифицировать лида или отклонить, глядя на объяснение.
 */
export async function scoreLead(id: string): Promise<{ score: number; reason: string }> {
  await requireOperator();
  const lead = await getLeadOrThrow(id);
  const prompt =
    `Ты помогаешь оценить потенциального клиента для FrogFlow — сервиса, который делает ` +
    `Telegram/Instagram/WhatsApp-ботов для приёма заказов и записи клиентов малому бизнесу.\n\n` +
    `${leadBrief(lead)}\n\n` +
    `Оцени от 0 до 100, насколько этому бизнесу вероятно нужна такая автоматизация ` +
    `(сигналы "за": запись/заказы идут вручную через мессенджер или телефон, нет онлайн-записи ` +
    `на сайте, много отзывов/большой поток клиентов, которые администратор не успевает обрабатывать; ` +
    `сигналы "против": уже есть полноценная CRM/онлайн-запись, бизнес слишком маленький или разовый). ` +
    `Ответь СТРОГО одним JSON-объектом без пояснений снаружи: {"score": <число>, "reason": "<кратко, 1-2 предложения, по-русски>"}.`;
  const text = await callAnthropic(prompt, 1000);
  if (!text) throw new Error("Пустой ответ от Anthropic");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Не удалось разобрать ответ ИИ: ${text.slice(0, 200)}`);
  let parsed: { score?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error(`Не удалось разобрать ответ ИИ: ${text.slice(0, 200)}`);
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
  if (!Number.isFinite(score))
    throw new Error(`ИИ вернул нечисловую оценку: ${text.slice(0, 200)}`);
  const reason = String(parsed.reason ?? "").slice(0, 500);

  const s = await db();
  const { error } = await s
    .from("sales_leads")
    .update({ score, score_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Не удалось сохранить оценку: ${error.message}`);
  return { score, reason };
}

/** Персональный черновик первого сообщения — оператор проверяет и правит перед отправкой. */
export async function generateDraft(id: string): Promise<{ draft: string }> {
  await requireOperator();
  const lead = await getLeadOrThrow(id);
  const prompt =
    `Ты помогаешь оператору FrogFlow написать первое персональное письмо потенциальному клиенту. ` +
    `FrogFlow делает Telegram/Instagram/WhatsApp-ботов, которые принимают заказы/запись 24/7 и ` +
    `разгружают администратора от рутинной переписки.\n\n` +
    `${leadBrief(lead)}\n\n` +
    `Напиши короткое (4-6 предложений) персональное письмо на русском, обращённое именно к этому ` +
    `бизнесу — сославшись на конкретные наблюдения выше, а не общими словами. Без "здравствуйте, ` +
    `меня зовут" и без подписи в конце (это добавит оператор сам). Без markdown-разметки. Тон — ` +
    `деловой и конкретный, не рекламный. Ответь только текстом письма, без пояснений вокруг.`;
  const text = await callAnthropic(prompt, 1000);
  if (!text?.trim()) throw new Error("Пустой ответ от Anthropic");
  const draft = text.trim();

  const s = await db();
  const { error } = await s
    .from("sales_leads")
    .update({ draft_message: draft, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Не удалось сохранить черновик: ${error.message}`);
  return { draft };
}
