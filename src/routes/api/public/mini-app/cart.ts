import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import { authorizeMiniAppRequest } from "@/lib/mini-app.server";

type CartBody = {
  action?: string;
  product_id?: string;
  product_variant_id?: string | null;
  cart_item_id?: string;
  quantity?: number;
};

export const Route = createFileRoute("/api/public/mini-app/cart")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });

        const auth = await authorizeMiniAppRequest(request);
        if (!auth.ok) {
          return Response.json({ error: auth.error }, { status: auth.status });
        }

        const { listMiniAppCart } = await import("@/lib/mini-app-cart.server");
        const items = await listMiniAppCart(auth.user.id);
        const total = items.reduce((sum, row) => sum + row.line_total, 0);
        const currency = items[0]?.currency ?? "KZT";
        return Response.json({ items, total, currency });
      },
      POST: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });

        const auth = await authorizeMiniAppRequest(request);
        if (!auth.ok) {
          return Response.json({ error: auth.error }, { status: auth.status });
        }

        let body: CartBody;
        try {
          body = (await request.json()) as CartBody;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const action = typeof body.action === "string" ? body.action.trim() : "";
        const {
          ensureMiniAppBotUser,
          miniAppAddProduct,
          removeMiniAppCartItem,
          listMiniAppCart,
          miniAppSetCartQuantity,
        } = await import("@/lib/mini-app-cart.server");

        await ensureMiniAppBotUser(auth.user);

        if (action === "remove") {
          const cartItemId = typeof body.cart_item_id === "string" ? body.cart_item_id.trim() : "";
          if (!cartItemId) return Response.json({ error: "missing_id" }, { status: 400 });
          const removed = await removeMiniAppCartItem(auth.user.id, cartItemId);
          if (!removed) return Response.json({ error: "not_found" }, { status: 404 });
          const items = await listMiniAppCart(auth.user.id);
          return Response.json({ ok: true, items });
        }

        if (action === "set_quantity") {
          const cartItemId = typeof body.cart_item_id === "string" ? body.cart_item_id.trim() : "";
          const quantity = Number(body.quantity);
          if (!cartItemId) return Response.json({ error: "missing_id" }, { status: 400 });
          const result = await miniAppSetCartQuantity(auth.user.id, cartItemId, quantity);
          if (result === "not_found") return Response.json({ error: "not_found" }, { status: 404 });
          if (result !== "ok") return Response.json({ error: result }, { status: 400 });
          const items = await listMiniAppCart(auth.user.id);
          return Response.json({ ok: true, items });
        }

        if (action !== "add") return Response.json({ error: "invalid_action" }, { status: 400 });

        const productId = typeof body.product_id === "string" ? body.product_id.trim() : "";
        if (!productId) return Response.json({ error: "missing_product" }, { status: 400 });
        const variantId =
          body.product_variant_id === null || body.product_variant_id === undefined
            ? null
            : typeof body.product_variant_id === "string"
              ? body.product_variant_id.trim()
              : null;

        const result = await miniAppAddProduct(auth.user.id, productId, variantId);
        if (result !== "ok") {
          return Response.json({ error: result }, { status: 400 });
        }
        const items = await listMiniAppCart(auth.user.id);
        return Response.json({ ok: true, items });
      },
    },
  },
});
