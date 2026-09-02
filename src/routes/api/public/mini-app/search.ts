import { authorizeMiniAppRequest } from "@/lib/mini-app.server";
import { consumeMiniAppRateLimit } from "@/lib/mini-app-rate-limit.server";
import { isControlPlane } from "@/lib/control-plane.server";
import { logger } from "@/lib/logger.server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/mini-app/search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });

        const auth = await authorizeMiniAppRequest(request);
        if (!auth.ok) {
          return Response.json({ error: auth.error }, { status: auth.status });
        }
        const limit = consumeMiniAppRateLimit("search", auth.user.id);
        if (!limit.ok) {
          return Response.json(
            { error: "rate_limited" },
            { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
          );
        }

        let body: {
          q?: string;
          category?: string;
          country?: string;
          lang?: string;
          mlang?: string;
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const { miniAppSmartSearchHtml } = await import("@/lib/mini-app-search.server");
        const result = await miniAppSmartSearchHtml({
          telegramId: auth.user.id,
          query: String(body.q || ""),
          categoryId: String(body.category || ""),
          countryCode: String(body.country || "").toUpperCase() || null,
          locale: body.lang,
          materialLang: body.mlang,
        });
        logger.info("mini_app.smart_search", {
          telegram_id: auth.user.id,
          query_len: String(body.q || "").length,
          hits: result.total,
          used: result.usedSmartSearch,
          source: "mini_app",
        });
        return Response.json(result);
      },
    },
  },
});
