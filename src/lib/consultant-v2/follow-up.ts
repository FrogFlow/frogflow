/**
 * Напоминание покупателю, который пропал после ответа с товаром.
 *
 * Человек спросил цену, бот ответил — и тишина. Живой менеджер через
 * несколько часов напишет одну строку: «Остались вопросы по …?». Бот делает
 * то же, один раз на одну паузу, и только когда это уместно:
 * - разговор был о товаре (в состоянии есть товары последней выдачи);
 * - с ответа бота прошло от FOLLOW_UP_AFTER_MS до FOLLOW_UP_UNTIL_MS: Instagram
 *   разрешает писать первым только в течение 24 часов после сообщения
 *   покупателя, а бот отвечает сразу, так что время ответа бота — это и время
 *   последнего сообщения покупателя;
 * - не ночью по Алматы (как у v1: с 21:00 до 10:00), не на паузе, не после
 *   передачи менеджеру.
 *
 * Текст — шаблоном, без модели: одна строка с названием модели из выдачи.
 * Отправленное запоминается как «свой голос» (relayed), иначе проверка
 * «в чате менеджер» приняла бы напоминание за живого человека.
 *
 * Выключено, пока в настройках нет consultant_followup = "on". Только v2.
 */
import type { ConsultantProduct } from "@/lib/consultant/catalog";
import type { ConsultantState } from "@/lib/consultant/state";

export const FOLLOW_UP_SETTING_KEY = "consultant_followup";
export const FOLLOW_UP_AFTER_MS = 3 * 60 * 60 * 1000;
export const FOLLOW_UP_UNTIL_MS = 23 * 60 * 60 * 1000;
const MAX_PER_RUN = 20;

/** Модель без размера и цвета: «Uchino Полотенце махровое Zero Twist». */
export function modelName(name: string): string {
  return name
    .replace(/[\s,]*\(.*$/, "")
    .replace(/[\s,]*\d{2,3}\s*[xх×*]\s*\d{2,3}.*$/i, "")
    .replace(/,?\s*цвет.*$/i, "")
    .trim();
}

export function followUpText(state: ConsultantState, catalog: ConsultantProduct[]): string | null {
  const id = state.last_product_ids?.[0];
  const product = id ? catalog.find((p) => p.id === id) : undefined;
  if (!product) return null;
  const model = modelName(product.name);
  if (!model) return null;
  return `Остались вопросы по ${model}? Подскажу по размеру, цвету или доставке.`;
}

export function isFollowUpCandidate(state: ConsultantState, now: Date, offHours: boolean): boolean {
  if (offHours) return false;
  if (state.automation_paused) return false;
  if (state.conversation_state && state.conversation_state !== "consulting") return false;
  if (!state.last_product_ids?.length) return false;
  const at = Date.parse(state.last_bot_reply_at ?? "");
  if (!Number.isFinite(at)) return false;
  const silence = now.getTime() - at;
  if (silence < FOLLOW_UP_AFTER_MS || silence > FOLLOW_UP_UNTIL_MS) return false;
  return state.v2_followup_for !== state.last_bot_reply_at;
}

/** История с напоминанием: к последней реплике бота, чтобы роли чередовались. */
export function recentWithFollowUp(
  state: ConsultantState,
  text: string,
): ConsultantState["recent"] {
  const recent = [...(state.recent ?? [])];
  const last = recent[recent.length - 1];
  if (last?.role === "assistant") {
    recent[recent.length - 1] = { ...last, text: `${last.text}\n\n${text}`.slice(0, 1200) };
  } else {
    recent.push({ role: "assistant", text });
  }
  return recent;
}

/** С крона раз в 15 минут. */
export async function sendFollowUps(
  now = new Date(),
): Promise<{ checked: number; sent: number; skipped?: string }> {
  const { currentVertical } = await import("@/lib/verticals/vertical.server");
  const { isBoviConsultantV2Vertical } = await import("@/lib/verticals/registry");
  if (!isBoviConsultantV2Vertical(currentVertical()))
    return { checked: 0, sent: 0, skipped: "not_v2" };
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data: setting } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", FOLLOW_UP_SETTING_KEY)
    .maybeSingle();
  if (String(setting?.value ?? "").trim() !== "on") return { checked: 0, sent: 0, skipped: "off" };
  const { isOffHoursInAlmaty } = await import("@/lib/consultant/rate");
  if (isOffHoursInAlmaty(now)) return { checked: 0, sent: 0, skipped: "off_hours" };

  const since = new Date(now.getTime() - FOLLOW_UP_UNTIL_MS - 60 * 60 * 1000).toISOString();
  const { data: users } = await supabaseAdmin
    .from("bot_users")
    .select("user_key, platform, zernio_conversation_id, state")
    .gte("updated_at", since)
    .not("zernio_conversation_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(300);
  const { readConsultantState, patchConsultantState, appendRelayed } =
    await import("@/lib/consultant/state");
  const candidates = (users ?? [])
    .map((u) => ({ ...u, consultant: readConsultantState(u.state) }))
    .filter((u) => isFollowUpCandidate(u.consultant, now, false))
    .slice(0, MAX_PER_RUN);
  if (candidates.length === 0) return { checked: users?.length ?? 0, sent: 0 };

  const { loadConsultantCatalog } = await import("@/lib/consultant/catalog");
  const catalog = await loadConsultantCatalog();
  const { sendDirectReply } = await import("@/lib/direct-purchase.server");
  const { logConsultantEvent, consultantRequestId } = await import("@/lib/consultant/log");
  let sent = 0;
  for (const u of candidates) {
    const text = followUpText(u.consultant, catalog);
    // Отметка и тогда, когда писать нечего: второй раз этот диалог не смотрим.
    if (!text) {
      await patchConsultantState(u.user_key, { v2_followup_for: u.consultant.last_bot_reply_at });
      continue;
    }
    const { data: run } = await supabaseAdmin
      .from("consultant_message_runs")
      .select("account_id")
      .eq("user_key", u.user_key)
      .not("account_id", "is", null)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!run?.account_id) continue;
    // Сначала отметка и «свой голос», потом отправка: второй крон не повторит,
    // а проверка «в чате менеджер» узнает своё сообщение.
    await patchConsultantState(u.user_key, {
      v2_followup_for: u.consultant.last_bot_reply_at,
      relayed: appendRelayed(u.consultant, text),
    });
    const ok = await sendDirectReply({
      conversationId: u.zernio_conversation_id!,
      accountId: run.account_id,
      userKey: u.user_key,
      text,
      platform: (u.platform || "instagram") as import("@/lib/zernio-platform").ZernioPlatform,
      force: true,
    }).catch(() => false);
    if (!ok) continue;
    await patchConsultantState(u.user_key, { recent: recentWithFollowUp(u.consultant, text) });
    logConsultantEvent(consultantRequestId(), "follow_up_sent", { userKey: u.user_key });
    sent++;
  }
  return { checked: users?.length ?? 0, sent };
}
