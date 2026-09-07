/**
 * Лиды для собственного отдела продаж FrogFlow — поиск новых клиентов
 * (владельцев ботов), а не данные ни одного клиентского магазина.
 * MIGRATION-63 + MIGRATION-67 (очередь касаний и журнал событий).
 *
 * Воронка: hunt → score → qualify/reject → draft → очередь «сегодня» →
 * оператор жмёт «Написал» (открывается WhatsApp/почта с текстом) → follow-up
 * кроном → lost по тишине / converted руками. Score сам сделку не закрывает.
 */
import { requireOperator } from "./guard.server";
import type { TablesUpdate } from "@/integrations-supabase/types";
import { callAnthropic, isLeadsAiKeyPresent } from "./leads-ai.server";
import { extractCandidates, isHuntConfigured, searchWeb } from "./leads-hunt.server";
import {
  DEFAULT_PIPELINE,
  decideAfterScore,
  huntQueryForDay,
  isDuplicate,
  nextActionForStage,
  parsePipelineSettings,
  pickOutreachChannel,
  shouldFollowUp,
  shouldMarkLost,
  type ExistingLeadKey,
  type HuntCandidate,
  type PipelineSettings,
} from "./leads-pipeline";
import { isMailConfigured, sendPlainTextMail } from "@/lib/mail.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

const SETTINGS_KEY = "sales_pipeline";
const PROCESS_BATCH = 3;
const HUNT_MAX_INSERT = 6;

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
  next_action: string | null;
  next_action_at: string | null;
  follow_up_count: number;
  last_touch_at: string | null;
  outreach_channel: string | null;
  follow_up_draft: string | null;
  auto_processed_at: string | null;
  lost_reason: string | null;
};

export type LeadEvent = {
  id: string;
  lead_id: string;
  created_at: string;
  actor: string;
  kind: string;
  detail: string | null;
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

function asLead(row: SalesLead): SalesLead {
  return {
    ...row,
    follow_up_count: row.follow_up_count ?? 0,
  };
}

export async function isLeadsAiConfigured(): Promise<boolean> {
  await requireOperator();
  return isLeadsAiKeyPresent();
}

export async function getPipelineSettings(): Promise<PipelineSettings> {
  const s = await db();
  const { data } = await s
    .from("operator_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  return parsePipelineSettings(data?.value);
}

export async function savePipelineSettings(patch: Partial<PipelineSettings>): Promise<PipelineSettings> {
  const current = await getPipelineSettings();
  const next = parsePipelineSettings(JSON.stringify({ ...current, ...patch }));
  const s = await db();
  const { error } = await s
    .from("operator_settings")
    .upsert({ key: SETTINGS_KEY, value: JSON.stringify(next) });
  if (error) throw new Error(`Не удалось сохранить настройки воронки: ${error.message}`);
  return next;
}

async function logLeadEvent(
  leadId: string,
  actor: string,
  kind: string,
  detail?: string | null,
): Promise<void> {
  const s = await db();
  const { error } = await s.from("sales_lead_events").insert({
    lead_id: leadId,
    actor,
    kind,
    detail: detail?.slice(0, 2000) || null,
  });
  if (error) {
    console.error(`[leads] не записали событие ${kind} для ${leadId}:`, error.message);
  }
}

export async function listLeadEvents(leadId: string): Promise<LeadEvent[]> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s
    .from("sales_lead_events")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`Не удалось загрузить события: ${error.message}`);
  return (data ?? []) as LeadEvent[];
}

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
  return ((data ?? []) as SalesLead[]).map(asLead);
}

export async function listDueLeads(now = new Date()): Promise<SalesLead[]> {
  await requireOperator();
  return listDueLeadsInternal(now);
}

