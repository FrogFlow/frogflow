import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function db() {
  const { supabaseService } = await import("@/integrations-supabase/client.server");
  return supabaseService;
}

/** List all story product tags (admin panel). */
export const listStoryTagsFn = createServerFn({ method: "GET" }).handler(async () => {
  const s = await db();
  const { data, error } = await s
    .from("story_product_tags")
    .select("*")
    .or(process.env.BOT_ID ? `bot_id.eq.${process.env.BOT_ID},bot_id.is.null` : 'bot_id.is.null')
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
});

/** Upsert a story product tag. */
export const upsertStoryTagFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      storyId: z.string().min(1),
      storyUrl: z.string().nullable().optional(),
      thumbnailUrl: z.string().nullable().optional(),
      productName: z.string().min(1),
      productPriceKzt: z.number().nullable().optional(),
      productId: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data: input }) => {
    const s = await db();
    const expiresAt = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(); // 25h
    const { error } = await s.from("story_product_tags").upsert(
      {
        bot_id: process.env.BOT_ID || null,
        story_id: input.storyId,
        story_url: input.storyUrl ?? null,
        thumbnail_url: input.thumbnailUrl ?? null,
        product_name: input.productName,
        product_price_kzt: input.productPriceKzt ?? null,
        product_id: input.productId ?? null,
        notes: input.notes ?? null,
        expires_at: expiresAt,
      },
      { onConflict: "story_id" },
    );
    if (error) {
      console.error("[upsertStoryTag] error:", error);
      throw new Error(error.message);
    }
    return { ok: true };
  });

/** Delete a story product tag by id. */
export const deleteStoryTagFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: input }) => {
    const s = await db();
    const { error } = await s.from("story_product_tags").delete().eq("id", input.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Find a story tag by story_id (used by the bot at runtime). */
export async function findStoryTagById(storyId: string) {
  const s = await db();
  const { data, error } = await s
    .from("story_product_tags")
    .select("*")
    .eq("story_id", storyId)
    .maybeSingle();
  console.log("[findStoryTagById]", { storyId, found: !!data, error: error?.message });
  return data ?? null;
}

/** Find a story tag by matching the attachment URL (fallback when story_id is unavailable). */
export async function findStoryTagByUrl(url: string) {
  if (!url) return null;
  const s = await db();
  
  // Attempt exact match first
  let result = await s.from("story_product_tags").select("*").eq("story_url", url).maybeSingle();
  if (result.data) {
    console.log("[findStoryTagByUrl] exact match found for", url.slice(0, 80));
    return result.data;
  }

  // Fallback: extract the filename from the URL (without query parameters) and match using ilike
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/");
    const filename = parts[parts.length - 1];
    if (filename && filename.length > 5) {
      result = await s.from("story_product_tags").select("*").ilike("story_url", `%${filename}%`).maybeSingle();
      if (result.data) {
        console.log("[findStoryTagByUrl] filename match found for", filename);
        return result.data;
      }
    }
    console.log("[findStoryTagByUrl] no match", { url: url.slice(0, 80), filename });
  } catch (e) {
    console.error("[findStoryTagByUrl] URL parse error", e);
  }
  
  // Last resort: list ALL story tags and log them for debugging
  try {
    const { data: allTags } = await s.from("story_product_tags").select("story_id, story_url, product_name").limit(10);
    console.log("[findStoryTagByUrl] all tags in DB:", JSON.stringify(allTags?.map(t => ({
      id: t.story_id,
      url: t.story_url?.slice(0, 60),
      name: t.product_name,
    }))));
  } catch { /* ignore */ }

  return null;
}

export const getStoriesFn = createServerFn({ method: "GET" })
  .validator(z.object({ accountId: z.string().min(1) }))
  .handler(async ({ data: input }) => {
    const { listZernioStories } = await import("@/lib/zernio.server");
    return await listZernioStories(input.accountId);
  });

export const getConsultantCatalogFn = createServerFn({ method: "GET" }).handler(async () => {
  const { loadConsultantCatalog } = await import("@/lib/consultant/catalog");
  return await loadConsultantCatalog();
});
