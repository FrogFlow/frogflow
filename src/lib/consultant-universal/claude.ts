declare const process: any;
import { buildUniversalPrompt } from "./engine";
import type { UniversalBusinessProfile } from "./profile";
import type { KnowledgeDocument } from "./knowledge";
import { logger } from "@/lib/logger.server";

export const DEFAULT_UNIVERSAL_MODEL = "claude-haiku-4-5-20251001";
export const UNIVERSAL_AI_TIMEOUT_MS = 15_000;

export function universalConsultantModel(): string {
  return process.env.CONSULTANT_MODEL?.trim() || DEFAULT_UNIVERSAL_MODEL;
}

export function universalConsultantApiKey(): string {
  return process.env.ANTHROPIC_API_KEY?.trim() || "";
}

export const UNIVERSAL_CONSULTANT_TOOLS = [
  {
    name: "handoff_to_manager",
    description:
      "Передать диалог живому менеджеру или зафиксировать обращение, если клиент просит человека, задаёт сложный вопрос вне регламента или готов завершить сделку.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: ["purchase", "book_call", "booking", "human_requested", "custom_inquiry"],
          description: "Причина передачи диалога",
        },
        customer_name: { type: "string", description: "Имя клиента, если известно" },
        customer_contact: { type: "string", description: "Телефон, WhatsApp или Instagram клиента" },
        summary: { type: "string", description: "Краткая суть запроса и договоренностей" },
      },
      required: ["reason", "summary"],
    },
  },
  {
    name: "record_order_lead",
    description: "Зафиксировать оформление заказа, бронь или запись на услугу со всеми параметрами.",
    input_schema: {
      type: "object",
      properties: {
        lead_type: { type: "string", enum: ["order", "call", "booking"] },
        customer_name: { type: "string" },
        customer_contact: { type: "string" },
        details: { type: "string", description: "Товары, повод, дата доставки или удобное время" },
      },
      required: ["lead_type", "details"],
    },
  },
];

export type UniversalTurn = { role: "customer" | "assistant"; text: string };

export type UniversalClaudeResult = {
  text: string;
  handoff: boolean;
  handoffData?: {
    reason: string;
    customer_name?: string;
    customer_contact?: string;
    summary: string;
    details?: string;
  };
  toolUsed?: string;
};

/**
 * Очистка от звёздочек (Instagram Direct не поддерживает Markdown)
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/_(.*?)_/g, "$1");
}

/**
 * Очистка от галлюцинаций сценариев («клиент: ... консультант: ...»)
 */
export function cleanScriptDialogues(text: string): string {
  const lines = text.split("\n");
  const filtered: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /^(клиент|покупатель|customer|user|client):/i.test(trimmed) ||
      /^(ассистент|консультант|assistant|bot):/i.test(trimmed)
    ) {
      continue;
    }
    filtered.push(line);
  }
  return filtered.join("\n").trim();
}

/**
 * Вызов Claude для Универсального Консультанта
 */
export async function runUniversalConsultantClaude(params: {
  profile: UniversalBusinessProfile;
  text: string;
  recentHistory?: UniversalTurn[];
  knowledgeDocs?: KnowledgeDocument[];
  catalogSnippet?: string;
  sessionContext?: string;
}): Promise<UniversalClaudeResult> {
  const apiKey = universalConsultantApiKey();
  const docs = params.knowledgeDocs ?? [];
  const systemPrompt = buildUniversalPrompt(params.profile, docs, params.catalogSnippet);

  // Если ключ не задан (тестовая среда или локальный мок)
  if (!apiKey) {
    logger.warn("universal_consultant.no_api_key_mocking_reply");
    const fallbackSnippet = docs.length > 0 ? docs[0].content.slice(0, 150) : "";
    return {
      text: stripMarkdown(
        `Здравствуйте! Мы с радостью вам поможем. ${fallbackSnippet ? `По вашему запросу: ${fallbackSnippet}...` : ""}`,
      ),
      handoff: false,
    };
  }

  const messages: Array<{ role: "user" | "assistant"; content: any }> = [];
  for (const turn of params.recentHistory || []) {
    messages.push({
      role: turn.role === "customer" ? "user" : "assistant",
      content: turn.text,
    });
  }
  messages.push({
    role: "user",
    content: params.text,
  });

  const systemBlocks: any[] = [
    {
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (params.sessionContext) {
    systemBlocks.push({
      type: "text",
      text: `ДАННЫЕ ТЕКУЩЕГО ДИАЛОГА:\n${params.sessionContext}`,
    });
  }

  let handoff = false;
  let handoffData: UniversalClaudeResult["handoffData"] = undefined;
  let toolUsed: string | undefined = undefined;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: universalConsultantModel(),
        max_tokens: 600,
        system: systemBlocks,
        stop_sequences: [
          "\ncustomer:",
          "\nCustomer:",
          "\nклиент:",
          "\nКлиент:",
          "\nuser:",
          "\nUser:",
        ],
        tools: UNIVERSAL_CONSULTANT_TOOLS.map((t, i) =>
          i === 0 ? { ...t, cache_control: { type: "ephemeral" } } : t,
        ),
        messages,
      }),
      signal: AbortSignal.timeout(UNIVERSAL_AI_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errBody = await res.text();
      logger.error("universal_consultant.claude_http_error", { status: res.status, body: errBody });
      return {
        text: "Спасибо за обращение! Наш специалист уже подключается к переписке и ответит в течение нескольких минут.",
        handoff: true,
        handoffData: {
          reason: "custom_inquiry",
          summary: `Клиент написал: "${params.text.slice(0, 100)}"`,
        },
      };
    }

    const data: any = await res.json();
    let replyText = "";

    for (const block of data.content || []) {
      if (block.type === "text") {
        replyText += block.text;
      } else if (block.type === "tool_use") {
        toolUsed = block.name;
        if (block.name === "handoff_to_manager") {
          handoff = true;
          handoffData = {
            reason: block.input?.reason || "human_requested",
            customer_name: block.input?.customer_name,
            customer_contact: block.input?.customer_contact,
            summary: block.input?.summary || "",
          };
        } else if (block.name === "record_order_lead") {
          handoff = true;
          handoffData = {
            reason: "purchase",
            customer_name: block.input?.customer_name,
            customer_contact: block.input?.customer_contact,
            summary: block.input?.details || "",
            details: block.input?.details,
          };
        }
      }
    }

    // Если был вызов инструмента, но текста нет, сформируем подтверждающую фразу
    if (!replyText.trim() && handoff) {
      replyText = "Спасибо за информацию! Я зафиксировал все детали и передал менеджеру — скоро свяжемся с вами.";
    }

    const clean = cleanScriptDialogues(stripMarkdown(replyText));

    return {
      text: clean,
      handoff,
      handoffData,
      toolUsed,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("universal_consultant.claude_exception", { error: msg });
    return {
      text: "Здравствуйте! Подскажите, пожалуйста, какой вопрос вас интересует, и мы с радостью поможем.",
      handoff: false,
    };
  }
}
