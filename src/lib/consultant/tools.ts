import {
  getProduct,
  relatedVariants,
  searchProducts,
  type ConsultantProduct,
  type ProductSearchQuery,
} from "./catalog";
import { getStoredVtbRate, priceRub } from "./rate";
import type { ConsultantCountry } from "./intent";

export const CONSULTANT_TOOLS = [
  {
    name: "search_products",
    description:
      "Search the live catalog by free text, category, size or color. Use before answering any stock or price question. Returns at most 8 cards. Empty list means nothing matched — do not invent items.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text product query" },
        category: { type: "string" },
        size: { type: "string" },
        color: { type: "string" },
        max_price_kzt: {
          type: "number",
          description: "Only cards at or below this KZT price. Use when the customer names a budget.",
        },
        exclude_ids: {
          type: "array",
          items: { type: "string" },
          description: "Ids already shown. Use for «ещё варианты» so the same card is not repeated.",
        },
      },
    },
  },
  {
    name: "get_product",
    description:
      "Get one catalog card by id from a previous search. Use for exact price and stock.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_current_rate",
    description:
      "Return the last stored VTB KZ buy rate. Do not compute RUB yourself — cards already include price_rub when the country is RU and a rate exists.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_catalog_link",
    description:
      "Return the shop URL. Call only when they explicitly ask for the website, full catalog or photos — not for «что у вас есть».",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_story_product",
    description: "Returns the product tagged to the Instagram story the user replied to. Requires story_id or attachment_url.",
    input_schema: {
      type: "object",
      properties: {
        story_id: { type: "string" },
        attachment_url: { type: "string" }
      }
    }
  },
    {
      name: "handoff_to_manager",
      description:
        "Call ONLY when the customer explicitly wants to buy, pay, place an order, or talk to a human. Do NOT call this if a product is out of stock or not found - instead, output a normal text message saying it's unavailable.",
      input_schema: {
        type: "object",
      properties: { reason: { type: "string" } },
    },
  },
] as const;

export type ToolFactCard = ConsultantProduct & { price_rub?: number | null };

export function presentCard(
  product: ConsultantProduct,
  country: ConsultantCountry | undefined,
  rate: number | null,
): ToolFactCard {
  return {
    ...product,
    price_rub: country === "RU" && rate ? priceRub(product.price_kzt, rate) : null,
  };
}

export async function executeConsultantTool(
  name: string,
  input: Record<string, unknown>,
  ctx: {
    country?: ConsultantCountry;
    catalog?: ConsultantProduct[];
    shopUrl?: string;
    excludeIds?: string[];
  },
): Promise<{ result: unknown; products: ConsultantProduct[]; handoff: boolean }> {
  const rateRow = await getStoredVtbRate();
  const rate = rateRow?.rate ?? null;

  if (name === "search_products") {
    const q: ProductSearchQuery = {
      query: typeof input.query === "string" ? input.query : undefined,
      category: typeof input.category === "string" ? input.category : undefined,
      size: typeof input.size === "string" ? input.size : undefined,
      color: typeof input.color === "string" ? input.color : undefined,
      max_price_kzt:
        typeof input.max_price_kzt === "number" && input.max_price_kzt > 0
          ? input.max_price_kzt
          : undefined,
    };
    const fromTool = Array.isArray(input.exclude_ids)
      ? input.exclude_ids.filter((id): id is string => typeof id === "string")
      : [];
    const exclude = new Set([...(ctx.excludeIds ?? []), ...fromTool]);
    let found = (await searchProducts(q, ctx.catalog)).filter((p) => !exclude.has(p.id));
    if (found.length === 0 && exclude.size > 0 && ctx.catalog) {
      found = relatedVariants(ctx.catalog, [...exclude]);
    }
    return {
      result: { products: found.map((p) => presentCard(p, ctx.country, rate)) },
      products: found,
      handoff: false,
    };
  }

  if (name === "get_product") {
    const id = typeof input.id === "string" ? input.id : "";
    const product = id ? await getProduct(id, ctx.catalog) : null;
    return {
      result: product ? presentCard(product, ctx.country, rate) : { error: "not_found" },
      products: product ? [product] : [],
      handoff: false,
    };
  }

  if (name === "get_story_product") {
    const { findStoryTagById, findStoryTagByUrl } = await import("./story-tags.functions");
    const tag =
      (typeof input.story_id === "string" && input.story_id ? await findStoryTagById(input.story_id) : null) ||
      (typeof input.attachment_url === "string" && input.attachment_url ? await findStoryTagByUrl(input.attachment_url) : null);
    
    if (tag) {
      // If we have a product_id mapped, we can return the full product.
      if (tag.product_id) {
        const product = await getProduct(tag.product_id, ctx.catalog);
        if (product) {
          return {
            result: presentCard(product, ctx.country, rate),
            products: [product],
            handoff: false,
          };
        }
      }
      // Otherwise return the manually typed metadata
      return {
        result: {
          product_name: tag.product_name,
          price_kzt: tag.product_price_kzt,
          price_rub: tag.product_price_kzt ? priceRub(tag.product_price_kzt, rate || 0) : null,
          notes: tag.notes,
        },
        products: [],
        handoff: false,
      };
    }
    return { result: { error: "not_found", note: "No product is tagged to this story in the admin panel." }, products: [], handoff: false };
  }

  if (name === "get_current_rate") {
    return {
      result: rateRow ?? { rate: null, updatedAt: null, note: "no_rate_stored" },
      products: [],
      handoff: false,
    };
  }

  if (name === "get_catalog_link") {
    const url = ctx.shopUrl || (await import("./catalog")).DEFAULT_SHOP_URL;
    return { result: { url }, products: [], handoff: false };
  }

  if (name === "handoff_to_manager") {
    return {
      result: { paused: true, reason: typeof input.reason === "string" ? input.reason : "handoff" },
      products: [],
      handoff: true,
    };
  }

  return { result: { error: "unknown_tool" }, products: [], handoff: false };
}
