import { callInternal } from "./internal-client.server";
import { computeState, readPolicy } from "./subscriptions.server";
import { logEvent } from "./events.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export type SweepAction =
  | "warned" // владельцу ушло предупреждение
  | "suspended" // бот переведён в suspended по политике
  | "skipped" // всё в порядке либо уже обработано
  | "failed"; // не смогли доставить/применить

export type SweepEntry = {
  bot_id: string;
  bot_name: string;
  state: string;
  action: SweepAction;
  detail: string;
};

/**
 * Ежедневный обход подписок: предупредить заранее, применить политику после
 * отсрочки. Запускается кроном на проекте панели (см. api/operator-cron).
 *
 * Идемпотентность — через bot_events: на каждый период и вид действия пишется
 * одно событие, и повторный запуск в тот же день его находит и молчит. Иначе
 * клиент получал бы предупреждение каждые сутки, что быстро приучает его
 * такие сообщения игнорировать.
 */
export async function sweepSubscriptions(now = new Date()): Promise<SweepEntry[]> {
  const s = await db();
  const { data: bots, error } = await s
    .from("bots")
    .select(
      "id, bot_name, status, settings, subscription_expires_at, app_url, internal_secret, owner_telegram_id",
    );
  if (error) throw new Error(`Не удалось получить клиентов: ${error.message}`);

  const results: SweepEntry[] = [];

  for (const bot of bots ?? []) {
    const policy = readPolicy(bot.settings);
    const sub = computeState(bot.subscription_expires_at, policy, true, now);
    const base = { bot_id: bot.id, bot_name: bot.bot_name, state: sub.state };

    // Нечего делать: даты нет, всё оплачено, или бот уже приостановлен.
    if (sub.state === "no_data" || sub.state === "ok" || bot.status === "suspended") {
      results.push({ ...base, action: "skipped", detail: "нет повода" });
      continue;
    }

    const shouldSuspend = sub.state === "grace_over" && policy.on_overdue === "suspend";
    const kind = shouldSuspend ? "suspend" : "warn";
    /**
     * Ключ периода И дня — не только периода.
     *
     * Раньше маркер не включал дату прохода, хотя комментарий к функции прямо
     * обещает «повторный запуск в тот же день молчит»: и «expiring», и
     * «overdue» дают одинаковый kind = "warn", то есть один и тот же маркер
     * на весь срок. Из-за этого предупреждение уходило один раз в первый же
     * день "expiring" — а дальше все дни "overdue" тот же маркер уже
     * "сделан", и клиент получал тишину до самого отключения на grace_over.
     * С датой в ключе warn шлётся каждый день, пока подписка не оплачена или
     * не наступит grace_over.
     */
    const dayKey = now.toISOString().slice(0, 10);
    const marker = `${kind}:${bot.subscription_expires_at}:${dayKey}`;

    if (await alreadyDone(bot.id, marker)) {
      results.push({ ...base, action: "skipped", detail: "уже сделано для этого периода" });
      continue;
    }

    if (shouldSuspend) {
      const { error: upErr } = await s
        .from("bots")
        .update({ status: "suspended" })
        .eq("id", bot.id);
      if (upErr) {
        results.push({
          ...base,
          action: "failed",
          detail: `не удалось приостановить: ${upErr.message}`,
        });
        continue;
      }
      await logAction(bot.id, "pause", marker, { reason: "subscription_overdue" });
      // Уведомление — попытка, а не условие: приостановка уже применена.
      const notice = await notify(bot, suspendText(sub.daysLeft));
      results.push({
        ...base,
        action: "suspended",
        detail: notice.ok ? "приостановлен, владелец уведомлён" : `приостановлен; ${notice.detail}`,
      });
      continue;
    }

    const notice = await notify(bot, warnText(sub.daysLeft, policy.on_overdue === "suspend"));
    if (!notice.ok) {
      // Не помечаем сделанным: недоставленное предупреждение должно повториться
      // на следующем запуске, когда деплой поднимется.
      results.push({ ...base, action: "failed", detail: notice.detail });
      continue;
    }
    await logAction(bot.id, "message", marker, { kind: "subscription_warning" });
    results.push({ ...base, action: "warned", detail: "владелец предупреждён" });
  }

  return results;
}

async function alreadyDone(botId: string, marker: string): Promise<boolean> {
  const s = await db();
  const { data, error } = await s
    .from("bot_events")
    .select("id")
    .eq("bot_id", botId)
    .eq("payload->>sweep_marker", marker)
    .limit(1);
  if (error) {
    // Раньше ошибка чтения отбрасывалась молча, и data?.length всегда читался
    // как "ничего не найдено" → "ещё не сделано" → обход шёл действовать. На
    // сбое одного запроса это рассылало повторные предупреждения (или
    // пыталось повторно приостановить) всем клиентам разом. Отказ проверки —
    // не повод действовать: лучше пропустить клиента на этом проходе и
    // попробовать на следующем, чем разослать дубль.
    console.error(
      `[operator] не удалось проверить идемпотентность обхода для ${botId}:`,
      error.message,
    );
    return true;
  }
  return (data?.length ?? 0) > 0;
}

async function logAction(
  botId: string,
  kind: "pause" | "message",
  marker: string,
  extra: Record<string, unknown>,
) {
  // Метка прохода — это и есть защита от повторов: следующий вызов в тот же
  // день найдёт её и пропустит клиента. Поэтому потерянная запись здесь не
  // просто пробел в журнале, а ещё и риск отправить владельцу второе такое же
  // предупреждение; logEvent сообщит о неудаче в лог.
  await logEvent(botId, "cron", kind, { ...extra, sweep_marker: marker } as never);
}

async function notify(
  bot: { app_url: string | null; internal_secret: string | null },
  text: string,
): Promise<{ ok: boolean; detail: string }> {
  const res = await callInternal(bot, "/api/internal/notify-owner", { text });
  return res.ok ? { ok: true, detail: "доставлено" } : { ok: false, detail: res.error };
}

function warnText(daysLeft: number | null, willSuspend: boolean): string {
  const tail = willSuspend
    ? "После окончания отсрочки бот будет временно приостановлен."
    : "Бот продолжит работать — просто напоминаем.";
  if (daysLeft !== null && daysLeft >= 0) {
    return `Подписка на бота заканчивается через ${daysLeft} дн. Продлите, пожалуйста, чтобы всё работало без перерыва.\n\n${tail}`;
  }
  return `Подписка на бота просрочена${daysLeft !== null ? ` на ${-daysLeft} дн.` : ""}. Продлите, пожалуйста.\n\n${tail}`;
}

function suspendText(daysLeft: number | null): string {
  return (
    `Бот временно приостановлен: подписка просрочена${daysLeft !== null ? ` на ${-daysLeft} дн.` : ""}. ` +
    "Как только оплата поступит, всё включится обратно — данные и настройки на месте."
  );
}
