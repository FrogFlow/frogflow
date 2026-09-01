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

        const { ensureMiniAppBotUser, miniAppCheckoutInChat } =
          await import("@/lib/mini-app-cart.server");
        await ensureMiniAppBotUser(auth.user);

        const result = await miniAppCheckoutInChat(auth.user.id);
        if (!result.ok) {
          if (result.reason === "empty_cart") {
            return Response.json({ error: "empty_cart" }, { status: 400 });
          }
          return Response.json({ error: result.reason }, { status: 400 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
