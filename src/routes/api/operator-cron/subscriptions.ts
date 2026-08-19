import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { sweepSubscriptions } from "@/lib/operator/subscription-cron.server";
import { isCronAuthorized } from "@/lib/cron-auth.server";

/**
 * Ежедневный обход подписок. Живёт на проекте панели: только у неё есть доступ
 * ко всем клиентам сразу.
 *
 * Две проверки, а не одна: CONTROL_PLANE отсекает клиентские деплои (там этот
 * путь обязан выглядеть несуществующим, как и весь /operator), CRON_SECRET —
 * всех остальных.
 */
export const Route = createFileRoute("/api/operator-cron/subscriptions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (process.env.CONTROL_PLANE !== "1") {
          return new Response("Not found", { status: 404 });
        }
        if (!isCronAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const results = await sweepSubscriptions();
          const counts = results.reduce<Record<string, number>>((acc, r) => {
            acc[r.action] = (acc[r.action] ?? 0) + 1;
            return acc;
          }, {});
          return Response.json({ ok: true, counts, results });
        } catch (e: unknown) {
          console.error("[operator-cron] обход подписок упал:", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
