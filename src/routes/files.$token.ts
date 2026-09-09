import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";

export const Route = createFileRoute("/files/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });
        const { orderFilesPageResponse } = await import("@/lib/order-files-page.server");
        return await orderFilesPageResponse(params.token);
      },
    },
  },
});
