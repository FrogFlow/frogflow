import type { Json } from "@/integrations-supabase/types";

/**
 * Запись в журнал действий оператора.
 *
 * До этого файла вставок было девять, и восемь из них не проверяли ошибку.
 * Так и потерялась запись о выдаче ключа арендатора: вид события не проходил
 * CHECK, вставка падала, и об этом никто не узнавал — журнал просто оказался
 * неполным, причём именно там, где полнота важнее всего.
 *
 * Здесь два правила на все случаи сразу:
 *   • вид события — из типа BotEventKind, а не строкой на месте: словарь и
 *     CHECK в базе больше не расходятся незаметно;
 *   • неудачная запись всегда попадает в лог сервера. Действие она не
 *     отменяет — оператор уже перевёл бота на паузу, и падать из-за журнала
 *     было бы хуже, — но и молчать о пропаже следа нельзя.
 */

/** Совпадает с CHECK на bot_events.kind (MIGRATION-12, MIGRATION-14). */
export type BotEventKind =
  | "module_on"
  | "module_off"
  | "pause"
  | "resume"
  | "suspend"
  | "onboard"
  | "webhook"
  | "env_block"
  | "meta"
  | "payment"
  | "policy"
  | "message";

export async function logEvent(
  botId: string,
  actor: string,
  kind: BotEventKind,
  payload: Json = {},
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { error } = await supabaseAdmin
    .from("bot_events")
    .insert({ bot_id: botId, actor, kind, payload });
  if (error) {
    console.error(`[operator] не удалось записать в журнал (${kind}, ${botId}):`, error.message);
  }
}
