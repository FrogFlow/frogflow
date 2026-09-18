import {
  enrichProductColors,
  extractHardness,
  getProduct,
  priceFloorInScope,
  relatedVariants,
  searchProductsDetailed,
  type ConsultantProduct,
  type ProductHardness,
  type ProductSearchQuery,
} from "./catalog";
import { getStoredVtbRate, priceRub } from "./rate";
import type { ConsultantCountry } from "./intent";

export const CONSULTANT_TOOLS = [
  {
    name: "search_products",
    description:
      "Search the live catalog by free text, category, size, firmness or color. Use before answering any stock or price question. Empty list means nothing matched — do not invent items and do not offer a different category instead. The result reports total_matches: when it is larger than the number of returned cards, say the total out loud and offer to narrow the choice. A broad request (only a brand or a category, no size and no color) comes back as a summary with ask_size_and_color: then do NOT list items — confirm in one or two lines that they are in stock, say what the brand is known for, and ask which size and color the customer needs.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text product query" },
        category: {
          type: "string",
          description:
            "Always pass it when the customer names a category (towels, bedding, mattress…). Without it a color or size search returns other categories too.",
        },
        size: {
          type: "string",
          description:
            "Size as the customer said it, e.g. 180x200. Sizes within 3 cm per side match as well — the factory makes 182x202 as the 180x200 equivalent.",
        },
        color: { type: "string" },
        hardness: {
          type: "string",
          enum: ["soft", "medium", "firm"],
          description:
            "Mattress or topper firmness. Pass it whenever the customer names one (soft/medium/firm, мягкий/средний/жёсткий). A different firmness is a different product, never a substitute. MEDIUM mattresses are discontinued and no longer sold: still pass hardness: \"medium\" when the customer asks for one — the empty result comes back with medium_mattresses_discontinued so you can say it plainly.",
        },
        max_price_kzt: {
          type: "number",
          description:
            "Only cards at or below this KZT price. Use when the customer names a budget, and ALWAYS pass category too when they named one — a bare price sweep returns every category and will hand you a pillow when they asked about blankets. The result carries cheapest_ignoring_price_limit: the cheapest card in the same scope with the price cap removed. When the list comes back empty or off-target, say plainly that nothing fits the budget and name that cheapest card instead of padding the answer.",
        },
        exclude_ids: {
          type: "array",
          items: { type: "string" },
          description: "Ids already shown. Use for «ещё варианты» so the same card is not repeated.",
        },
        show_all: {
          type: "boolean",
          description:
            "Pass true only when the customer explicitly asks to see everything («покажите все», «весь список», «какие есть варианты» after you already offered to narrow). It turns off the summary and returns every matching card.",
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
    name: "ask_manager",
    description:
      "Use when the customer asks something neither the catalog nor the knowledge base answers: a comparison between models, a material detail that is not in the card, a promise about dates. It files the question for a human manager and does NOT pause the chat. After calling it, say you will check with the manager and come back with the answer, then ask whether there is anything else you can help with right now. Never invent an answer instead, and never go silent.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The customer question, close to verbatim, so the manager can answer it.",
        },
      },
      required: ["question"],
    },
  },
    {
      name: "handoff_to_manager",
      description:
        "Call ONLY when the customer explicitly wants to buy, pay, place an order, or talk to a human. Do NOT call this if the customer is merely selecting colors, sizes, or asking questions. Do NOT call this if a product is out of stock or not found - instead, output a normal text message saying it's unavailable.",
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Reason for handoff (e.g. purchase, talk_to_human)" },
          customer_phone: { type: "string", description: "Customer phone number ONLY IF explicitly provided by the user in chat. NEVER invent or guess a number." },
          delivery_city: { type: "string", description: "Customer delivery city if provided by the user" },
          order_summary: { type: "string", description: "Summary of products, sizes, colors, and total price" },
        },
      },
    },
] as const;

