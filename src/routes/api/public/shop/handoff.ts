import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";

type HandoffBody = {
  items?: Array<{
    product_id?: string;
    product_variant_id?: string | null;
    quantity?: number;
  }>;
};

export const Route = createFileRoute("/api/public/shop/handoff")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (isControlPlane()) {
          return new Response("Not found", { status: 404 });
        }

        const { hasModule } = await import("@/lib/modules/modules.server");
        if (!(await hasModule("web_storefront"))) {
          return new Response("Not found", { status: 404 });
        }

        let body: HandoffBody;
        try {
          body = (await request.json()) as HandoffBody;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const rawItems = body.items ?? [];
        if (!Array.isArray(rawItems) || rawItems.length === 0) {
          return Response.json({ error: "empty_cart" }, { status: 400 });
        }

        const items = rawItems
          .map((row) => ({
            product_id: typeof row.product_id === "string" ? row.product_id.trim() : "",
            product_variant_id:
              row.product_variant_id === null || row.product_variant_id === undefined
                ? null
                : typeof row.product_variant_id === "string"
                  ? row.product_variant_id.trim()
                  : null,
            quantity:
              typeof row.quantity === "number" && Number.isFinite(row.quantity) ? row.quantity : 1,
          }))
          .filter((row) => row.product_id);

        const { createWebCartHandoff } = await import("@/lib/web-storefront-handoff.server");
        const result = await createWebCartHandoff(items);

        if (!result.ok) {
          if (result.reason === "empty") {
            return Response.json({ error: "empty_cart" }, { status: 400 });
          }
          if (result.reason === "no_bot_url") {
            return Response.json({ error: "bot_unavailable" }, { status: 503 });
          }
          return Response.json({ error: "handoff_failed" }, { status: 503 });
        }

        return Response.json({ url: result.url, token: result.token });
      },
    },
  },
});
