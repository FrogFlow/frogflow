import { searchProducts, getProduct, listCategories, getCatalogLink, getDeliveryInfo } from "./catalog";
import { getActiveVtbRate, calculateRubPrice } from "./rate";

export const CONSULTANT_TOOLS = [
  {
    name: "search_products",
    description: "Searches the current catalog for products by name, category, size, or color. Exclude previously shown IDs if the customer asks for alternatives.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: { type: "string" },
        size: { type: "string" },
        color: { type: "string" },
        exclude_ids: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "get_product",
    description: "Returns the exact product card with actual stock and price information by ID.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The product ID" }
      },
      required: ["id"]
    }
  },
  {
    name: "list_categories",
    description: "Lists all available product categories.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_catalog_link",
    description: "Gets the public link to the complete website catalog for customers asking to browse.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_delivery_info",
    description: "Gets standard delivery information (e.g. CDEK delivery conditions for RU).",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_current_rate",
    description: "Gets the current KZT to RUB exchange rate. Important for Russian buyers.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "handoff_to_manager",
    description: "Signals that the user wants to talk to a human manager, or wants to proceed to purchase. Also used when a product is explicitly out of stock and you need to tell them a manager will offer alternatives. This pauses AI responses.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", enum: ["purchase", "out_of_stock", "manager_request", "other"] }
      },
      required: ["reason"]
    }
  }
];

export async function executeConsultantTool(botId: string, name: string, input: any) {
  try {
    switch (name) {
      case "search_products":
        return await searchProducts(botId, input.query, input.category, input.size, input.color, input.exclude_ids);
      case "get_product":
        return await getProduct(botId, input.id);
      case "list_categories":
        return await listCategories(botId);
      case "get_catalog_link":
        return await getCatalogLink();
      case "get_delivery_info":
        return await getDeliveryInfo();
      case "get_current_rate":
        return await getActiveVtbRate(botId);
      case "handoff_to_manager":
        return { success: true, reason: input.reason };
      default:
        return { error: "Unknown tool" };
    }
  } catch (err) {
    console.error("Tool execution error:", err);
    return { error: String(err) };
  }
}
