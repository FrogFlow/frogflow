import { imageUrl } from "@/lib/public-image";
import { MINI_APP_PRODUCT_SELECT, type MiniAppProduct } from "./mini-app-catalog.server";
import { availableMaterialLanguages, MATERIAL_LANG_SHORT } from "./product-materials";

export type MiniAppLibraryItem = {
  productId: string;
  name: string;
  image: string | null;
  languages: string[];
  lastOrderId: number;
};

type LibraryOrderRow = {
  id: number;
  fulfillment_kind: string | null;
  order_items: Array<{ product_id: string | null; name_snapshot: string | null }> | null;
};

export async function listMiniAppLibrary(telegramId: number): Promise<MiniAppLibraryItem[]> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id, created_at, fulfillment_kind, order_items(product_id, name_snapshot)")
    .eq("telegram_id", telegramId)
    .eq("status", "delivered")
    .order("created_at", { ascending: false })
    .limit(80);
  const byProduct = new Map<string, MiniAppLibraryItem>();
  for (const order of (orders ?? []) as LibraryOrderRow[]) {
    if (order.fulfillment_kind === "physical") continue;
    for (const item of order.order_items ?? []) {
      if (!item.product_id || byProduct.has(item.product_id)) continue;
      byProduct.set(item.product_id, {
        productId: item.product_id,
        name: item.name_snapshot || "",
        image: null,
        languages: [],
        lastOrderId: order.id,
      });
    }
  }
  const ids = [...byProduct.keys()];
  if (!ids.length) return [];

  const { data: productRows } = await supabaseAdmin
    .from("products")
    .select(MINI_APP_PRODUCT_SELECT)
    .in("id", ids);
  for (const product of (productRows ?? []) as MiniAppProduct[]) {
    const row = byProduct.get(product.id);
    if (!row) continue;
    const images = (product.product_images ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order);
    row.name = product.name || row.name;
    row.image = images[0] ? imageUrl(images[0].image_path) : null;
    row.languages = availableMaterialLanguages(product).map((lang) => MATERIAL_LANG_SHORT[lang]);
  }
  return ids
    .map((id) => byProduct.get(id))
    .filter((row): row is MiniAppLibraryItem => Boolean(row));
}
