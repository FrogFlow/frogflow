/**
 * Добор застрявших событий Instagram.
 *
 * Обработка вебхука уходит в фон через `waitUntil` (см.
 * `routes/api/public/zernio/webhook.ts`): если инстанс Vercel свернули
 * раньше, чем фоновая задача дошла до записи статуса, строка в
 * `zernio_logs` остаётся в `pending` навсегда — ни `processed`, ни `error`.
 * Перечитывать их было некому: Zernio на такое событие уже получил `200` и
 * повторять его не будет. На момент обследования таких строк было 69 —
 * доля небольшая (0,4–0,6 %), но природа не разовая, и без добора она растёт
 * пропорционально трафику.
 *
 * Раньше делать добор было небезопасно: повторная обработка могла отправить
 * покупателю то же сообщение дважды. Теперь каждая отправка в Direct несёт
 * `Idempotency-Key`, выведенный из `event_id` и тела (см.
 * `zernio-event-context.server.ts`) — повтор с тем же `event_id` даёт тот же
 * ключ, и Zernio отдаёт исходный ответ вместо второй отправки. Поэтому
 * повторный вызов `handleZernioMessage` с тем же payload безопасен даже
 * если первая попытка успела дойти до отправки, просто не успела записать
 * статус.
 *
 * Остаётся более узкий случай: если первая попытка успела не только
 * отправить сообщение, но и продвинуть шаг сценария покупки (например,
 * создать заказ и перевести `bot_users.state` на «ждём почту»), повтор
 * увидит уже другой шаг и отправит вложение по ветке «вложение вне
 * сценария» — заказ он не задвоит (это как раз чинит claimAwaitingProof в
 * direct-purchase.server.ts), но продавцу может уйти лишнее уведомление
 * «прислал вложение, а заказа нет». Цена этого — не пропущенное сообщение
 * ценой месяцами лежащей мёртвой строки, поэтому размен в пользу добора.
 */

/** Событие считается зависшим, если висит в pending дольше этого срока. Внешний крон дёргает /api/cron/broadcast раз в 1–2 минуты (см. DEPLOYMENT.md), так что 5 минут — с запасом на нормальную обработку и без ложных повторов. */
const STUCK_AFTER_MS = 5 * 60 * 1000;

/** Потолок на один проход крона — чтобы не упереться в таймаут serverless-функции. */
const BATCH = 10;

type StuckRow = { id: string; event_id: string | null; event_type: string; payload: unknown };

export async function retryStuckZernioEvents(): Promise<{
  found: number;
  recovered: number;
  stillStuck: number;
}> {
  // Тот же гейт, что у самого вебхука: выключенный модуль не должен слать
  // сообщения. Отставшие строки при этом не трогаем — просто ждут своего
  // часа, если Instagram включат обратно.
  const { hasModule } = await import("./modules/modules.server");
  if (!(await hasModule("instagram"))) {
    return { found: 0, recovered: 0, stillStuck: 0 };
  }

  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();

  // Явный фильтр по арендатору — не полагаемся только на RLS. hasModule()
  // выше уже потребовал BOT_ID (иначе бросил бы исключение), так что здесь
  // он точно есть; дублирование — тот же приём, которым client.server.ts
  // отказывается стартовать под service_role без ключа арендатора: одна
  // защита может отказать, две одновременно — маловероятно.
  const { data: stuck, error } = await supabaseAdmin
    .from("zernio_logs")
    .select("id, event_id, event_type, payload")
    .eq("bot_id", process.env.BOT_ID!.trim())
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) throw new Error(error.message);
  if (!stuck || stuck.length === 0) {
    return { found: 0, recovered: 0, stillStuck: 0 };
  }

  let recovered = 0;
  for (const row of stuck as StuckRow[]) {
    try {
      // Тот же разбор, что и в самом вебхуке: обрабатывается только то, на
      // что мы подписаны. Другие типы (следы старой подписки, см. третье
      // обследование) отметить обработанными и без действия — обрабатывать
      // их некому и не за чем.
      if (row.event_type === "message.received") {
        const { handleZernioMessage } = await import("./zernio-bot.server");
        const { runWithZernioEvent } = await import("./zernio-event-context.server");
        await runWithZernioEvent(row.event_id, async () => {
          await handleZernioMessage(row.payload);
        });
      }
      await supabaseAdmin.from("zernio_logs").update({ status: "processed" }).eq("id", row.id);
      recovered++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[zernio-retry] событие ${row.id} не обработалось повторно`, e);
      await supabaseAdmin
        .from("zernio_logs")
        .update({ status: "error", error_message: message.slice(0, 500) })
        .eq("id", row.id);
    }
  }

  return { found: stuck.length, recovered, stillStuck: stuck.length - recovered };
}
