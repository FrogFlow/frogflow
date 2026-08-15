import { requireOperator } from "./guard.server";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { callInternal } from "./internal-client.server";
import type { Json } from "@/integrations-supabase/types";
import { computeState, readPolicy, type SubscriptionState } from "./subscriptions.server";

type BotStatus = "active" | "paused" | "suspended";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

type BotBase = {
  id: string;
  bot_name: string;
  status: BotStatus;
  owner_name: string | null;
  app_url: string | null;
  notes: string | null;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
};

/**
 * Строка списка. Состояние подписки посчитано заранее — список должен красить
 * просрочку без запроса на каждого клиента. Карточка берёт то же самое
 * отдельно, через subscriptions.server.ts, вместе с историей платежей.
 */
export type BotListItem = BotBase & {
  subscription_state: SubscriptionState;
  subscription_days_left: number | null;
};

export async function listBots(): Promise<BotListItem[]> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s
    .from("bots")
    .select(
      "id, bot_name, status, owner_name, app_url, notes, subscription_plan, subscription_expires_at, settings",
    )
    .order("bot_name", { ascending: true });
  if (error) throw new Error(`Не удалось получить список клиентов: ${error.message}`);

  // Одним запросом: у кого вообще есть платежи. Без этого дата, доставшаяся от
  // заведения строки, выглядела бы как подтверждённая оплата.
  const { data: paid } = await s.from("subscription_payments").select("bot_id");
  const withPayments = new Set((paid ?? []).map((r) => r.bot_id));

  return (data ?? []).map((b) => {
    const sub = computeState(
      b.subscription_expires_at,
      readPolicy(b.settings),
      withPayments.has(b.id),
    );
    return {
      id: b.id,
      bot_name: b.bot_name,
      status: b.status as BotStatus,
      owner_name: b.owner_name,
      app_url: b.app_url,
      notes: b.notes,
      subscription_plan: b.subscription_plan,
      subscription_expires_at: b.subscription_expires_at,
      subscription_state: sub.state,
      subscription_days_left: sub.daysLeft,
    };
  });
}

export type BotDetail = BotBase & {
  modules: Record<ModuleKey, boolean>;
  owner_telegram_id: number | null;
  owner_contact: string | null;
  paused_message: string | null;
  /**
   * Заполнен ли internal_secret — но не он сам. Само значение это пароль
   * панели ко внутреннему API деплоя; интерфейсу оно не нужно, а отдавать его
   * в браузер значит класть его в память вкладки, в devtools и в любой отчёт
   * об ошибке. Панели он нужен на сервере, где и читается.
   */
  has_internal_secret: boolean;
};

export async function getBot(botId: string): Promise<BotDetail> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s.from("bots").select("*").eq("id", botId).single();
  if (error || !data) throw new Error(`Клиент не найден: ${error?.message ?? botId}`);

  const rawModules = (data.modules as Record<string, boolean> | null) ?? {};
  const modules = {} as Record<ModuleKey, boolean>;
  for (const key of MODULE_KEYS) modules[key] = rawModules[key] === true;

  return {
    id: data.id,
    bot_name: data.bot_name,
    status: data.status as BotStatus,
    owner_name: data.owner_name,
    owner_contact: data.owner_contact,
    owner_telegram_id: data.owner_telegram_id,
    app_url: data.app_url,
    notes: data.notes,
    paused_message: data.paused_message,
    has_internal_secret: Boolean(data.internal_secret),
    subscription_plan: data.subscription_plan,
    subscription_expires_at: data.subscription_expires_at,
    modules,
  };
}

export async function setModule(botId: string, key: ModuleKey, enabled: boolean, actor: string) {
  await requireOperator();
  const def = moduleDef(key);
  if (!def || def.status !== "available") {
    throw new Error(
      `Модуль «${def?.title ?? key}» ещё не готов к включению — кода нет, только запись в прайсе.`,
    );
  }

  const s = await db();
  const { data: row, error: readErr } = await s
    .from("bots")
    .select("modules")
    .eq("id", botId)
    .single();
  if (readErr || !row) throw new Error(`Клиент не найден: ${readErr?.message ?? botId}`);

  const current = (row.modules as Record<string, boolean> | null) ?? {};
  if (enabled && def.requires?.length) {
    const missing = def.requires.filter((dep) => current[dep] !== true);
    if (missing.length > 0) {
      const titles = missing.map((dep) => moduleDef(dep as ModuleKey)?.title ?? dep).join(", ");
      throw new Error(`Сначала включите: ${titles}`);
    }
  }

  const modules = { ...current, [key]: enabled };
  const { error } = await s.from("bots").update({ modules }).eq("id", botId);
  if (error) throw new Error(`Не удалось сохранить модуль: ${error.message}`);

  await s.from("bot_events").insert({
    bot_id: botId,
    actor,
    kind: enabled ? "module_on" : "module_off",
    payload: { key },
  });

  await nudgeDeployment(botId);
}

/**
 * Просит деплой сбросить кеш модулей, чтобы тумблер сработал сразу, а не в
 * течение минуты. Best-effort и намеренно не влияет на исход: значение уже
 * сохранено в базе, а деплой подтянет его по TTL даже если сейчас лежит.
 * Ошибку показываем только в логах — иначе успешное переключение выглядело бы
 * в панели как неудача.
 */
