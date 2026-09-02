import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { processBroadcastBatch } from "@/lib/broadcast.server";
import { processPendingDeliveries } from "@/lib/orders.server";
import { ensureTelegramWebhook } from "@/lib/webhook-ensure.server";
import { isCronAuthorized } from "@/lib/cron-auth.server";
import { flushDueAdminOrderNotifications } from "@/lib/admin-order-notify.server";

/**
 * Рассылка + выдача отложенных заказов + подтверждение вебхука + удаление
 * пачки админских уведомлений о заказе спустя 5 минут после принять/отклонить.
 */
export const Route = createFileRoute("/api/cron/broadcast")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Панели оператора (CONTROL_PLANE=1) рассылать/выдавать нечего — своего
        // BOT_ID у неё нет. vercel.json crons общий для всех деплоев этого
        // репозитория, поэтому явный no-op, а не ошибка на каждый тик.
        if (process.env.CONTROL_PLANE === "1") {
          return new Response("Not found", { status: 404 });
        }
        if (!isCronAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const webhook = await ensureTelegramWebhook();

          let total = 0;
          let done = false;
          let last: Awaited<ReturnType<typeof processBroadcastBatch>> | undefined;
          for (let i = 0; i < 4 && !done; i++) {
            last = await processBroadcastBatch();
            total += last.processed;
            done = last.done;
            if (!last.processed) break;
          }

          let deliveries:
            Awaited<ReturnType<typeof processPendingDeliveries>> | { error: string } | undefined;
          try {
            deliveries = await processPendingDeliveries(5);
          } catch (e: unknown) {
            console.error("[cron/broadcast] deliveries", e);
            deliveries = { error: errorMessage(e) || String(e) };
          }

          let adminNotify:
            | Awaited<ReturnType<typeof flushDueAdminOrderNotifications>>
            | { error: string }
            | undefined;
          try {
            adminNotify = await flushDueAdminOrderNotifications();
          } catch (e: unknown) {
            console.error("[cron/broadcast] admin notify dismiss", e);
            adminNotify = { error: errorMessage(e) || String(e) };
          }

          return Response.json({
            ok: true,
            webhook,
            processed: total,
            done,
            deliveries,
            adminNotify,
            ...last,
          });
        } catch (e: unknown) {
          console.error("[cron/broadcast]", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
