import { supabaseAdmin } from "../integrations-supabase/client.server";

export interface NormalizedProduct {
  id: string;
  name: string;
  category: string;
  size?: string;
  colors: string[];
  price_kzt: number;
  stock: boolean;
  stock_qty?: number;
}

export async function searchProducts(botId: string, query: string, category?: string, size?: string, color?: string, excludeIds?: string[]): Promise<NormalizedProduct[]> {
  // Query existing products table. In the BOVI architecture, we need to map the backend product to the NormalizedProduct.
  let q = supabaseAdmin.from("products").select("id, name, price, stock_quantity, is_active, category_id, attributes").eq("bot_id", botId).eq("is_active", true);
  
  if (excludeIds && excludeIds.length > 0) {
    q = q.not("id", "in", `(${excludeIds.join(",")})`);
  }
  
  // Basic query logic
  const { data, error } = await q;
  if (error || !data) return [];
  
  // Filter manually for simplicity or use db search features
  let results = data;
  
  if (query) {
    const ql = query.toLowerCase();
    results = results.filter(p => p.name.toLowerCase().includes(ql));
  }
  
  // Normalize
  return results.map(p => {
    const attrs = p.attributes as Record<string, any> || {};
    return {
      id: p.id,
      name: p.name,
      category: category || "unknown", // Ideal to lookup category name
      size: attrs.size,
      colors: attrs.colors || (attrs.color ? [attrs.color] : []),
      price_kzt: Number(p.price) || 0,
      stock: (p.stock_quantity ?? 1) > 0,
      stock_qty: p.stock_quantity ?? 0
    };
  }).slice(0, 10);
}

export async function getProduct(botId: string, id: string): Promise<NormalizedProduct | null> {
  const { data, error } = await supabaseAdmin.from("products").select("id, name, price, stock_quantity, is_active, attributes").eq("bot_id", botId).eq("id", id).single();
  if (error || !data) return null;
  
  const attrs = data.attributes as Record<string, any> || {};
  return {
    id: data.id,
    name: data.name,
    category: "unknown",
    size: attrs.size,
    colors: attrs.colors || (attrs.color ? [attrs.color] : []),
    price_kzt: Number(data.price) || 0,
    stock: (data.stock_quantity ?? 1) > 0,
    stock_qty: data.stock_quantity ?? 0
  };
}

export async function listCategories(botId: string): Promise<string[]> {
  // Mock logic - should query categories table
  return ["постельное бельё", "полотенца", "матрасы", "одеяла", "подушки", "посуда"];
}

export async function getCatalogLink(): Promise<string> {
  return "https://bovi.kz";
}

export async function getDeliveryInfo(): Promise<string> {
  return "Доставка осуществляется курьерской службой СДЭК и оплачивается покупателем при получении по тарифам СДЭК.";
}