/**
 * С какого числа совпадений широкий запрос превращается в сводку. Три-четыре
 * позиции покупателю проще увидеть сразу, чем отвечать на уточняющий вопрос.
 */
const BROAD_SUMMARY_FROM = 4;

/** Уникальные непустые значения, не больше двенадцати — это выбор, а не список. */
function distinct(values: string[], limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

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

function readHardness(value: unknown): ProductHardness | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "soft" || v === "medium" || v === "firm") return v;
  // Модель разговаривает с покупателем словами «комфортный» и «упругий» и
  // может передать их сюда вместо кода жёсткости — разбираем, а не теряем
  // фильтр молча.
  return extractHardness(v) ?? undefined;
}

export async function executeConsultantTool(
  name: string,
  input: Record<string, unknown>,
  ctx: {
    country?: ConsultantCountry;
    catalog?: ConsultantProduct[];
    shopUrl?: string;
    excludeIds?: string[];
    userKey?: string;
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
      hardness: readHardness(input.hardness),
      max_price_kzt:
        typeof input.max_price_kzt === "number" && input.max_price_kzt > 0
          ? input.max_price_kzt
          : undefined,
    };
    const fromTool = Array.isArray(input.exclude_ids)
      ? input.exclude_ids.filter((id): id is string => typeof id === "string")
      : [];
    const exclude = new Set(fromTool);
    const { all, shown } = await searchProductsDetailed(q, ctx.catalog);
    // Когда задан потолок цены, к выдаче прикладывается ценовое дно того же
    // среза без этого потолка. Иначе ответ про бюджет строится на догадке:
    // на «одеяло за 100 000 ₸» бот выдал подушку за 30 000 и назвал
    // 100–150 тысяч «узким сегментом», хотя одеял дешевле 170 000 нет вовсе.
    const floor =
      q.max_price_kzt && ctx.catalog ? priceFloorInScope(q, ctx.catalog) : null;
    let found = shown.filter((p) => !exclude.has(p.id));
    const totalMatches = all.filter((p) => !exclude.has(p.id)).length;
    if (found.length === 0 && exclude.size > 0 && ctx.catalog) {
      found = relatedVariants(ctx.catalog, [...exclude]);
    }
    const enriched = ctx.catalog
      ? found.map((p) => enrichProductColors(p, ctx.catalog!))
      : found;

    /**
     * Широкий запрос — сводка вместо списка.
     *
     * Продавец: «когда я спрашиваю о товаре, он сразу выдаёт все виды товара
     * какие есть — неправильно. Надо сказать, что у нас есть в наличии
     * полотенца Feiler, две строчки о качестве и компании, потом спросить,
     * какой размер и цвет интересует».
     *
     * Правилом в промпте это не держится: пока модель видит сорок карточек,
     * она их перечисляет. Поэтому на запрос без размера, цвета, жёсткости и
     * бюджета карточки не отдаются вовсе — только чем выбирать дальше.
     * Требование «перечислять все позиции, а не первые три» остаётся в силе
     * для запросов с фильтром и для прямого «покажите все» (show_all).
     */
    const narrowed = Boolean(q.size || q.color || q.hardness || q.max_price_kzt);
    const showAll = input.show_all === true;
    if (!narrowed && !showAll && totalMatches > BROAD_SUMMARY_FROM) {
      const matched = all.filter((p) => !exclude.has(p.id));
      const prices = matched.map((p) => p.price_kzt).filter((n) => n > 0);
      const from = Math.min(...prices);
      const to = Math.max(...prices);
      return {
        result: {
          in_stock: true,
          total_matches: totalMatches,
          // Списка карточек здесь нет намеренно — перечислять нечего.
          products: [],
          returned: 0,
          ask_size_and_color: true,
          sizes: distinct(matched.map((p) => p.size)),
          colors: distinct(matched.flatMap((p) => p.colors)),
          price_kzt: prices.length ? { from, to } : null,
          price_rub:
            prices.length && ctx.country === "RU" && rate
              ? { from: priceRub(from, rate), to: priceRub(to, rate) }
              : null,
        },
        // Карточки модель не видит, но знать о них должна проверка ответа:
        // иначе названная вилка цен читается как выдуманное число.
        products: matched.slice(0, 60),
        handoff: false,
      };
    }

    return {
      result: {
        products: enriched.map((p) => presentCard(p, ctx.country, rate)),
        returned: enriched.length,
        ...(floor
          ? {
              cheapest_ignoring_price_limit: {
                name: floor.cheapest.name,
                price_kzt: floor.cheapest.price_kzt,
                total_in_scope: floor.count,
              },
            }
          : {}),
        // Сколько позиций подошло всего. Без этого числа ответ не отличает
        // «нашлось три» от «показали три из восьми» — ровно та выборочная
        // выдача, на которую пожаловался продавец.
        total_matches: Math.max(totalMatches, enriched.length),
        // Матрасы средней жёсткости сняты с производства и вычищены из
        // каталога. Пустая выдача сама по себе значит «не нашёл» — модель
        // тогда додумывает причину. Здесь причина названа фактом, а не
        // правилом в промпте, которое можно не заметить.
        ...(q.hardness === "medium" ? { medium_mattresses_discontinued: true } : {}),
      },
      products: enriched,
      handoff: false,
    };
  }

  if (name === "get_product") {
    const id = typeof input.id === "string" ? input.id : "";
    const product = id ? await getProduct(id, ctx.catalog) : null;
    const enriched = product && ctx.catalog ? enrichProductColors(product, ctx.catalog) : product;
    return {
      result: enriched ? presentCard(enriched, ctx.country, rate) : { error: "not_found" },
      products: enriched ? [enriched] : [],
      handoff: false,
    };
  }

  if (name === "get_story_product") {
    const { findStoryTag } = await import("./story-tags.functions");
    const tag = await findStoryTag(
      typeof input.story_id === "string" ? input.story_id : null,
      typeof input.attachment_url === "string" ? input.attachment_url : null,
    );
    
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
      // Otherwise return the manually typed metadata with a synthetic product card so validation passes
      const syntheticProduct: ConsultantProduct = {
        id: tag.product_id || `story_${tag.story_id}`,
        name: tag.product_name,
        category: "story",
        size: "",
        colors: [],
        price_kzt: tag.product_price_kzt || 0,
        stock: true,
      };
      return {
        result: {
          product_name: tag.product_name,
          price_kzt: tag.product_price_kzt,
          price_rub: tag.product_price_kzt ? priceRub(tag.product_price_kzt, rate || 0) : null,
          notes: tag.notes,
        },
        products: [syntheticProduct],
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

  if (name === "ask_manager") {
    const question = typeof input.question === "string" ? input.question.trim() : "";
    if (question) {
      const { addConsultantTask } = await import("./tasks");
      await addConsultantTask({
        userKey: ctx.userKey || "unknown",
        reason: "question",
        text: question,
      }).catch((err: unknown) => {
        // Вопрос не записался — это повод показать ошибку в логах, но не
        // повод замолчать в диалоге: клиенту всё равно отвечаем честно.
        console.warn("[consultant] ask_manager: не удалось записать вопрос", err);
      });
    }
    return { result: { queued: Boolean(question) }, products: [], handoff: false };
  }

  if (name === "handoff_to_manager") {
    return {
      result: {
        paused: true,
        reason: typeof input.reason === "string" ? input.reason : "handoff",
        customer_phone: typeof input.customer_phone === "string" ? input.customer_phone : undefined,
        delivery_city: typeof input.delivery_city === "string" ? input.delivery_city : undefined,
        order_summary: typeof input.order_summary === "string" ? input.order_summary : undefined,
      },
      products: [],
      handoff: true,
    };
  }

  return { result: { error: "unknown_tool" }, products: [], handoff: false };
}
