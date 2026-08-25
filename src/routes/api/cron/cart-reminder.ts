import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { sendAbandonedCartReminders } from "@/lib/cart-reminder.server";
import { isCronAuthorized } from "@/lib/cron-auth.server";

/**
 * Возврат брошенной корзины (Кейс 3, №6) — раз в 30 минут (см. vercel.json).
 */
export const Route = createFileRoute("/api/cron/cart-reminder")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Панели оператора (CONTROL_PLANE=1) напоминать некому, своего BOT_ID у неё нет.
        if (process.env.CONTROL_PLANE === "1") {
          return new Response("Not found", { status: 404 });
        }
        if (!isCronAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await sendAbandonedCartReminders();
          return Response.json({ ok: true, ...result });
        } catch (e: unknown) {
          console.error("[cron/cart-reminder]", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
