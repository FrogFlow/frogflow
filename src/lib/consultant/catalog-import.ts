import { supabaseAdmin } from "../integrations-supabase/client.server";

export async function importCatalogSnapshot(botId: string, version: string, source: string, url: string, products: any[]) {
  // Save import to database
  const { error } = await supabaseAdmin.from("consultant_catalog_imports").insert({
    bot_id: botId,
    version,
    source,
    source_url: url,
    status: "published",
    product_count: products.length,
    skipped_count: 0,
    errors: []
  });

  if (error) {
    console.error("Failed to insert catalog import record", error);
  }
}