async function listDueLeadsInternal(now: Date): Promise<SalesLead[]> {
  const s = await db();
  const { data, error } = await s
    .from("sales_leads")
    .select("*")
    .not("next_action", "is", null)
    .lte("next_action_at", now.toISOString())
    .order("next_action_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(`Не удалось загрузить очередь: ${error.message}`);
  return ((data ?? []) as SalesLead[])
    .map(asLead)
    .filter((l) => l.stage !== "rejected" && l.stage !== "lost" && l.stage !== "converted");
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

async function applyNextAction(
  id: string,
  stage: LeadStage,
  extra: TablesUpdate<"sales_leads"> = {},
  now = new Date(),
): Promise<void> {
  const settings = await getPipelineSettings();
  const next = nextActionForStage(stage, now, settings);
  const s = await db();
  const { error } = await s
    .from("sales_leads")
    .update({
      stage,
      next_action: next.action,
      next_action_at: next.at,
      updated_at: now.toISOString(),
      ...extra,
    })
    .eq("id", id);
  if (error) throw new Error(`Не удалось обновить лида: ${error.message}`);
}

export async function createLead(input: LeadInput, createdBy: string): Promise<SalesLead> {
  await requireOperator();
  const now = new Date();
  const settings = await getPipelineSettings();
  const next = nextActionForStage("new", now, settings);
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
      next_action: next.action,
      next_action_at: next.at,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Не удалось добавить лида: ${error.message}`);
  const lead = asLead(data as SalesLead);
  await logLeadEvent(lead.id, createdBy, "found", "Добавлен вручную");
  return lead;
}

export async function updateLeadStage(id: string, stage: LeadStage, actor = "operator"): Promise<void> {
  await requireOperator();
  await transitionLead(id, stage, actor);
}

async function transitionLead(id: string, stage: LeadStage, actor: string): Promise<void> {
  const now = new Date();
  const extra: TablesUpdate<"sales_leads"> = {};
  if (stage === "contacted") {
    extra.contacted_at = now.toISOString();
    extra.last_touch_at = now.toISOString();
  }
  if (stage === "replied") extra.replied_at = now.toISOString();
  if (stage === "lost" && !extra.lost_reason) {
    extra.lost_reason = extra.lost_reason ?? "вручную";
  }
  await applyNextAction(id, stage, extra, now);
  await logLeadEvent(id, actor, stage, null);
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
  return asLead(data as SalesLead);
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

function parseScoreJson(text: string): { score: number; reason: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Не удалось разобрать ответ ИИ: ${text.slice(0, 200)}`);
  let parsed: { score?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error(`Не удалось разобрать ответ ИИ: ${text.slice(0, 200)}`);
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
  if (!Number.isFinite(score)) throw new Error(`ИИ вернул нечисловую оценку: ${text.slice(0, 200)}`);
  return { score, reason: String(parsed.reason ?? "").slice(0, 500) };
}

async function scoreLeadInternal(
  id: string,
  actor: string,
  applyDecision: boolean,
): Promise<{ score: number; reason: string; decision: string }> {
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
  const { score, reason } = parseScoreJson(text);
  const settings = await getPipelineSettings();
  const decision = decideAfterScore(score, settings);
  const s = await db();
  const { error } = await s
    .from("sales_leads")
    .update({
      score,
      score_reason: reason,
      auto_processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`Не удалось сохранить оценку: ${error.message}`);
  await logLeadEvent(id, actor, "scored", `${score}: ${reason}`);

  if (applyDecision && lead.stage === "new") {
    if (decision === "qualify") {
      await applyNextAction(id, "qualified");
      await logLeadEvent(id, actor, "qualified", `авто, балл ${score}`);
    } else if (decision === "reject") {
      await applyNextAction(id, "rejected");
      await logLeadEvent(id, actor, "rejected", `авто, балл ${score}`);
    } else {
      await applyNextAction(id, "new", {
        next_action: "Посмотреть глазами — балл средний",
        next_action_at: new Date().toISOString(),
      });
    }
  }
  return { score, reason, decision };
}

export async function scoreLead(id: string): Promise<{ score: number; reason: string }> {
  await requireOperator();
  const r = await scoreLeadInternal(id, "operator", false);
  return { score: r.score, reason: r.reason };
}

async function generateDraftInternal(id: string, actor: string): Promise<{ draft: string }> {
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
  await logLeadEvent(id, actor, "drafted", null);
  return { draft };
}

export async function generateDraft(id: string): Promise<{ draft: string }> {
  await requireOperator();
  return generateDraftInternal(id, "operator");
}

async function generateFollowUpInternal(id: string, actor: string): Promise<string> {
  const lead = await getLeadOrThrow(id);
  const prompt =
    `Напиши короткое (3–5 предложений) повторное сообщение на русском для этого бизнеса. ` +
    `Ранее уже писали, ответа нет. Без "здравствуйте меня зовут", без подписи, без markdown. ` +
    `Сошлись на то, что уже обсуждали (заказ/запись в мессенджере), предложи 15 минут созвона ` +
    `или коротко показать, как бот закрывает их конкретный канал.\n\n${leadBrief(lead)}`;
  const text = await callAnthropic(prompt, 800);
  if (!text?.trim()) throw new Error("Пустой ответ от Anthropic");
  const draft = text.trim();
  const s = await db();
  const { error } = await s
    .from("sales_leads")
    .update({ follow_up_draft: draft, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Не удалось сохранить дожим: ${error.message}`);
  await logLeadEvent(id, actor, "follow_up_draft", null);
  return draft;
}

export type HuntResult = {
  query: string;
  backend: string;
  hits: number;
  inserted: number;
  skippedDup: number;
  skippedWeak: number;
  error?: string;
};

async function existingKeys(): Promise<ExistingLeadKey[]> {
  const s = await db();
  const { data, error } = await s
    .from("sales_leads")
    .select("business_name, website_url, instagram_handle, phone, email");
  if (error) throw new Error(`Не удалось прочитать существующих лидов: ${error.message}`);
  return (data ?? []) as ExistingLeadKey[];
}

async function insertHunted(
  candidate: HuntCandidate,
  actor: string,
  now: Date,
  settings: PipelineSettings,
): Promise<string> {
  const next = nextActionForStage("new", now, settings);
  const s = await db();
  const { data, error } = await s
    .from("sales_leads")
    .insert({
      business_name: candidate.business_name,
      niche: candidate.niche ?? null,
      city: candidate.city ?? null,
      website_url: candidate.website_url ?? null,
      instagram_handle: candidate.instagram_handle ?? null,
      phone: candidate.phone ?? null,
      email: candidate.email ?? null,
      signals: candidate.signals ?? null,
      source: "web_search",
      created_by: actor,
      next_action: next.action,
      next_action_at: next.at,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Не удалось сохранить найденного лида: ${error.message}`);
  const id = (data as { id: string }).id;
  await logLeadEvent(id, actor, "found", "Автопоиск");
  return id;
}

export async function huntLeads(opts: {
  query?: string | null;
  actor: string;
  maxInsert?: number;
}): Promise<HuntResult> {
  if (!isHuntConfigured()) {
    return {
      query: opts.query ?? "",
      backend: "none",
      hits: 0,
      inserted: 0,
      skippedDup: 0,
      skippedWeak: 0,
      error: "Нужен ANTHROPIC_API_KEY, чтобы из выдачи вынуть подходящих, а не складывать мусор.",
    };
  }
  const query = opts.query?.trim() || huntQueryForDay(new Date());
  let backend = "";
  let hits: Awaited<ReturnType<typeof searchWeb>>["hits"] = [];
  try {
    const searched = await searchWeb(query);
    backend = searched.backend;
    hits = searched.hits;
  } catch (e: unknown) {
    return {
      query,
      backend: "error",
      hits: 0,
      inserted: 0,
      skippedDup: 0,
      skippedWeak: 0,
      error: e instanceof Error ? e.message : "Поиск не удался",
    };
  }
  const extracted = await extractCandidates(query, hits);
  const known = await existingKeys();
  const settings = await getPipelineSettings();
  const now = new Date();
  let inserted = 0;
  let skippedDup = 0;
  let skippedWeak = 0;
  const cap = opts.maxInsert ?? HUNT_MAX_INSERT;
  for (const c of extracted) {
    if (inserted >= cap) break;
    if (isDuplicate(c, known)) {
      skippedDup++;
      continue;
    }
    if (!c.website_url && !c.instagram_handle && !c.phone && !c.email) {
      skippedWeak++;
      continue;
    }
    await insertHunted(c, opts.actor, now, settings);
    known.push({
      business_name: c.business_name,
      website_url: c.website_url ?? null,
      instagram_handle: c.instagram_handle ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
    });
    inserted++;
  }
  return {
    query,
    backend,
    hits: hits.length,
    inserted,
    skippedDup,
    skippedWeak: skippedWeak + Math.max(0, extracted.length - inserted - skippedDup),
  };
}

export type ProcessResult = {
  scored: number;
  qualified: number;
  rejected: number;
  drafted: number;
  followUps: number;
  lost: number;
  emailed: number;
  errors: string[];
};

export async function processPipeline(actor: string, now = new Date()): Promise<ProcessResult> {
  const result: ProcessResult = {
    scored: 0,
    qualified: 0,
    rejected: 0,
    drafted: 0,
    followUps: 0,
    lost: 0,
    emailed: 0,
    errors: [],
  };
  const settings = await getPipelineSettings();
  const s = await db();
  const { data: all, error } = await s.from("sales_leads").select("*");
  if (error) throw new Error(`Не удалось прогнать воронку: ${error.message}`);
  const leads = ((all ?? []) as SalesLead[]).map(asLead);

  const needScore = leads.filter((l) => l.stage === "new" && l.score === null).slice(0, PROCESS_BATCH);
  if (isLeadsAiKeyPresent()) {
    for (const lead of needScore) {
      try {
        const r = await scoreLeadInternal(lead.id, actor, true);
        result.scored++;
        if (r.decision === "qualify") result.qualified++;
        if (r.decision === "reject") result.rejected++;
      } catch (e: unknown) {
        result.errors.push(`${lead.business_name}: ${e instanceof Error ? e.message : "оценка"}`);
      }
    }
  }

  const { data: afterScore } = await s.from("sales_leads").select("*");
  const fresh = ((afterScore ?? all ?? []) as SalesLead[]).map(asLead);

  const needDraft = fresh
    .filter((l) => l.stage === "qualified" && !l.draft_message)
    .slice(0, PROCESS_BATCH);
  if (isLeadsAiKeyPresent()) {
    for (const lead of needDraft) {
      try {
        await generateDraftInternal(lead.id, actor);
        result.drafted++;
      } catch (e: unknown) {
        result.errors.push(`${lead.business_name}: ${e instanceof Error ? e.message : "черновик"}`);
      }
    }
  }

  if (settings.autoEmail && isMailConfigured()) {
    const ready = fresh.filter(
      (l) => l.stage === "qualified" && l.draft_message && l.email && !l.contacted_at,
    );
    for (const lead of ready.slice(0, PROCESS_BATCH)) {
      try {
        const sent = await sendPlainTextMail({
          to: lead.email!,
          subject: `FrogFlow — бот под ${lead.business_name}`,
          text: lead.draft_message!,
        });
        if (sent.ok) {
          const channel = pickOutreachChannel(lead);
          await applyNextAction(lead.id, "contacted", {
            contacted_at: now.toISOString(),
            last_touch_at: now.toISOString(),
            outreach_channel: "email",
          });
          await logLeadEvent(lead.id, actor, "emailed", channel);
          result.emailed++;
        } else {
          result.errors.push(`${lead.business_name}: ${sent.error}`);
        }
      } catch (e: unknown) {
        result.errors.push(`${lead.business_name}: ${e instanceof Error ? e.message : "письмо"}`);
      }
    }
  }

  const { data: afterDraft } = await s.from("sales_leads").select("*");
  const current = ((afterDraft ?? fresh) as SalesLead[]).map(asLead);

  for (const lead of current) {
    if (shouldMarkLost(lead, now, settings)) {
      try {
        await applyNextAction(lead.id, "lost", { lost_reason: "тишина после дожимов" });
        await logLeadEvent(lead.id, actor, "lost", "тишина после дожимов");
        result.lost++;
      } catch (e: unknown) {
        result.errors.push(`${lead.business_name}: ${e instanceof Error ? e.message : "lost"}`);
      }
      continue;
    }
    if (!shouldFollowUp(lead, now, settings)) continue;
    try {
      if (isLeadsAiKeyPresent()) {
        await generateFollowUpInternal(lead.id, actor);
      }
      const nextCount = lead.follow_up_count + 1;
      await s
        .from("sales_leads")
        .update({
          follow_up_count: nextCount,
          next_action: "Отправить дожим",
          next_action_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", lead.id);
      await logLeadEvent(lead.id, actor, "follow_up", `касание ${nextCount}`);
      result.followUps++;
    } catch (e: unknown) {
      result.errors.push(`${lead.business_name}: ${e instanceof Error ? e.message : "дожим"}`);
    }
  }

  return result;
}

export async function markContacted(
  id: string,
  actor: string,
  channel?: string | null,
): Promise<void> {
  await requireOperator();
  const lead = await getLeadOrThrow(id);
  const ch = channel || pickOutreachChannel(lead);
  await applyNextAction(id, "contacted", {
    contacted_at: new Date().toISOString(),
    last_touch_at: new Date().toISOString(),
    outreach_channel: ch === "none" ? null : ch,
  });
  await logLeadEvent(id, actor, "contacted", ch);
}

export async function markFollowUpSent(id: string, actor: string): Promise<void> {
  await requireOperator();
  const settings = await getPipelineSettings();
  const now = new Date();
  const s = await db();
  await s
    .from("sales_leads")
    .update({
      last_touch_at: now.toISOString(),
      next_action: "Проверить ответ или дожать",
      next_action_at: new Date(
        now.getTime() + settings.followUpDays * 86_400_000,
      ).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", id);
  await logLeadEvent(id, actor, "follow_up_sent", null);
}

export type PipelineStatus = {
  settings: PipelineSettings;
  aiConfigured: boolean;
  huntConfigured: boolean;
  mailConfigured: boolean;
  due: SalesLead[];
};

export async function pipelineStatus(): Promise<PipelineStatus> {
  await requireOperator();
  const [settings, due] = await Promise.all([getPipelineSettings(), listDueLeadsInternal(new Date())]);
  return {
    settings,
    aiConfigured: isLeadsAiKeyPresent(),
    huntConfigured: isHuntConfigured(),
    mailConfigured: isMailConfigured(),
    due,
  };
}

/** Суточный проход крона: при autoHunt — один запрос, затем прогон воронки. */
export async function runDailyLeadsPipeline(now = new Date()): Promise<{
  hunt: HuntResult | null;
  process: ProcessResult;
}> {
  const settings = await getPipelineSettings();
  const process = await processPipeline("cron", now);
  let hunt: HuntResult | null = null;
  if (settings.autoHunt) {
    hunt = await huntLeads({
      query: huntQueryForDay(now),
      actor: "cron",
      maxInsert: 5,
    });
  }
  return { hunt, process };
}

export { DEFAULT_PIPELINE };
