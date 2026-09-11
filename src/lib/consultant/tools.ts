import {
  getProduct,
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
    name: "handoff_to_manager",
    description:
      "Call when the customer wants to buy, pay, or talk to a manager, or when you cannot answer from tools. After this, automation pauses.",
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
  ctx: { country?: ConsultantCountry; catalog?: ConsultantProduct[] },
): Promise<{ result: unknown; products: ConsultantProduct[]; handoff: boolean }> {
  const rateRow = await getStoredVtbRate();
  const rate = rateRow?.rate ?? null;

  if (name === "search_products") {
    const q: ProductSearchQuery = {
      query: typeof input.query === "string" ? input.query : undefined,
      category: typeof input.category === "string" ? input.category : undefined,
      size: typeof input.size === "string" ? input.size : undefined,
      color: typeof input.color === "string" ? input.color : undefined,
    };
    const found = await searchProducts(q, ctx.catalog);
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

  if (name === "get_current_rate") {
    return {
      result: rateRow ?? { rate: null, updatedAt: null, note: "no_rate_stored" },
      products: [],
      handoff: false,
    };
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
