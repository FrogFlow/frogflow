import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { runDailyLeadsPipeline } from "@/lib/operator/leads.server";
import { isCronAuthorized } from "@/lib/cron-auth.server";

/**
 * Суточный проход воронки продаж: поиск по ротации ICP-запросов (если
 * autoHunt) и прогон new → оценка → qualify/draft → дожим/lost.
 * Только панель (CONTROL_PLANE), как остальные /api/operator-cron/*.
 */
export const Route = createFileRoute("/api/operator-cron/leads")({
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
          const result = await runDailyLeadsPipeline();
          return Response.json({ ok: true, ...result });
        } catch (e: unknown) {
          console.error("[operator-cron] воронка лидов упала:", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
