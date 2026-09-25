import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { isCronAuthorized } from "@/lib/cron-auth.server";
import { currentVertical } from "@/lib/verticals/vertical.server";
import { isConsultantVertical } from "@/lib/verticals/registry";
import { refreshCatalogFromSavedSheet } from "@/lib/consultant/catalog";
import { pollOutgoingManagerMessages } from "@/lib/consultant/outgoing-poll";
import { refreshVtbRate } from "@/lib/consultant/vtb";
import { sendDailyQualityDigest } from "@/lib/consultant-v2/quality-digest";
import { sendFollowUps } from "@/lib/consultant-v2/follow-up";

/**
 * Курс покупки VTB KZ и снимок Google Sheet — раз в 15 минут.
 * На digital/confectionery это no-op: vercel.json crons общие на все деплои.
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
          const [rate, catalog, outgoing, digest, followUps] = await Promise.all([
            refreshVtbRate(),
            refreshCatalogFromSavedSheet(),
            pollOutgoingManagerMessages().catch(() => ({ checked: 0, paused: 0 })),
            // Сводка качества за вчера — владельцу, раз в сутки после 9:00 по
            // Алматы (consultant-v2/quality-digest.ts).
            sendDailyQualityDigest().catch((e: unknown) => ({
              sent: false,
              reason: errorMessage(e),
            })),
            // Напоминание пропавшему покупателю — только v2 и только если
            // включено (consultant-v2/follow-up.ts).
            sendFollowUps().catch((e: unknown) => ({
              checked: 0,
              sent: 0,
              skipped: errorMessage(e),
            })),
          ]);
          return Response.json({ rate, catalog, outgoing, digest, followUps });
        } catch (e: unknown) {
          console.error("[cron/consultant-vtb]", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
