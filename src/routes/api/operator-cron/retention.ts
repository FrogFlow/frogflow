import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { pruneOperatorAuditTables } from "@/lib/misc-retention.server";
import { isCronAuthorized } from "@/lib/cron-auth.server";

/**
 * Ретеншн `bot_events` и `operator_login_attempts` (Блок 3.2, кейс 2) —
 * центральный журнал панели, живёт только здесь, как и обход подписок в
 * этой же папке.
 *
 * Две проверки, а не одна: CONTROL_PLANE отсекает клиентские деплои (там
 * этот путь обязан выглядеть несуществующим, как и весь /operator),
 * CRON_SECRET — всех остальных.
 */
export const Route = createFileRoute("/api/operator-cron/retention")({
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
          const result = await pruneOperatorAuditTables();
          return Response.json({ ok: true, ...result });
        } catch (e: unknown) {
          console.error("[operator-cron/retention]", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
