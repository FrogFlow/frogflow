import { requireOperator } from "./guard.server";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { callInternal } from "./internal-client.server";
import type { Json } from "@/integrations-supabase/types";

type BotStatus = "active" | "paused" | "suspended";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export type BotListItem = {
  id: string;
  bot_name: string;
  status: BotStatus;
  owner_name: string | null;
  app_url: string | null;
  notes: string | null;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
};

export async function listBots(): Promise<BotListItem[]> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s
    .from("bots")
    .select(
      "id, bot_name, status, owner_name, app_url, notes, subscription_plan, subscription_expires_at",
    )
    .order("bot_name", { ascending: true });
  if (error) throw new Error(`Не удалось получить список клиентов: ${error.message}`);
  return (data ?? []) as BotListItem[];
}

export type BotDetail = BotListItem & {
  modules: Record<ModuleKey, boolean>;
  owner_telegram_id: number | null;
  owner_contact: string | null;
  paused_message: string | null;
  internal_secret: string | null;
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
    internal_secret: data.internal_secret,
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

  await s.from("bot_events").insert({
    bot_id: botId,
    actor,
    // bot_events.kind допускает только pause/resume — suspended логируется тем же "pause".
    kind: status === "active" ? "resume" : "pause",
    payload: { status },
  });

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
