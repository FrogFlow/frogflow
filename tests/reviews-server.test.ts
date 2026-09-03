import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * reviews.server.ts (upsertReview/updateReviewComment/reviewableProductsForOrder)
 * не имела ни одного теста. updateReviewComment — единственный путь дописать
 * комментарий к уже сохранённой оценке (Учителя, находка про отзывы без
 * комментариев): Mini App никогда его не вызывала, хотя функция существовала.
 */

type OrderRow = {
  id: number;
  status: string;
  telegram_id: number;
  order_items: Array<{ product_id: string | null; name_snapshot: string }>;
};

let ordersStore: OrderRow[] = [];
let reviewsStore: Array<{
  telegram_id: number;
  product_id: string;
  rating: number;
  comment: string | null;
}> = [];

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "orders") {
        return {
          select: (_cols: string) => ({
            eq: (_c1: string, orderId: number) => ({
              eq: (_c2: string, telegramId: number) => ({
                eq: (_c3: string, status: string) => ({
                  maybeSingle: async () => ({
                    data:
                      ordersStore.find(
                        (o) =>
                          o.id === orderId && o.telegram_id === telegramId && o.status === status,
                      ) ?? null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "product_reviews") {
        return {
          upsert: async (row: {
            telegram_id: number;
            product_id: string;
            rating: number;
            comment: string | null;
          }) => {
            const idx = reviewsStore.findIndex(
              (r) => r.telegram_id === row.telegram_id && r.product_id === row.product_id,
            );
            if (idx >= 0) reviewsStore[idx] = row;
            else reviewsStore.push(row);
            return { error: null };
          },
          update: (patch: { comment: string }) => ({
            eq: (_c1: string, telegramId: number) => ({
              eq: (_c2: string, productId: string) => {
                const row = reviewsStore.find(
                  (r) => r.telegram_id === telegramId && r.product_id === productId,
                );
                if (row) row.comment = patch.comment;
                return Promise.resolve({ error: row ? null : new Error("not found") });
              },
            }),
          }),
        };
      }
      throw new Error(`неожиданная таблица в моке: ${table}`);
    },
  },
}));

beforeEach(() => {
  ordersStore = [];
  reviewsStore = [];
});

describe("reviewableProductsForOrder", () => {
  it("возвращает уникальные товары доставленного заказа этого покупателя", async () => {
    ordersStore = [
      {
        id: 1,
        status: "delivered",
        telegram_id: 555,
        order_items: [
          { product_id: "p1", name_snapshot: "Материал 1" },
          { product_id: "p1", name_snapshot: "Материал 1" },
          { product_id: "p2", name_snapshot: "Материал 2" },
        ],
      },
    ];
    const { reviewableProductsForOrder } = await import("../src/lib/reviews.server");
    const items = await reviewableProductsForOrder(1, 555);
    expect(items).toEqual([
      { product_id: "p1", name: "Материал 1" },
      { product_id: "p2", name: "Материал 2" },
    ]);
  });

  it("чужой заказ или недоставленный — пустой список", async () => {
    ordersStore = [
      {
        id: 1,
        status: "awaiting_payment",
        telegram_id: 555,
        order_items: [{ product_id: "p1", name_snapshot: "M" }],
      },
    ];
    const { reviewableProductsForOrder } = await import("../src/lib/reviews.server");
    expect(await reviewableProductsForOrder(1, 555)).toEqual([]);
    expect(await reviewableProductsForOrder(1, 999)).toEqual([]);
  });
});

describe("upsertReview + updateReviewComment", () => {
  it("оценка звёздами пишется без комментария, комментарий дописывается отдельным вызовом", async () => {
    const { upsertReview, updateReviewComment } = await import("../src/lib/reviews.server");
    expect(await upsertReview(555, "p1", 5, null)).toBe(true);
    expect(reviewsStore).toEqual([
      { telegram_id: 555, product_id: "p1", rating: 5, comment: null },
    ]);

    expect(await updateReviewComment(555, "p1", "Отличный материал!")).toBe(true);
    expect(reviewsStore[0]!.comment).toBe("Отличный материал!");
    // Рейтинг не затронут дозаказным комментарием.
    expect(reviewsStore[0]!.rating).toBe(5);
  });

  it("updateReviewComment для несуществующей оценки — false, без побочных эффектов", async () => {
    const { updateReviewComment } = await import("../src/lib/reviews.server");
    expect(await updateReviewComment(555, "no-such-product", "текст")).toBe(false);
  });
});
