import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import { authorizeMiniAppRequest } from "@/lib/mini-app.server";
import { logger } from "@/lib/logger.server";

type CartBody = {
  action?: string;
  product_id?: string;
  product_variant_id?: string | null;
  cart_item_id?: string;
  quantity?: number;
  code?: string;
};

const DISCOUNT_ACTIONS = [
  "promo_apply",
  "promo_clear",
  "gift_apply",
  "gift_clear",
  "points_use",
  "points_clear",
] as const;

type DiscountAction = (typeof DISCOUNT_ACTIONS)[number];

function isDiscountAction(value: string): value is DiscountAction {
  return (DISCOUNT_ACTIONS as readonly string[]).includes(value);
}

async function cartPayload(telegramId: number) {
  const { listMiniAppCart, miniAppUserContext, miniAppCartSummary, miniAppPendingPayment } =
    await import("@/lib/mini-app-cart.server");
  const items = await listMiniAppCart(telegramId);
  const summary = await miniAppCartSummary(telegramId, items);
  const context = await miniAppUserContext(telegramId);
  return {
    items,
    total: summary.total,
    subtotal: summary.subtotal,
    currency: items[0]?.currency ?? "KZT",
    country_code: context.countryCode,
    locale: context.locale,
    summary,
    pending_payment: await miniAppPendingPayment(telegramId),
  };
}

export const Route = createFileRoute("/api/public/mini-app/cart")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });

        const auth = await authorizeMiniAppRequest(request);
        if (!auth.ok) {
          return Response.json({ error: auth.error }, { status: auth.status });
        }

        return Response.json(await cartPayload(auth.user.id));
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
        logger.info("mini_app.cart_action", {
          telegram_id: auth.user.id,
          action,
        });
        const {
          ensureMiniAppBotUser,
          miniAppAddProduct,
          removeMiniAppCartItem,
          miniAppSetCartQuantity,
          miniAppChangeDiscount,
        } = await import("@/lib/mini-app-cart.server");

        await ensureMiniAppBotUser(auth.user);

        if (action === "remove") {
          const cartItemId = typeof body.cart_item_id === "string" ? body.cart_item_id.trim() : "";
          if (!cartItemId) return Response.json({ error: "missing_id" }, { status: 400 });
          const removed = await removeMiniAppCartItem(auth.user.id, cartItemId);
          if (!removed) return Response.json({ error: "not_found" }, { status: 404 });
          return Response.json({ ok: true, ...(await cartPayload(auth.user.id)) });
        }

        if (action === "set_quantity") {
          const cartItemId = typeof body.cart_item_id === "string" ? body.cart_item_id.trim() : "";
          const quantity = Number(body.quantity);
          if (!cartItemId) return Response.json({ error: "missing_id" }, { status: 400 });
          const result = await miniAppSetCartQuantity(auth.user.id, cartItemId, quantity);
          if (result === "not_found") return Response.json({ error: "not_found" }, { status: 404 });
          if (result !== "ok") return Response.json({ error: result }, { status: 400 });
          return Response.json({ ok: true, ...(await cartPayload(auth.user.id)) });
        }

        if (isDiscountAction(action)) {
          const code = typeof body.code === "string" ? body.code.trim().slice(0, 100) : undefined;
          const result = await miniAppChangeDiscount(auth.user.id, action, code);
          if (result !== "ok") return Response.json({ error: result }, { status: 400 });
          return Response.json({ ok: true, ...(await cartPayload(auth.user.id)) });
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
        return Response.json({ ok: true, ...(await cartPayload(auth.user.id)) });
      },
    },
  },
});
