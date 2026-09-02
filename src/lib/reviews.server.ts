/**
 * Отзывы и рейтинг товаров (Кейс 3, №5).
 *
 * Право оставить отзыв — реально доставленная покупка этого товара, не
 * просто оформленный заказ (иначе оценивать можно было бы то, что ещё не
 * получил). rating_avg/rating_count на products пересчитывает триггер
 * MIGRATION-43 сам, здесь их не трогаем.
 */

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function hasDeliveredPurchase(
  telegramId: number,
  productId: string,
): Promise<boolean> {
  const s = await db();
  const { data: orders } = await s
    .from("orders")
    .select("id")
    .eq("telegram_id", telegramId)
    .eq("status", "delivered");
  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length === 0) return false;
  const { data: item } = await s
    .from("order_items")
    .select("id")
    .eq("product_id", productId)
    .in("order_id", orderIds)
    .limit(1)
    .maybeSingle();
  return Boolean(item);
}

export async function listPublicProductReviews(
  productId: string,
  limit = 5,
): Promise<Array<{ rating: number; comment: string | null }>> {
  const s = await db();
  const { data } = await s
    .from("product_reviews")
    .select("rating, comment")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(20, limit)));
  return (data ?? []).map((row) => ({
    rating: Number(row.rating),
    comment: row.comment,
  }));
}

/** Товары из заказа, которые можно оценить: реально доставленные, с именем для кнопки. */
export async function reviewableProductsForOrder(
  orderId: number,
  telegramId: number,
): Promise<Array<{ product_id: string; name: string }>> {
  const s = await db();
  const { data: order } = await s
    .from("orders")
    .select("id, status, telegram_id, order_items(product_id, name_snapshot)")
    .eq("id", orderId)
    .eq("telegram_id", telegramId)
    .eq("status", "delivered")
    .maybeSingle();
  if (!order) return [];
  const items =
    (order.order_items as Array<{ product_id: string | null; name_snapshot: string }>) || [];
  const seen = new Set<string>();
  const result: Array<{ product_id: string; name: string }> = [];
  for (const it of items) {
    if (!it.product_id || seen.has(it.product_id)) continue;
    seen.add(it.product_id);
    result.push({ product_id: it.product_id, name: it.name_snapshot });
  }
  return result;
}

export async function upsertReview(
  telegramId: number,
  productId: string,
  rating: number,
  comment: string | null,
): Promise<boolean> {
  const s = await db();
  const { error } = await s
    .from("product_reviews")
    .upsert(
      { telegram_id: telegramId, product_id: productId, rating, comment },
      { onConflict: "bot_id,product_id,telegram_id" },
    );
  return !error;
}

/** Дописывает комментарий к уже сохранённой оценке (шаг с звёздами упсертит rating первым). */
export async function updateReviewComment(
  telegramId: number,
  productId: string,
  comment: string,
): Promise<boolean> {
  const s = await db();
  const { error } = await s
    .from("product_reviews")
    .update({ comment })
    .eq("telegram_id", telegramId)
    .eq("product_id", productId);
  return !error;
}
