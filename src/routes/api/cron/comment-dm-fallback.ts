import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { runCommentDmFallback } from "@/lib/comment-dm-fallback.server";
import { isCronAuthorized } from "@/lib/cron-auth.server";

/**
 * Резервная (fallback) отправка DM по комментарию — раз в 15 минут проверяет,
 * не замолчала ли родная автоматизация Comment-to-DM Zernio на каком-то
 * посте, и при необходимости отвечает сама (см. comment-dm-fallback.server.ts
 * и MIGRATION-62 — подробная история инцидента и обоснование решения).
 */
export const Route = createFileRoute("/api/cron/comment-dm-fallback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // У панели оператора (CONTROL_PLANE=1) нет своего BOT_ID и нет
        // Instagram-аккаунтов — этой задаче тут нечего делать (тот же приём,
        // что и у /api/cron/zernio-retry).
        if (process.env.CONTROL_PLANE === "1") {
          return new Response("Not found", { status: 404 });
        }
        if (!isCronAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await runCommentDmFallback();
          return Response.json({ ok: true, ...result });
        } catch (e: unknown) {
          console.error("[cron/comment-dm-fallback]", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
