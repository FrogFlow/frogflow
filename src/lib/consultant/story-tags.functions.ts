import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { extractInstagramMediaInfo } from "@/lib/instagram-media";

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
      /** Список товаров истории. Одиночные поля ниже — старый вызов. */
      products: z
        .array(
          z.object({
            id: z.string().nullable().optional(),
            name: z.string().min(1),
            priceKzt: z.number().nullable().optional(),
          }),
        )
        .optional(),
      productName: z.string().optional(),
      productPriceKzt: z.number().nullable().optional(),
      productId: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data: input }) => {
    const s = await db();
    const info = extractInstagramMediaInfo(input.storyId || input.storyUrl);
    const effectiveStoryId = info.shortcode || input.storyId.trim();
    const effectiveStoryUrl = input.storyUrl?.trim() || info.cleanUrl || null;

    const { dedupe, legacyColumnsOf } = await import("./story-products");
    const products = dedupe(
      (input.products?.length
        ? input.products.map((p) => ({ id: p.id ?? null, name: p.name, price_kzt: p.priceKzt ?? null }))
        : input.productName
          ? [{ id: input.productId ?? null, name: input.productName, price_kzt: input.productPriceKzt ?? null }]
          : []
      ).filter((p) => p.name.trim()),
    );
    const legacy = legacyColumnsOf(products);
    if (!legacy) throw new Error("Выберите хотя бы один товар");

    const base = {
      bot_id: process.env.BOT_ID || null,
      story_id: effectiveStoryId,
      story_url: effectiveStoryUrl,
      thumbnail_url: input.thumbnailUrl ?? null,
      // Первый товар дублируется в старые колонки: на них смотрит уже
      // выложенный код, и product_name объявлен NOT NULL.
      ...legacy,
      notes: input.notes ?? null,
      expires_at: null, // Reels and permanent story tags do not expire
    };

    let { error } = await s
      .from("story_product_tags")
      .upsert({ ...base, products } as never, { onConflict: "story_id" });

    // Колонки products может ещё не быть: MIGRATION-71 применяется руками, а
    // выкладка кода от неё не зависит. Тогда сохраняем первый товар по-старому
    // и говорим об этом в логах, а не роняем сохранение целиком.
    if (error && /products/.test(error.message) && /column|schema cache/i.test(error.message)) {
      console.warn(
        "[upsertStoryTag] колонки products нет — применили MIGRATION-71? " +
          "Сохраняю только первый товар.",
      );
      ({ error } = await s.from("story_product_tags").upsert(base, { onConflict: "story_id" }));
    }
    if (error) {
      console.error("[upsertStoryTag] error:", error);
      throw new Error(error.message);
    }
    return { ok: true, storyId: effectiveStoryId, saved: products.length };
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

/** Comprehensive lookup for a story or reel tag by story_id, shortcode, or URL. */
export async function findStoryTag(storyId?: string | null, storyUrl?: string | null) {
  const s = await db();
  const idCandidate = (storyId ?? "").trim();
  const urlCandidate = (storyUrl ?? "").trim();
  if (!idCandidate && !urlCandidate) return null;

  // 1. Direct match on story_id
  if (idCandidate) {
    const byId = await s.from("story_product_tags").select("*").eq("story_id", idCandidate).maybeSingle();
    if (byId.data) {
      console.log("[findStoryTag] matched by story_id:", idCandidate);
      return byId.data;
    }
  }

  // 2. Direct match on story_url
  if (urlCandidate) {
    const byUrl = await s.from("story_product_tags").select("*").eq("story_url", urlCandidate).maybeSingle();
    if (byUrl.data) {
      console.log("[findStoryTag] matched by exact story_url:", urlCandidate.slice(0, 60));
      return byUrl.data;
    }
  }

  // 3. Shortcode / clean URL matching
  const urlInfo = extractInstagramMediaInfo(urlCandidate || idCandidate);
  if (urlInfo.shortcode) {
    // Check if story_id equals shortcode
    const byShortcode = await s.from("story_product_tags").select("*").eq("story_id", urlInfo.shortcode).maybeSingle();
    if (byShortcode.data) {
      console.log("[findStoryTag] matched by shortcode in story_id:", urlInfo.shortcode);
      return byShortcode.data;
    }

    // Check if cleanUrl matches story_url
    if (urlInfo.cleanUrl) {
      const byCleanUrl = await s.from("story_product_tags").select("*").eq("story_url", urlInfo.cleanUrl).maybeSingle();
      if (byCleanUrl.data) {
        console.log("[findStoryTag] matched by cleanUrl:", urlInfo.cleanUrl);
        return byCleanUrl.data;
      }
    }

    // Check ilike on story_url or story_id
    const byIlikeUrl = await s.from("story_product_tags").select("*").ilike("story_url", `%${urlInfo.shortcode}%`).maybeSingle();
    if (byIlikeUrl.data) {
      console.log("[findStoryTag] matched by ilike story_url:", urlInfo.shortcode);
      return byIlikeUrl.data;
    }

    const byIlikeId = await s.from("story_product_tags").select("*").ilike("story_id", `%${urlInfo.shortcode}%`).maybeSingle();
    if (byIlikeId.data) {
      console.log("[findStoryTag] matched by ilike story_id:", urlInfo.shortcode);
      return byIlikeId.data;
    }
  }

  // 4. Match URL without query string
  if (urlCandidate && urlCandidate.includes("?")) {
    const noQuery = urlCandidate.split("?")[0];
    const byNoQuery = await s.from("story_product_tags").select("*").ilike("story_url", `%${noQuery}%`).maybeSingle();
    if (byNoQuery.data) {
      console.log("[findStoryTag] matched by url without query:", noQuery.slice(0, 60));
      return byNoQuery.data;
    }
  }

  // 5. Filename / path end match (for CDN images/videos)
  if (urlCandidate) {
    try {
      const parsed = new URL(urlCandidate);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const filename = parts[parts.length - 1];
      if (filename && filename.length > 5) {
        const byFilename = await s.from("story_product_tags").select("*").ilike("story_url", `%${filename}%`).maybeSingle();
        if (byFilename.data) {
          console.log("[findStoryTag] matched by filename:", filename);
          return byFilename.data;
        }
      }
    } catch {
      // not a standard URL
    }
  }

  // 6. Match numeric digits inside URL against story_id or story_url
  const digits = `${idCandidate} ${urlCandidate}`.match(/\d{10,25}/g);
  if (digits && digits.length > 0) {
    for (const d of digits) {
      const byDigitId = await s.from("story_product_tags").select("*").eq("story_id", d).maybeSingle();
      if (byDigitId.data) {
        console.log("[findStoryTag] matched by digit ID:", d);
        return byDigitId.data;
      }
      const byDigitUrl = await s.from("story_product_tags").select("*").ilike("story_url", `%${d}%`).maybeSingle();
      if (byDigitUrl.data) {
        console.log("[findStoryTag] matched by digit in story_url:", d);
        return byDigitUrl.data;
      }
    }
  }

  // Не нашли — значит не нашли. Здесь была подстановка последней отмеченной
  // публикации «на всякий случай»: 24.09 на фото полотенец от двух покупателей
  // бот выдал коврики Kleen-Tex, отмеченные тем утром, а до того на всё
  // подряд отвечал комплектом PECAN. Без привязки модель спрашивает, какой
  // товар понравился, — это честнее чужого списка.
  return null;
}

/** Find a story tag by story_id (used by the bot at runtime). */
export async function findStoryTagById(storyId: string) {
  return findStoryTag(storyId, null);
}

/** Find a story tag by matching the attachment URL (fallback when story_id is unavailable). */
export async function findStoryTagByUrl(url: string) {
  return findStoryTag(null, url);
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