async function nudgeDeployment(botId: string) {
  const s = await db();
  const { data } = await s.from("bots").select("app_url, internal_secret").eq("id", botId).single();
  if (!data) return;

  const res = await callInternal(data, "/api/internal/reload", {});
  if (!res.ok) {
    console.warn(`[operator] сброс кеша ${botId} не удался (${res.kind}): ${res.error}`);
  }
}

export async function setBotStatus(botId: string, status: BotStatus, actor: string) {
  await requireOperator();
  const s = await db();
  const { error } = await s.from("bots").update({ status }).eq("id", botId);
  if (error) throw new Error(`Не удалось изменить статус: ${error.message}`);

  const { error: evErr } = await s.from("bot_events").insert({
    bot_id: botId,
    actor,
    kind: status === "active" ? "resume" : status === "suspended" ? "suspend" : "pause",
    payload: { status },
  });
  if (evErr) console.error("[operator] не удалось записать bot_events:", evErr.message);

  // Тем же кешем читается и статус — пауза должна вступать в силу сразу.
  await nudgeDeployment(botId);
}

export type BotMetaPatch = Partial<{
  owner_name: string | null;
  owner_contact: string | null;
  owner_telegram_id: number | null;
  app_url: string | null;
  notes: string | null;
  paused_message: string | null;
}>;

export async function updateBotMeta(botId: string, patch: BotMetaPatch) {
  await requireOperator();
  const s = await db();
  const { error } = await s.from("bots").update(patch).eq("id", botId);
  if (error) throw new Error(`Не удалось сохранить данные клиента: ${error.message}`);
}

export type BotEvent = {
  id: string;
  at: string;
  actor: string;
  kind: string;
  // Json, not unknown: server functions require a serializable return type.
  payload: Json;
};

export async function listBotEvents(botId: string, limit = 50): Promise<BotEvent[]> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s
    .from("bot_events")
    .select("id, at, actor, kind, payload")
    .eq("bot_id", botId)
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Не удалось получить журнал: ${error.message}`);
  return (data ?? []) as BotEvent[];
}

export type BotHealthReport = {
  bot_username: string | null;
  webhook_url: string | null;
  pending_updates: number | null;
  last_error: string | null;
  last_error_at: string | null;
};

export type BotHealthOutcome = { ok: true; report: BotHealthReport } | { ok: false; error: string };

/**
 * Спрашивает деплой, что о его боте думает Telegram. Токен для этого нужен —
 * но он остаётся на деплое: панель зовёт /api/internal/health, деплой ходит в
 * Telegram сам. См. CONTROL-PLANE-PLAN.md §5.
 */
export async function checkBotHealth(botId: string): Promise<BotHealthOutcome> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s
    .from("bots")
    .select("app_url, internal_secret")
    .eq("id", botId)
    .single();
  if (error || !data) throw new Error(`Клиент не найден: ${error?.message ?? botId}`);

  const res = await callInternal<{ report: BotHealthReport }>(data, "/api/internal/health", {});
  if (!res.ok) return { ok: false, error: res.error };
  if (!res.body?.report) return { ok: false, error: "Деплой ответил без отчёта" };
  return { ok: true, report: res.body.report };
}

/**
 * Просит деплой направить своего бота на себя же. Панель не передаёт ни токен,
 * ни TELEGRAM_WEBHOOK_SECRET — деплой берёт оба из своих переменных, а адрес
 * вебхука складывает из своего же PUBLIC_APP_URL. Ошибиться доменом нельзя.
 */
export async function requestWebhookSetup(
  botId: string,
  actor: string,
): Promise<{ ok: boolean; detail: string }> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s
    .from("bots")
    .select("app_url, internal_secret")
    .eq("id", botId)
    .single();
  if (error || !data) throw new Error(`Клиент не найден: ${error?.message ?? botId}`);

  const res = await callInternal<{ url?: string }>(data, "/api/internal/set-webhook", {});
  const outcome = res.ok
    ? { ok: true, detail: res.body?.url ?? "вебхук проставлен" }
    : { ok: false, detail: res.error };

  const { error: evErr } = await s.from("bot_events").insert({
    bot_id: botId,
    actor,
    kind: "webhook",
    payload: { ok: outcome.ok, detail: outcome.detail },
  });
  if (evErr) console.error("[operator] не удалось записать bot_events:", evErr.message);
  return outcome;
}

export type BotStats = {
  orders_total: number;
  orders_30d: number;
  last_order_at: string | null;
  products_total: number;
  customers_total: number;
  storage_bytes: number;
};

/**
 * Сводка по всем клиентам одним вызовом (MIGRATION-10). Только агрегаты —
 * счётчики, даты, байты. Содержимого чужих магазинов панель не читает: это
 * решение, а не ограничение service_role, который видит всё.
 */
export async function loadStats(): Promise<Map<string, BotStats>> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s.rpc("operator_bot_stats");
  if (error) throw new Error(`Не удалось получить статистику: ${error.message}`);

  const map = new Map<string, BotStats>();
  for (const row of data ?? []) {
    map.set(row.bot_id, {
      orders_total: Number(row.orders_total),
      orders_30d: Number(row.orders_30d),
      last_order_at: row.last_order_at,
      products_total: Number(row.products_total),
      customers_total: Number(row.customers_total),
      storage_bytes: Number(row.storage_bytes),
    });
  }
  return map;
}
