import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import { authorizeMiniAppRequest } from "@/lib/mini-app.server";

export const Route = createFileRoute("/api/public/mini-app/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });

        const auth = await authorizeMiniAppRequest(request);
        if (!auth.ok) {
          return Response.json({ error: auth.error }, { status: auth.status });
        }

        const { ensureMiniAppBotUser, miniAppRunCheckout } = await import("@/lib/mini-app-cart.server");
        await ensureMiniAppBotUser(auth.user);

        let body: Record<string, unknown> = {};
        try {
          const raw = await request.text();
          if (raw.trim()) body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const result = await miniAppRunCheckout(auth.user.id, body);
        if (result.step === "error") {
          const status = result.error === "empty_cart" ? 400 : 400;
          return Response.json(result, { status });
        }
        return Response.json(result);
      },
    },
  },
});
