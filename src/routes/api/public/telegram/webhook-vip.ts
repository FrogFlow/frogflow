import { createFileRoute } from "@tanstack/react-router";
import { verifyTelegramWebhookSecret } from "@/lib/telegram-webhook.server";

export const Route = createFileRoute("/api/public/telegram/webhook-vip")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (
          !verifyTelegramWebhookSecret(request, [
            "VIP_TELEGRAM_WEBHOOK_SECRET",
            "TELEGRAM_WEBHOOK_SECRET",
          ])
        ) {
          return new Response("unauthorized", { status: 401 });
        }
        let update: unknown;
        try {
          update = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }
        // Выключенный в панели модуль обязан гасить и второго бота: иначе
        // тумблер «VIP» снимает только раздел админки, а сам VIP-бот
        // продолжает принимать оплату за подписки.
        //
        // Отвечаем 200, а не ошибкой: для Telegram ошибка — повод повторить
        // доставку, и очередь апдейтов росла бы, пока модуль выключен.
        const { hasModule } = await import("@/lib/modules/modules.server");
        if (!(await hasModule("vip"))) return new Response("ok");

        const { handleVipUpdate } = await import("@/lib/vip-bot.server");
        // Граница доверия: тело запроса проверено секретом заголовка выше,
        // дальше типизированная форма — то, что handleVipUpdate реально читает.
        await handleVipUpdate(update as Parameters<typeof handleVipUpdate>[0]);
        return new Response("ok");
      },
    },
  },
});
