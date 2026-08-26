import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { recordHealthSnapshots } from "@/lib/operator/health-snapshot-cron.server";
import { isCronAuthorized } from "@/lib/cron-auth.server";

/**
 * Снимок здоровья всех ботов раз в 15 минут — источник «Истории падений» на
 * карточке клиента. Живёт на проекте панели, как и остальные operator-cron:
 * только у неё есть доступ ко всем клиентам сразу.
 *
 * Две проверки, а не одна: CONTROL_PLANE отсекает клиентские деплои (там
 * этот путь обязан выглядеть несуществующим, как и весь /operator),
 * CRON_SECRET — всех остальных.
 */
export const Route = createFileRoute("/api/operator-cron/health-snapshot")({
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
          const result = await recordHealthSnapshots();
          return Response.json({ ok: true, ...result });
        } catch (e: unknown) {
          console.error("[operator-cron/health-snapshot]", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
