import { createFileRoute } from "@tanstack/react-router";

async function runInBackground(task: () => Promise<void>) {
  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(task());
  } catch {
    await task();
  }
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Fail-closed: без настроенного секрета вебхук не принимает ничего,
        // а не тихо доверяет любому POST. Тот же принцип, что уже применён
        // к вебхуку Zernio (api/public/zernio/webhook.ts).
        const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
        if (!expectedSecret) {
          console.error("[telegram webhook] TELEGRAM_WEBHOOK_SECRET не задан — запрос отклонён");
          return new Response("misconfigured", { status: 503 });
        }
        const secret = request.headers.get("x-telegram-bot-api-secret-token");
        if (secret !== expectedSecret) {
          return new Response("forbidden", { status: 403 });
        }

        let update: unknown;
        try {
          update = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const callbackData = (update as { callback_query?: { data?: string } })?.callback_query
          ?.data;
        const msg = (update as { message?: { photo?: unknown; document?: unknown } })?.message;
        const runUpdate = async () => {
          const { handleUpdate } = await import("@/lib/bot.server");
          // Граница доверия: тело запроса проверено секретом заголовка выше,
          // дальше типизированная форма — то, что handleUpdate реально читает.
          await handleUpdate(update as Parameters<typeof handleUpdate>[0]);
        };

        // confirm/reject и присланный чек (фото/файл) могут занять минуты на
        // крупных заказах — при автопроверке чека сообщение с фото/PDF
        // синхронно доходит до deliverOrder() и рассылки всех файлов заказа.
        // Отвечаем Telegram сразу, чтобы: 1) он не повторил то же обновление,
        // пока мы ещё выдаём файлы (иначе второй такой же заказ), и 2) пока
        // выдача идёт, getWebhookInfo не показывал pending_update_count > 0 —
        // это обновление уже честно доставлено, просто обрабатывается дольше.
        const isSlow =
          (typeof callbackData === "string" &&
            (callbackData.startsWith("confirm:") || callbackData.startsWith("reject:"))) ||
          Boolean(msg?.photo || msg?.document);
        if (isSlow) {
          await runInBackground(runUpdate);
          return new Response("ok");
        }

        await runUpdate();
        return new Response("ok");
      },
    },
  },
});
