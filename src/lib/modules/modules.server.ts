import { MODULE_KEYS, type ModuleKey } from "./registry";

type BotStatus = "active" | "paused" | "suspended";

type BotRow = {
  status: BotStatus;
  modules: Record<string, boolean> | null;
  paused_message: string | null;
};

const DEFAULT_PAUSED_MESSAGE =
  "Бот временно недоступен. Загляните чуть позже — мы уже разбираемся.";

/** Каждый деплой обслуживает одного арендатора — тот же BOT_ID, что и в client.server.ts / reset.functions.ts. */
function requireBotId(): string {
  const id = process.env.BOT_ID?.trim();
  if (!id) {
    throw new Error(
      "BOT_ID не задан в переменных окружения — без него нельзя понять, чьи модули и статус читать.",
    );
  }
  return id;
}

// Кеш в памяти процесса. «Включил тумблер в панели — заработало в течение
// минуты» — приемлемо; мгновенно делает сброс кеша панелью через
// POST /api/internal/reload (resetModuleCache ниже).
let cache: { at: number; row: BotRow } | null = null;
const TTL_MS = 60_000;

/**
 * Сбрасывает кеш, чтобы следующее чтение сходило в базу. Serverless держит
 * несколько инстансов, и вызов доходит только до одного из них — поэтому это
 * ускорение, а не гарантия: остальные подтянут новое значение по истечении
 * TTL. Полагаться на мгновенность нельзя, для корректности достаточно TTL.
 */
export function resetModuleCache() {
  cache = null;
}

async function loadBot(fresh = false): Promise<BotRow> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.row;

  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("bots")
    .select("status, modules, paused_message")
    .eq("id", requireBotId())
    .single();

  if (error || !data) {
    throw new Error(
      `Не удалось загрузить строку bots для этого BOT_ID: ${error?.message ?? "нет данных"}`,
    );
  }

  const row = data as unknown as BotRow;
  cache = { at: Date.now(), row };
  return row;
}

/** Канонический набор ключей, все выключены — для деплоя без своего арендатора (панель оператора). */
export function emptyModules(): Record<ModuleKey, boolean> {
  const result = {} as Record<ModuleKey, boolean>;
  for (const key of MODULE_KEYS) result[key] = false;
  return result;
}

/** Полный канонический набор — ключи реестра, которых нет в строке (например, ещё не забэкфилены), читаются как выключенные. */
export async function loadModules(): Promise<Record<ModuleKey, boolean>> {
  const { modules } = await loadBot();
  const result = emptyModules();
  for (const key of MODULE_KEYS) {
    result[key] = modules?.[key] === true;
  }
  return result;
}

export async function loadModulesFresh(): Promise<Record<ModuleKey, boolean>> {
  const { modules } = await loadBot(true);
  const result = emptyModules();
  for (const key of MODULE_KEYS) {
    result[key] = modules?.[key] === true;
  }
  return result;
}

export async function hasModule(key: ModuleKey): Promise<boolean> {
  const modules = await loadModules();
  return modules[key] === true;
}

export async function botStatus(): Promise<BotStatus> {
  const { status } = await loadBot();
  return status;
}

export async function pausedMessage(): Promise<string> {
  const { paused_message } = await loadBot();
  return paused_message?.trim() || DEFAULT_PAUSED_MESSAGE;
}
