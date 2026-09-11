import {
  consultantApiKey,
  consultantModel,
  CONSULTANT_AI_TIMEOUT_MS,
  CONSULTANT_MAX_TOOL_ROUNDS,
} from "./config";
import { CONSULTANT_TOOLS, executeConsultantTool } from "./tools";
import type { ConsultantProduct } from "./catalog";
import type { ConsultantCountry } from "./intent";
import type { ConsultantState } from "./state";
import { extractAnthropicUsage, type SmartSearchTokenUsage } from "@/lib/smart-search-cost";
import { logger } from "@/lib/logger.server";

export const CONSULTANT_SYSTEM_PROMPT = `ROLE
You are the AI customer consultant for a shop in Instagram Direct.

CORE RULE
Never invent product, stock, price, delivery or currency information. Use backend tools for factual data. If a tool returns an empty list or not_found, say the item is unavailable — do not guess.

STYLE
Be concise, factual and businesslike. Do not use emotional sales clichés. Forbidden phrases: «отлично», «передаю менеджеру», «наверное», «примерно», «скорее всего».

COUNTRY
Kazakhstan — prices in ₸ from the card. Russia — use price_rub from the tool result if present; mention СДЭК, buyer pays, do not calculate shipping. If country is unknown, ask Kazakhstan or Russia first.

CATALOG
Do not list the whole assortment. If they ask for the full catalog, give the shop URL from the user context only if provided. Offer a relevant cross-sell only as a question, without inventing extra items.

HUMAN HANDOFF
When the customer confirms a purchase, asks to pay, or asks for a manager, call handoff_to_manager. After handoff, do not continue the sale.

SHIPPING
For Russia mention СДЭК and that the buyer pays. Never quote a shipping price, estimate, or «примерно».

COLORS
Mention only colors returned by tools. If the requested color is missing, say it is unavailable.

PAUSE
If automation is paused, produce no customer-facing answer.`;

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

type AnthropicMessage = {
  content?: AnthropicContent[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
};

export type ClaudeTurnResult = {
  text: string;
  products: ConsultantProduct[];
  extraNumbers: number[];
  handoff: boolean;
  usage: SmartSearchTokenUsage | null;
  error?: string;
};

export async function runConsultantClaude(params: {
  text: string;
  state: ConsultantState;
  catalog?: ConsultantProduct[];
  shopUrl?: string;
  forceTools?: boolean;
}): Promise<ClaudeTurnResult> {
  const apiKey = consultantApiKey();
  if (!apiKey) {
    return {
      text: "",
      products: [],
      extraNumbers: [],
      handoff: false,
      usage: null,
      error: "no_api_key",
    };
  }

  const country: ConsultantCountry | undefined = params.state.country;
  const recent = (params.state.recent ?? []).map((t) => `${t.role}: ${t.text}`).join("\n");
  const dynamic =
    `STATE country=${country ?? "unknown"} paused=${params.state.automation_paused === true}` +
    (params.shopUrl ? ` shop_url=${params.shopUrl}` : "") +
    (recent ? `\nRECENT\n${recent}` : "") +
    `\nCUSTOMER: ${params.text}`;

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    { role: "user", content: dynamic },
  ];

  const products: ConsultantProduct[] = [];
  const extraNumbers: number[] = [];
  let handoff = false;
  let usage: SmartSearchTokenUsage | null = null;
  let lastText = "";

  for (let round = 0; round < CONSULTANT_MAX_TOOL_ROUNDS; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: consultantModel(),
        max_tokens: 600,
        system: [
          {
            type: "text",
            text: CONSULTANT_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: CONSULTANT_TOOLS,
        messages,
        ...(params.forceTools && round === 0 ? { tool_choice: { type: "any" } } : {}),
      }),
      signal: AbortSignal.timeout(CONSULTANT_AI_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("consultant.claude_http", { status: res.status, body: body.slice(0, 180) });
      return {
        text: "",
        products,
        extraNumbers,
        handoff: true,
        usage,
        error: `anthropic_${res.status}:${body.slice(0, 180)}`,
      };
    }

    const json = (await res.json()) as AnthropicMessage;
    const roundUsage = extractAnthropicUsage(json);
    if (roundUsage) {
      usage = usage
        ? {
            inputTokens: usage.inputTokens + roundUsage.inputTokens,
            outputTokens: usage.outputTokens + roundUsage.outputTokens,
          }
        : roundUsage;
    }

    const content = json.content ?? [];
    messages.push({ role: "assistant", content });

    const toolUses = content.filter(
      (b): b is Extract<AnthropicContent, { type: "tool_use" }> => b.type === "tool_use",
    );
    const texts = content.filter(
      (b): b is Extract<AnthropicContent, { type: "text" }> => b.type === "text",
    );
    if (texts.length)
      lastText = texts
        .map((t) => t.text)
        .join("\n")
        .trim();

    if (toolUses.length === 0) {
      logger.info("consultant.claude_usage", {
        model: consultantModel(),
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        rounds: round + 1,
        handoff,
      });
      return { text: lastText, products, extraNumbers, handoff, usage };
    }

    const toolResults: unknown[] = [];
    for (const call of toolUses) {
      const executed = await executeConsultantTool(call.name, call.input ?? {}, {
        country,
        catalog: params.catalog,
      });
      products.push(...executed.products);
      if (executed.handoff) handoff = true;
      const rate = (executed.result as { rate?: number } | null)?.rate;
      if (typeof rate === "number" && rate > 0) extraNumbers.push(rate);
      for (const p of executed.products) extraNumbers.push(p.price_kzt);
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(executed.result),
      });
    }
    messages.push({ role: "user", content: toolResults });
    if (handoff) {
      return { text: lastText, products, extraNumbers, handoff, usage };
    }
  }

  return { text: lastText, products, extraNumbers, handoff, usage, error: "max_rounds" };
}
