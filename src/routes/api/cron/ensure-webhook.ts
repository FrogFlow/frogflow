import { createFileRoute } from "@tanstack/react-router";
import { ensureTelegramWebhook } from "@/lib/webhook-ensure.server";
import { isCronAuthorized } from "@/lib/cron-auth.server";
import { errorMessage } from "@/lib/error-message";

/**
 * Часовой независимый self-heal вебхука — подстраховка сверх той же проверки,
 * которая и так идёт на каждый тик /api/cron/broadcast. На Vercel Pro стоит
 * отдельным заданием в vercel.json → crons; раньше здесь ожидался внешний
 * cron-job.org, потому что нативный Vercel Cron на Hobby разрешал не чаще
 * раза в сутки.
 */
export const Route = createFileRoute("/api/cron/ensure-webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // См. тот же no-op в /api/cron/broadcast — у панели оператора нет
        // своего бота и нет вебхука, который надо было бы чинить.
        if (process.env.CONTROL_PLANE === "1") {
          return new Response("Not found", { status: 404 });
        }
        if (!isCronAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const result = await ensureTelegramWebhook();
        const { ensureZernioWebhook } = await import("@/lib/zernio.server");
        let zernio: Awaited<ReturnType<typeof ensureZernioWebhook>>;
        try {
          zernio = await ensureZernioWebhook();
        } catch (e: unknown) {
          zernio = { ok: false, action: "error", error: errorMessage(e) };
        }
        const ok = result.ok && (zernio.action === "skipped" || zernio.ok);
        return Response.json({ ...result, zernio }, { status: ok ? 200 : 500 });
      },
    },
  },
});
