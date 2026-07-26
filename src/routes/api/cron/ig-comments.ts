import { createFileRoute } from "@tanstack/react-router";
import { processIgCommentPoll } from "@/lib/ig-comments.server";

function isAuthorized(request: Request): boolean {
  // Separate from Telegram CRON_SECRET (broadcast / ensure-webhook)
  const secret = process.env.IG_CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export const Route = createFileRoute("/api/cron/ig-comments")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await processIgCommentPoll({ maxDms: 20 });
          return Response.json(result);
        } catch (e: any) {
          console.error("[cron/ig-comments]", e);
          return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
        }
      },
    },
  },
});
