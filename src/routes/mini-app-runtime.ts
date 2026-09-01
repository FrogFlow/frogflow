import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import { MINI_APP_RUNTIME_JS } from "@/lib/mini-app-runtime";

export const Route = createFileRoute("/mini-app-runtime")({
  server: {
    handlers: {
      GET: async () => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });
        return new Response(MINI_APP_RUNTIME_JS, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
