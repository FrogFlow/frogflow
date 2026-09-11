import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { isCronAuthorized } from "@/lib/cron-auth.server";
import { currentVertical } from "@/lib/verticals/vertical.server";
import { isConsultantVertical } from "@/lib/verticals/registry";
import { refreshVtbRate } from "@/lib/consultant/vtb";

/**
 * Курс покупки VTB KZ — раз в 15 минут. На digital/confectionery это no-op:
 * vercel.json crons общие на все деплои.
 */
export const Route = createFileRoute("/api/cron/consultant-vtb")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (process.env.CONTROL_PLANE === "1") {
          return new Response("Not found", { status: 404 });
        }
        if (!isCronAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (!isConsultantVertical(currentVertical())) {
          return Response.json({ ok: true, skipped: "not_consultant" });
        }
        try {
          const result = await refreshVtbRate();
          return Response.json(result);
        } catch (e: unknown) {
          console.error("[cron/consultant-vtb]", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
