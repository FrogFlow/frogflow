import { requireOperator } from "./guard.server";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { callInternal } from "./internal-client.server";
import { logEvent } from "./events.server";
import type { Json } from "@/integrations-supabase/types";
import { computeState, readPolicy, type SubscriptionState } from "./subscriptions.server";
import { errorMessage } from "@/lib/error-message";
import { toCsv, isoDate, fetchAll } from "@/lib/csv";

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
  /** Метки оператора для фильтрации в панели (MIGRATION-47) — не видны клиенту. */
  tags: string[];
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
  /** Включённые модули — список видит, кто что купил, не открывая карточку. */
  modules: ModuleKey[];
  /** Нужен сводке: без него панель не может написать владельцу. */
  has_owner_telegram_id: boolean;
};

/** По умолчанию — только действующие клиенты: ушедший не должен мозолить глаза в ежедневном списке. */
export async function listBots(includeArchived = false): Promise<BotListItem[]> {
  await requireOperator();
  const s = await db();
  let query = s
    .from("bots")
    .select(
      "id, bot_name, status, owner_name, app_url, notes, subscription_plan, subscription_expires_at, settings, archived_at, modules, owner_telegram_id, tags",
    )
    .order("bot_name", { ascending: true });
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw new Error(`Не удалось получить список клиентов: ${error.message}`);

  // Одним запросом: у кого вообще есть платежи. Без этого дата, доставшаяся от
  // заведения строки, выглядела бы как подтверждённая оплата.
  const { data: paid, error: paidErr } = await s.from("subscription_payments").select("bot_id");
  if (paidErr) {
    console.error("[operator] не удалось получить платежи для списка клиентов:", paidErr.message);
  }
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
      tags: b.tags ?? [],
      subscription_state: sub.state,
      subscription_days_left: sub.daysLeft,
      archived_at: b.archived_at,
      modules: MODULE_KEYS.filter(
        (k) => (b.modules as Record<string, boolean> | null)?.[k] === true,
      ),
      has_owner_telegram_id: b.owner_telegram_id != null,
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
      "id, bot_name, owner_id, status, owner_name, owner_contact, owner_telegram_id, app_url, notes, paused_message, subscription_plan, subscription_expires_at, modules, internal_secret, archived_at, tags",
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
    tags: data.tags ?? [],
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
  const { data, error } = await s
    .from("bots")
    .select("app_url, internal_secret")
    .eq("id", botId)
    .single();
  if (error || !data) {
    console.warn(`[operator] сброс кеша ${botId}: не удалось прочитать клиента`, error?.message);
    return;
  }

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
  tags: string[];
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

export type HealthOutage = {
  /** null — падение продолжается, последнего «отвечает» снимка ещё не было. */
  endedAt: string | null;
  startedAt: string;
  error: string | null;
};

export type HealthHistorySummary = {
  /** Доля снимков с ok=true за окно — null, если снимков ещё не накопилось. */
  uptimeRatio: number | null;
  snapshotCount: number;
  /** Новее сверху — так первым в списке идёт то, что случилось недавно. */
  outages: HealthOutage[];
};

/**
 * История падений клиента — снимки пишет крон раз в 15 минут (MIGRATION-48),
 * здесь они схлопываются в интервалы простоя вместо сырого списка точек: то
 * же самое «не отвечает» может занять час и лечь двумя-тремя снимками подряд,
 * а оператору интереснее «когда и сколько», а не каждая точка отдельно.
 */
export async function getHealthHistory(botId: string, days = 14): Promise<HealthHistorySummary> {
  await requireOperator();
  const s = await db();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await s
    .from("bot_health_snapshots")
    .select("at, ok, error")
    .eq("bot_id", botId)
    .gte("at", cutoff)
    .order("at", { ascending: true });
  if (error) throw new Error(`Не удалось получить историю: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return { uptimeRatio: null, snapshotCount: 0, outages: [] };

  const okCount = rows.filter((r) => r.ok).length;
  const outages: HealthOutage[] = [];
  let openOutage: { startedAt: string; error: string | null } | null = null;
  for (const r of rows) {
    if (!r.ok && !openOutage) {
      openOutage = { startedAt: r.at, error: r.error };
    } else if (r.ok && openOutage) {
      outages.push({ startedAt: openOutage.startedAt, endedAt: r.at, error: openOutage.error });
      openOutage = null;
    }
  }
  if (openOutage) {
    outages.push({ startedAt: openOutage.startedAt, endedAt: null, error: openOutage.error });
  }

  return {
    uptimeRatio: okCount / rows.length,
    snapshotCount: rows.length,
    outages: outages.reverse(),
  };
}

function formatOutageDuration(startIso: string, endIso: string | null): string {
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const minutes = Math.max(1, Math.round((end - new Date(startIso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
  const days = Math.floor(hours / 24);
  return `${days} дн ${hours % 24} ч`;
}

/**
 * Интервалы простоя одного клиента в CSV — та же вкладка «Деплой», для
 * разбора инцидентов вне панели. Экспортирует уже схлопнутые интервалы
 * (как на экране), а не сырые снимки каждые 15 минут — то же соображение,
 * что и у getHealthHistory().
 */
export async function exportHealthHistoryCsv(
  botId: string,
  days = 14,
): Promise<{ csv: string; count: number }> {
  await requireOperator();
  const s = await db();
  const { data: bot, error: botErr } = await s
    .from("bots")
    .select("bot_name")
    .eq("id", botId)
    .single();
  if (botErr || !bot) throw new Error(`Клиент не найден: ${botErr?.message ?? botId}`);

  const history = await getHealthHistory(botId, days);
  const csv = toCsv(
    ["Клиент", "Начало", "Конец", "Длительность", "Ошибка"],
    history.outages.map((o) => [
      bot.bot_name,
      isoDate(o.startedAt),
      o.endedAt ? isoDate(o.endedAt) : "продолжается",
      formatOutageDuration(o.startedAt, o.endedAt),
      o.error ?? "",
    ]),
  );
  return { csv, count: history.outages.length };
}

/**
 * Готовность клиента к работе — одной кнопкой вместо обхода вручную.
 *
 * Панель спрашивает деплой, что у него настроено, и добавляет то, что знает
 * только она: сходится ли адрес деплоя с записанным в карточке и что думает
 * Telegram о вебхуке. Именно эти три источника расходились каждый раз, когда
 * подключение затягивалось.
 */
export type ReadinessCheck = { name: string; level: "ok" | "warn" | "fail"; detail: string };
export type Readiness = {
  ok: boolean;
  /** Сколько пунктов не в порядке — чтобы не считать глазами. */
  problems: number;
  checks: ReadinessCheck[];
};

export async function checkReadiness(botId: string): Promise<Readiness> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s
    .from("bots")
    .select("app_url, internal_secret, bot_name")
    .eq("id", botId)
    .single();
  if (error || !data) throw new Error(`Клиент не найден: ${error?.message ?? botId}`);

  const checks: ReadinessCheck[] = [];

  if (!data.app_url) {
    checks.push({
      name: "Адрес деплоя",
      level: "fail",
      detail: "не заполнен в карточке — панели некуда обращаться",
    });
    return { ok: false, problems: 1, checks };
  }

  // 1. Деплой вообще отвечает и знает свои переменные.
  const diag = await callInternal<{
    diagnostics: { bot_id: string | null; app_origin: string | null; checks: ReadinessCheck[] };
  }>(data, "/api/internal/diagnostics", {});

  if (!diag.ok) {
    checks.push({
      name: "Деплой",
      level: "fail",
      detail:
        diag.kind === "unreachable"
          ? `не отвечает: ${diag.error}`
          : `отвечает, но отказывает: ${diag.error}`,
    });

    // Деплой не смог прочитать собственный internal_secret. Диагностировать
    // себя он в таком состоянии не может — строку в bots ему не отдаёт RLS, —
    // зато диагноз очевиден снаружи: ключ арендатора выписан не на того
    // клиента, либо BOT_ID не тот. Это самая частая ошибка при переносе
    // переменных, и оператору она стоила бы часа в логах.
    if (/Internal secret unavailable/i.test(diag.error)) {
      checks.push({
        name: "SUPABASE_TENANT_KEY / BOT_ID",
        level: "fail",
        detail:
          "деплой не видит своей строки в базе. Почти всегда это значит, что ключ арендатора " +
          "выписан на другого клиента или BOT_ID не совпадает с ним. Соберите блок переменных " +
          "заново и вставьте BOT_ID вместе с ключом.",
      });
    }
    if (/HTTP 404/.test(diag.error)) {
      checks.push({
        name: "Версия деплоя",
        level: "warn",
        detail: "у деплоя нет проверки готовности — он собран из более старой версии репозитория",
      });
    }
    return { ok: false, problems: checks.length, checks };
  }
  checks.push({ name: "Деплой", level: "ok", detail: data.app_url });

  const d = diag.body?.diagnostics;
  if (d) {
    checks.push(...d.checks);

    // Это знает только панель: деплой не в курсе, что записано в его карточке.
    const mine = data.app_url.trim().replace(/\/$/, "");
    const theirs = (d.app_origin ?? "").trim().replace(/\/$/, "");
    if (theirs && theirs !== mine) {
      checks.push({
        name: "Адрес деплоя",
        level: "fail",
        detail: `в карточке ${mine}, а деплой считает себя ${theirs} — вебхук и ссылки разойдутся`,
      });
    }
    if (d.bot_id && d.bot_id !== botId) {
      checks.push({
        name: "BOT_ID",
        level: "fail",
        detail: `деплой настроен на другого клиента (${d.bot_id})`,
      });
    }
  }

  // 2. Что об этом боте думает Telegram.
  const health = await callInternal<{ report: BotHealthReport }>(data, "/api/internal/health", {});
  if (!health.ok) {
    checks.push({ name: "Вебхук", level: "fail", detail: health.error });
  } else {
    const r = health.body?.report;
    if (!r?.webhook_url) {
      checks.push({
        name: "Вебхук",
        level: "fail",
        detail: "не установлен — бот не получает сообщений. Нажмите «Проставить вебхук»",
      });
    } else if (!r.webhook_url.startsWith(data.app_url.replace(/\/$/, ""))) {
      checks.push({
        name: "Вебхук",
        level: "fail",
        detail: `указывает на ${r.webhook_url} — это не этот деплой`,
      });
    } else {
      const queued = r.pending_updates ?? 0;
      checks.push({
        name: "Вебхук",
        level: queued > 0 || r.last_error ? "warn" : "ok",
        detail: r.last_error
          ? `${r.last_error}`
          : queued > 0
            ? `установлен, но в очереди ${queued} — апдейты не разбираются`
            : `${r.bot_username ? "@" + r.bot_username + ", " : ""}очередь пуста`,
      });
    }
  }

  const problems = checks.filter((c) => c.level !== "ok").length;
  return { ok: checks.every((c) => c.level !== "fail"), problems, checks };
}

/**
 * Кандидаты в владельцы клиента.
 *
 * owner_telegram_id вводился числом, которое оператору неоткуда взять — и
 * поэтому заполнен у одного клиента из пяти. А без него не работают ни
 * рассылка владельцам, ни предупреждения о подписке: панели просто некуда
 * слать.
 *
 * При этом ответ уже лежит в базе. Клиент сам настраивает admin_chat_id —
 * туда его бот шлёт уведомления о заказах, — и у Анастасии, единственной с
 * заполненным полем, эти два значения совпадают. Поэтому admin_chat_id идёт
 * первым предложением, а список писавших боту — на случай, когда нужен не он.
 */
export type OwnerCandidate = {
  telegram_id: number;
  name: string;
  username: string | null;
  /** admin — из настроек бота, user — просто писал боту. */
  source: "admin" | "user";
};

export async function listOwnerCandidates(botId: string): Promise<OwnerCandidate[]> {
  await requireOperator();
  const s = await db();

  const { data: setting, error: settingErr } = await s
    .from("app_settings")
    .select("value")
    .eq("bot_id", botId)
    .eq("key", "admin_chat_id")
    .maybeSingle();
  if (settingErr) {
    console.error(`[operator] не удалось получить admin_chat_id для ${botId}:`, settingErr.message);
  }

  // Поле хранит список получателей, а не одно число: в админке клиента их
  // может быть несколько.
  const adminIds = String(setting?.value ?? "")
    .split(/[^0-9]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);

  const { data: users, error: usersErr } = await s
    .from("bot_users")
    .select("telegram_id, first_name, last_name, username, created_at")
    .eq("bot_id", botId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (usersErr) {
    console.error(`[operator] не удалось получить пользователей бота ${botId}:`, usersErr.message);
  }

  const byId = new Map<
    number,
    { first_name: string | null; last_name: string | null; username: string | null }
  >();
  for (const u of users ?? []) {
    const id = Number(u.telegram_id);
    if (Number.isFinite(id)) byId.set(id, u);
  }
  const label = (id: number) => {
    const u = byId.get(id);
    const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim();
    return name || `ID ${id}`;
  };

  const out: OwnerCandidate[] = adminIds.map((id) => ({
    telegram_id: id,
    name: label(id),
    username: byId.get(id)?.username ?? null,
    source: "admin" as const,
  }));

  // Первые писавшие боту: обычно среди них сам владелец, который его и тестировал.
  for (const u of users ?? []) {
    const id = Number(u.telegram_id);
    if (!Number.isFinite(id) || out.some((c) => c.telegram_id === id)) continue;
    out.push({ telegram_id: id, name: label(id), username: u.username, source: "user" });
    if (out.length >= 15) break;
  }
  return out;
}

/**
 * Журнал по всем клиентам сразу. Внутри карточки он отвечает на «что делали с
 * этим клиентом», но не на «что вообще происходило на неделе» — а именно это
 * и нужно, чтобы заметить чужую активность или вспомнить свою.
 */
export type FeedEvent = BotEvent & { bot_name: string };

export type FeedFilter = {
  limit?: number;
  /** Строго раньше этой отметки времени — для подгрузки следующей страницы. */
  before?: string;
  /** Не раньше этой отметки — для диапазона «сегодня/7 дней/30 дней» в Журнале. */
  since?: string;
  botId?: string;
  kind?: string;
};

export async function listFeed(filter: FeedFilter = {}): Promise<FeedEvent[]> {
  await requireOperator();
  const s = await db();
  let query = s
    .from("bot_events")
    .select("id, bot_id, at, actor, kind, payload")
    .order("at", { ascending: false })
    .limit(filter.limit ?? 50);
  if (filter.before) query = query.lt("at", filter.before);
  if (filter.since) query = query.gte("at", filter.since);
  if (filter.botId) query = query.eq("bot_id", filter.botId);
  if (filter.kind) query = query.eq("kind", filter.kind);

  const { data, error } = await query;
  if (error) throw new Error(`Не удалось получить журнал: ${error.message}`);

  const { data: bots, error: botsErr } = await s.from("bots").select("id, bot_name");
  if (botsErr) {
    console.error("[operator] не удалось получить имена клиентов для журнала:", botsErr.message);
  }
  const names = new Map((bots ?? []).map((b) => [b.id, b.bot_name]));

  return (data ?? []).map((e) => ({
    id: e.id,
    at: e.at,
    actor: e.actor,
    kind: e.kind,
    payload: e.payload as Json,
    bot_name: names.get(e.bot_id) ?? "—",
  }));
}

/** Совпадает с подписями на странице «Журнал» — тот же справочник, отдельная копия ради независимости от клиентского файла. */
const FEED_KIND_LABEL: Record<string, string> = {
  module_on: "модуль включён",
  module_off: "модуль выключен",
  pause: "пауза",
  resume: "снят с паузы",
  suspend: "приостановлен",
  onboard: "подключение",
  webhook: "вебхук",
  env_block: "выдан блок переменных",
  meta: "правка карточки",
  payment: "платёж",
  policy: "политика неоплаты",
  message: "сообщение владельцу",
};

function summarizeFeedPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return Object.entries(payload as Record<string, unknown>)
    .filter(([k]) => k !== "sweep_marker")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" · ");
}

/**
 * Журнал в CSV — тот же приём (BOM/«;»/toCsv), что и у экспорта клиентов,
 * для разбора инцидентов задним числом вне панели. Без ограничения на
 * количество строк — fetchAll() читает всё, что подпадает под фильтр,
 * страницами по PAGE.
 */
export async function exportFeedCsv(
  filter: Pick<FeedFilter, "botId" | "kind" | "since"> = {},
): Promise<{ csv: string; count: number }> {
  await requireOperator();
  const s = await db();

  const { data: bots, error: botsErr } = await s.from("bots").select("id, bot_name");
  if (botsErr) throw new Error(`Не удалось получить клиентов: ${botsErr.message}`);
  const names = new Map((bots ?? []).map((b) => [b.id, b.bot_name]));

  const rows = await fetchAll((from, to) => {
    let query = s
      .from("bot_events")
      .select("bot_id, at, actor, kind, payload")
      .order("at", { ascending: false })
      .range(from, to);
    if (filter.since) query = query.gte("at", filter.since);
    if (filter.botId) query = query.eq("bot_id", filter.botId);
    if (filter.kind) query = query.eq("kind", filter.kind);
    return query;
  }, "журнал");

  const csv = toCsv(
    ["Дата", "Клиент", "Вид", "Оператор", "Детали"],
    rows.map((e) => [
      isoDate(e.at),
      names.get(e.bot_id) ?? "—",
      FEED_KIND_LABEL[e.kind] ?? e.kind,
      e.actor,
      summarizeFeedPayload(e.payload),
    ]),
  );
  return { csv, count: rows.length };
}

/** Проверка готовности сразу по всем — после общего обновления кода удобнее, чем по одному. */
export async function checkReadinessAll(): Promise<Record<string, Readiness>> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s.from("bots").select("id").is("archived_at", null);
  // Раньше сбой этого чтения давал `data === undefined` → `(data ?? [])` пустой
  // массив → функция тихо возвращала {} — панель показала бы «клиентов нет»
  // или пустую таблицу готовности вместо ошибки, и оператор принял бы отказ
  // запроса за «у всех всё хорошо».
  if (error) throw new Error(`Не удалось получить список клиентов: ${error.message}`);
  const rows = await Promise.all(
    (data ?? []).map(async (b) => {
      try {
        return [b.id, await checkReadiness(b.id)] as const;
      } catch (e: unknown) {
        return [
          b.id,
          {
            ok: false,
            problems: 1,
            checks: [
              {
                name: "Проверка",
                level: "fail" as const,
                detail: errorMessage(e) || "не удалась",
              },
            ],
          },
        ] as const;
      }
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

/**
 * Клиенты + выручка одним CSV — для отчётности себе, вне панели. Тот же
 * приём (toCsv/BOM/«;»), что уже используют экспорты в клиентской админке
 * (export.functions.ts) — тот же файл открывается двойным щелчком в Excel.
 */
export async function exportClientsCsv(): Promise<{ csv: string; count: number }> {
  await requireOperator();
  const s = await db();
  const bots = await listBots(true);
  const statsMap = await loadStats();

  const { data: payments, error } = await s
    .from("subscription_payments")
    .select("bot_id, amount, currency");
  if (error) throw new Error(`Не удалось получить платежи: ${error.message}`);
  const revenueByBot = new Map<string, { total: number; currency: string; mixed: boolean }>();
  for (const p of payments ?? []) {
    const cur = revenueByBot.get(p.bot_id);
    if (!cur) {
      revenueByBot.set(p.bot_id, { total: Number(p.amount), currency: p.currency, mixed: false });
    } else {
      cur.total += Number(p.amount);
      if (cur.currency !== p.currency) cur.mixed = true;
    }
  }

  const SUB_LABEL_RU: Record<SubscriptionState, string> = {
    no_data: "нет данных",
    ok: "оплачена",
    expiring: "скоро истекает",
    overdue: "просрочена",
    grace_over: "отсрочка кончилась",
  };

  const csv = toCsv(
    [
      "Клиент",
      "Владелец",
      "Статус",
      "Подписка",
      "Подписка до",
      "Модулей включено",
      "Заказов всего",
      "Заказов за 30 дн",
      "Оплачено всего",
      "Валюта",
      "В архиве",
      "Теги",
    ],
    bots.map((b) => {
      const rev = revenueByBot.get(b.id);
      const stats = statsMap.get(b.id);
      return [
        b.bot_name,
        b.owner_name,
        b.status,
        SUB_LABEL_RU[b.subscription_state],
        isoDate(b.subscription_expires_at),
        b.modules.length,
        stats?.orders_total ?? 0,
        stats?.orders_30d ?? 0,
        rev?.total ?? 0,
        rev ? (rev.mixed ? `${rev.currency} + др.` : rev.currency) : "",
        b.archived_at ? "да" : "нет",
        b.tags.join(", "),
      ];
    }),
  );
  return { csv, count: bots.length };
}

export type StorageByKind = { kind: string; bytes: number };

/**
 * Разбивка занятого места по видам файлов на клиента (MIGRATION-39) — для
 * донат-чартов на главной странице панели и на карточке клиента. Считает
 * теми же ссылками, что и operator_bot_stats(), так что сумма по видам для
 * одного bot_id совпадает с его storage_bytes оттуда.
 */
export async function loadStorageByKind(): Promise<Map<string, StorageByKind[]>> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s.rpc("operator_storage_by_kind");
  if (error) throw new Error(`Не удалось получить разбивку хранилища: ${error.message}`);

  const map = new Map<string, StorageByKind[]>();
  for (const row of data ?? []) {
    const rows = map.get(row.bot_id) ?? [];
    rows.push({ kind: row.storage_kind, bytes: Number(row.storage_bytes) });
    map.set(row.bot_id, rows);
  }
  return map;
}
