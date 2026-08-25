/**
 * Умный поиск по каталогу (Кейс 3, №9).
 *
 * Включается отдельным переключателем в настройках (app_settings
 * smart_search_enabled), а не автоматически при наличии ключа: в отличие от
 * остальных задач этого кейса, у смарт-поиска есть реальная стоимость за
 * каждый вызов (обращение к Anthropic API), и продавец должен решить это
 * сознательно, а не получить платный трафик тихо включённым по умолчанию.
 *
 * Срабатывает только когда обычный ILIKE-поиск (bot.server.ts showSearch)
 * ничего не нашёл — это фолбэк для запросов вроде «что-то на день рождения
 * пятилетке», которые не совпадают по словам ни с одним товаром, а не
 * замена быстрому точному поиску.
 */
import { parseSmartSearchIds } from "./smart-search";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_CANDIDATES = 200;
const MAX_QUERY_LEN = 200;
const TIMEOUT_MS = 15_000;

export type SmartSearchCandidate = {
  id: string;
  name: string;
  description: string | null;
  keywords: string | null;
};

export async function isSmartSearchEnabled(): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return false;
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "smart_search_enabled")
    .maybeSingle();
  return data?.value === "true";
}

/**
 * Возвращает id кандидатов, реально подходящих запросу по смыслу, в порядке
 * убывания релевантности — или null при любом сбое (нет ключа, сеть,
 * невалидный ответ), чтобы вызывающий код просто показал «ничего не
 * найдено», как и раньше, а не упал.
 */
export async function smartSearchProductIds(
  query: string,
  candidates: SmartSearchCandidate[],
): Promise<string[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const trimmedQuery = query.trim().slice(0, MAX_QUERY_LEN);
  if (!trimmedQuery || candidates.length === 0) return null;

  const list = candidates.slice(0, MAX_CANDIDATES).map((c) => ({
    id: c.id,
    name: c.name,
    description: (c.description ?? "").slice(0, 200),
    keywords: (c.keywords ?? "").slice(0, 100),
  }));

  const prompt =
    `Покупатель ищет товар в интернет-магазине. Запрос: "${trimmedQuery}"\n\n` +
    `Список товаров (JSON):\n${JSON.stringify(list)}\n\n` +
    `Выбери id товаров, которые реально подходят под запрос по смыслу — не только по точному ` +
    `совпадению слов. Если ничего не подходит, верни пустой список. Отвечай СТРОГО одним JSON-` +
    `объектом без пояснений, в формате {"ids": ["id1", "id2"]}, id упорядочены по убыванию ` +
    `релевантности.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(
        "[smart-search] Anthropic API error",
        res.status,
        await res.text().catch(() => ""),
      );
      return null;
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.find((b) => b.type === "text")?.text ?? "";
    return parseSmartSearchIds(
      text,
      list.map((c) => c.id),
    );
  } catch (e) {
    console.error("[smart-search] request failed", e);
    return null;
  }
}
