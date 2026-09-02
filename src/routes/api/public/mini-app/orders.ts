import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import { authorizeMiniAppRequest } from "@/lib/mini-app.server";
import { consumeMiniAppRateLimit } from "@/lib/mini-app-rate-limit.server";
import { getCachedBotUrl } from "@/lib/bot-url.server";
import { isValidRating } from "@/lib/reviews";

function limited(telegramId: number): Response | null {
  const limit = consumeMiniAppRateLimit("orders", telegramId);
  return limit.ok
    ? null
    : Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
}

type OrderListRow = {
  id: number;
  order_no: number | null;
  display_no: number | null;
  status: string;
  total: number | string;
  currency: string;
  created_at: string;
  fulfillment_kind: string | null;
  fulfillment_type: string | null;
  fulfillment_at: string | null;
  paid_amount: number | string | null;
  payment_proof_path: string | null;
  delivery_lang_choice: string | null;
  order_items: Array<{ product_id: string | null; name_snapshot: string | null }> | null;
};

export const Route = createFileRoute("/api/public/mini-app/orders")({
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

        const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
        const { hasModule } = await import("@/lib/modules/modules.server");
        const reviewsEnabled = await hasModule("review_request");
        const { data, error } = await supabaseAdmin
          .from("orders")
          .select(
            "id, order_no, display_no, status, total, currency, created_at, fulfillment_kind, fulfillment_type, fulfillment_at, paid_amount, payment_proof_path, delivery_lang_choice, order_items(product_id, name_snapshot)",
          )
          .eq("telegram_id", auth.user.id)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) {
          return Response.json({ error: "orders_failed" }, { status: 503 });
        }

        const ratings = new Map<string, number>();
        if (reviewsEnabled) {
          const { data: reviewRows } = await supabaseAdmin
            .from("product_reviews")
            .select("product_id, rating")
            .eq("telegram_id", auth.user.id);
          for (const row of reviewRows ?? []) {
            if (row.product_id) ratings.set(row.product_id, Number(row.rating));
          }
        }

        return Response.json({
          orders: ((data ?? []) as OrderListRow[]).map((order) => {
            const seen = new Set<string>();
            const items: Array<{ productId: string; name: string; rating: number | null }> = [];
            for (const item of order.order_items ?? []) {
              if (!item.product_id || seen.has(item.product_id)) continue;
              seen.add(item.product_id);
              items.push({
                productId: item.product_id,
                name: item.name_snapshot || "",
                rating: ratings.get(item.product_id) ?? null,
              });
            }
            return {
              id: order.id,
              displayNo: order.display_no ?? order.order_no ?? order.id,
              status: order.status,
              total: Number(order.total),
              currency: order.currency,
              createdAt: order.created_at,
              fulfillmentKind: order.fulfillment_kind,
              fulfillmentType: order.fulfillment_type,
              fulfillmentAt: order.fulfillment_at,
              paidAmount: Number(order.paid_amount ?? 0),
              hasProof: Boolean(order.payment_proof_path),
              deliveryLang: order.delivery_lang_choice,
              items,
            };
          }),
          reviewsEnabled,
          botUrl: await getCachedBotUrl(),
        });
      },
      POST: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });
        const auth = await authorizeMiniAppRequest(request);
        if (!auth.ok) {
          return Response.json({ error: auth.error }, { status: auth.status });
        }
        const rateResponse = limited(auth.user.id);
        if (rateResponse) return rateResponse;
        let body: {
          action?: string;
          order_id?: number;
          product_id?: string;
          rating?: number;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        if (body.action === "rate") {
          const { hasModule } = await import("@/lib/modules/modules.server");
          if (!(await hasModule("review_request"))) {
            return Response.json({ error: "reviews_disabled" }, { status: 400 });
          }
          const orderId = Number(body.order_id);
          const productId = typeof body.product_id === "string" ? body.product_id.trim() : "";
          const rating = Number(body.rating);
          if (!Number.isInteger(orderId) || !productId || !isValidRating(rating)) {
            return Response.json({ error: "invalid_action" }, { status: 400 });
          }
          const { reviewableProductsForOrder, upsertReview } = await import("@/lib/reviews.server");
          const reviewable = await reviewableProductsForOrder(orderId, auth.user.id);
          if (!reviewable.some((item) => item.product_id === productId)) {
            return Response.json({ error: "not_allowed" }, { status: 400 });
          }
          const ok = await upsertReview(auth.user.id, productId, rating, null);
          if (!ok) return Response.json({ error: "rate_failed" }, { status: 500 });
          return Response.json({ ok: true, rating });
        }

        if (body.action !== "resend" || !Number.isInteger(Number(body.order_id))) {
          return Response.json({ error: "invalid_action" }, { status: 400 });
        }
        const { resendOrderFiles } = await import("@/lib/orders.server");
        const result = await resendOrderFiles(Number(body.order_id), auth.user.id);
        if (!result.ok) {
          return Response.json({ error: result.reason }, { status: 400 });
        }
        return Response.json(result);
      },
    },
  },
});
