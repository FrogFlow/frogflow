import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import { authorizeMiniAppRequest } from "@/lib/mini-app.server";
import { consumeMiniAppRateLimit } from "@/lib/mini-app-rate-limit.server";
import { getCachedBotUrl } from "@/lib/bot-url.server";

function limited(telegramId: number): Response | null {
  const limit = consumeMiniAppRateLimit("library", telegramId);
  return limit.ok
    ? null
    : Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
}

export const Route = createFileRoute("/api/public/mini-app/library")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });
        const auth = await authorizeMiniAppRequest(request);
        if (!auth.ok) {
          return Response.json({ error: auth.error }, { status: auth.status });
        }
        const rateResponse = limited(auth.user.id);
        if (rateResponse) return rateResponse;
        const { listMiniAppLibrary } = await import("@/lib/mini-app-library.server");
        return Response.json({
          items: await listMiniAppLibrary(auth.user.id),
          botUrl: await getCachedBotUrl(),
        });
      },
    },
  },
});
