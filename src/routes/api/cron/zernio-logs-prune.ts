import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { pruneZernioLogs } from "@/lib/zernio-logs.server";

/**
 * Ретеншн zernio_logs — раньше жил внутри /api/cron/broadcast по той же
 * причине, что и /api/cron/zernio-retry (см. комментарий там): на Hobby
 * второй внешний cron не окупался. Уборке не нужна частота рассылок — раз в
 * сутки достаточно, поэтому отдельное расписание в vercel.json, а не
 * "каждую минуту заодно".
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return new URL(request.url).searchParams.get("secret") === secret;
}

export const Route = createFileRoute("/api/cron/zernio-logs-prune")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // См. тот же no-op в /api/cron/zernio-retry — панели оператора
        // (CONTROL_PLANE=1) чистить нечего, своего BOT_ID у неё нет.
        if (process.env.CONTROL_PLANE === "1") {
          return new Response("Not found", { status: 404 });
        }
        if (!isAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await pruneZernioLogs();
          return Response.json({ ok: true, ...result });
        } catch (e: unknown) {
          console.error("[cron/zernio-logs-prune]", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
