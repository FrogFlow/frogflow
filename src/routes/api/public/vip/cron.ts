import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { isVipCronAuthorized, runVipCronJob } from "@/lib/vip-cron.server";
import { ensureDidWebhooks } from "@/lib/webhook-ensure.server";

export const Route = createFileRoute("/api/public/vip/cron")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // См. тот же no-op в /api/cron/broadcast — у панели оператора нет
        // своего бота и нет VIP-группы, которую надо было бы обходить.
        if (process.env.CONTROL_PLANE === "1") {
          return new Response("Not found", { status: 404 });
        }
        if (!isVipCronAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          // Self-heal shop+VIP webhooks every cron tick (URL empty / secret mismatch / delivery errors)
          const webhooks = await ensureDidWebhooks();
          let vipCron:
            Awaited<ReturnType<typeof runVipCronJob>> | { skipped: true; reason: string };
          try {
            vipCron = await runVipCronJob();
          } catch (e) {
            // e.g. vip_group_id missing — still report webhook heal
            vipCron = { skipped: true, reason: errorMessage(e) };
          }
          return Response.json({ ok: true, webhooks, vipCron });
        } catch (e) {
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
