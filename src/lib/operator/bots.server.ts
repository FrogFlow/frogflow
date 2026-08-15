import { requireOperator } from "./guard.server";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { callInternal } from "./internal-client.server";
import { logEvent } from "./events.server";
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
  archived_at: string | null;
};

/** По умолчанию — только действующие клиенты: ушедший не должен мозолить глаза в ежедневном списке. */
export async function listBots(includeArchived = false): Promise<BotListItem[]> {
  await requireOperator();
  const s = await db();
  let query = s
    .from("bots")
    .select(
      "id, bot_name, status, owner_name, app_url, notes, subscription_plan, subscription_expires_at, settings, archived_at",
    )
    .order("bot_name", { ascending: true });
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
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
      archived_at: b.archived_at,
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
  /** Человекочитаемый идентификатор клиента (owner_id) — попадает в имена и ссылки. */
  owner_slug: string | null;
  archived_at: string | null;
};

export async function getBot(botId: string): Promise<BotDetail> {
  await requireOperator();
  const s = await db();
  // Явный список вместо select("*"): строка bots содержит и bot_token, и
  // internal_secret, и тянуть их сюда незачем.
  const { data, error } = await s
    .from("bots")
    // Одной строкой, а не конкатенацией: PostgREST выводит типы строки только
    // из строкового литерала — склейка превращает результат в GenericStringError.
    .select(
      "id, bot_name, owner_id, status, owner_name, owner_contact, owner_telegram_id, app_url, notes, paused_message, subscription_plan, subscription_expires_at, modules, internal_secret, archived_at",
    )
    .eq("id", botId)
    .single();
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
    owner_slug: data.owner_id,
    archived_at: data.archived_at,
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

  await logEvent(botId, actor, enabled ? "module_on" : "module_off", { key });

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

  await logEvent(
    botId,
    actor,
    status === "active" ? "resume" : status === "suspended" ? "suspend" : "pause",
    { status },
  );

  // Тем же кешем читается и статус — пауза должна вступать в силу сразу.
  await nudgeDeployment(botId);
}

export type BotMetaPatch = Partial<{
  bot_name: string;
  owner_id: string;
  owner_name: string | null;
  owner_contact: string | null;
  owner_telegram_id: number | null;
  app_url: string | null;
  notes: string | null;
  paused_message: string | null;
}>;

export async function updateBotMeta(botId: string, patch: BotMetaPatch, actor: string) {
  await requireOperator();
  const s = await db();
  const { error } = await s.from("bots").update(patch).eq("id", botId);
  if (error) throw new Error(`Не удалось сохранить данные клиента: ${error.message}`);

  // Правка карточки не оставляла следа вообще — а меняется тут в том числе
  // app_url, от которого зависит, куда панель стучится и чей вебхук считается
  // своим. В журнал идут имена изменённых полей, без значений.
  await logEvent(botId, actor, "meta", { fields: Object.keys(patch) });
}

/**
 * Архивирование клиента. Строка и все её данные остаются на месте: заказы,
 * выгрузки и история платежей должны переживать уход клиента — их ещё
 * спрашивают потом. Бот при этом останавливается, иначе архивный магазин
 * продолжал бы принимать заказы.
 */
export async function setArchived(botId: string, archived: boolean, actor: string) {
  await requireOperator();
  const s = await db();
  const patch = archived
    ? { archived_at: new Date().toISOString(), status: "suspended" as const }
    : { archived_at: null };
  const { error } = await s.from("bots").update(patch).eq("id", botId);
  if (error) throw new Error(`Не удалось изменить архив: ${error.message}`);

  await logEvent(botId, actor, archived ? "suspend" : "resume", { archived });
  await nudgeDeployment(botId);
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

  // Деплой отчитывается по каждому своему боту: у клиентов с VIP-подписками
  // их два, и «проставлен» без уточнения скрывало бы, что второй не встал.
  const res = await callInternal<{
    url?: string;
    bots?: { name: string; ok: boolean; url: string; detail: string }[];
  }>(data, "/api/internal/set-webhook", {});

  const outcome = res.ok
    ? {
        ok: true,
        detail:
          res.body?.bots
            ?.map((b) => `${b.name}: ${b.ok ? b.url || b.detail : b.detail}`)
            .join(" · ") ??
          res.body?.url ??
          "вебхук проставлен",
      }
    : { ok: false, detail: res.error };

  await logEvent(botId, actor, "webhook", { ok: outcome.ok, detail: outcome.detail });
  return outcome;
}

/**
 * Здоровье всех ботов разом — для списка клиентов.
 *
 * Раньше это можно было узнать только по одному, кнопкой в карточке: лежащий
 * бот с растущей очередью апдейтов оставался невидим, пока кто-нибудь не
 * догадается туда зайти. Анастасию с двумя зависшими апдейтами мы нашли
 * руками, а не панелью.
 *
 * Запросы идут параллельно: каждый ждёт до INTERNAL_TIMEOUT_MS, и на пяти
 * клиентах последовательный обход упёрся бы в лимит serverless-функции.
 */
export type BotHealthRow =
  | { ok: true; report: BotHealthReport }
  | { ok: false; kind: "skipped" | "failed" | "unreachable"; error: string };

export async function loadHealthAll(): Promise<Record<string, BotHealthRow>> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s.from("bots").select("id, app_url, internal_secret");
  if (error) throw new Error(`Не удалось получить клиентов: ${error.message}`);

  const rows = await Promise.all(
    (data ?? []).map(async (bot) => {
      const res = await callInternal<{ report: BotHealthReport }>(bot, "/api/internal/health", {});
      if (res.ok && res.body?.report) {
        return [bot.id, { ok: true as const, report: res.body.report }] as const;
      }
      return [
        bot.id,
        res.ok
          ? { ok: false as const, kind: "failed" as const, error: "деплой ответил без отчёта" }
          : { ok: false as const, kind: res.kind, error: res.error },
      ] as const;
    }),
  );
  return Object.fromEntries(rows);
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
