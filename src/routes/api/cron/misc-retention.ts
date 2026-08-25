import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { pruneAdminLoginAttempts, pruneBroadcastRecipients } from "@/lib/misc-retention.server";
import { isCronAuthorized } from "@/lib/cron-auth.server";

/**
 * Ретеншн арендаторских таблиц без него: попытки входа в панель продавца и
 * получатели старых рассылок (Блок 3.2). Обе достаточно мелкие, чтобы не
 * заводить им по отдельному крону, как это сделано для zernio_logs и
 * manager_chat_messages.
 */
export const Route = createFileRoute("/api/cron/misc-retention")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Панели оператора (CONTROL_PLANE=1) чистить нечего, своего BOT_ID у неё нет.
        if (process.env.CONTROL_PLANE === "1") {
          return new Response("Not found", { status: 404 });
        }
        if (!isCronAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const [logins, recipients] = await Promise.all([
            pruneAdminLoginAttempts(),
            pruneBroadcastRecipients(),
          ]);
          return Response.json({ ok: true, logins, recipients });
        } catch (e: unknown) {
          console.error("[cron/misc-retention]", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
