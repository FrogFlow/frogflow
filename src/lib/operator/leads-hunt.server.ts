/**
 * Поиск кандидатов в клиенты FrogFlow: веб-выдача → ИИ вынимает ICP.
 * Ключ поиска опционален (Tavily / Brave / Serper); без него — html DuckDuckGo.
 * Разбор «кто нам подходит» всегда через Anthropic — сырые сниппеты в CRM
 * не кладём, иначе очередь забьётся агрегаторами.
 */
import { callAnthropic } from "./leads-ai.server";
import {
  ICP_EXTRACT_RULES,
  parseExtractedLeads,
  parseDuckDuckGoHtml,
  searchHitsPromptBlock,
  type HuntCandidate,
  type SearchHit,
} from "./leads-pipeline";

export type HuntSearchBackend = "tavily" | "brave" | "serper" | "duckduckgo";

export function huntSearchBackend(): HuntSearchBackend | null {
  if (process.env.TAVILY_API_KEY?.trim()) return "tavily";
  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) return "brave";
  if (process.env.SERPER_API_KEY?.trim()) return "serper";
  return "duckduckgo";
}

export function isHuntConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

async function searchTavily(query: string): Promise<SearchHit[]> {
  const key = process.env.TAVILY_API_KEY!.trim();
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: 8,
      search_depth: "basic",
      include_answer: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const json = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (json.results ?? [])
    .filter((r) => r.url && r.title)
    .map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.content ?? "").slice(0, 400),
    }));
}

async function searchBrave(query: string): Promise<SearchHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY!.trim();
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`,
    {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const json = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (json.web?.results ?? [])
    .filter((r) => r.url && r.title)
    .map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.description ?? "").slice(0, 400),
    }));
}

async function searchSerper(query: string): Promise<SearchHit[]> {
  const key = process.env.SERPER_API_KEY!.trim();
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-KEY": key },
    body: JSON.stringify({ q: query, num: 8 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const json = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  return (json.organic ?? [])
    .filter((r) => r.link && r.title)
    .map((r) => ({
      title: r.title ?? "",
      url: r.link ?? "",
      snippet: (r.snippet ?? "").slice(0, 400),
    }));
}

async function searchDuckDuckGo(query: string): Promise<SearchHit[]> {
  const res = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; FrogFlowLeads/1.0; +https://frogflow.app)",
        accept: "text/html",
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
  const html = await res.text();
  return parseDuckDuckGoHtml(html);
}

export async function searchWeb(query: string): Promise<{ backend: HuntSearchBackend; hits: SearchHit[] }> {
  const backend = huntSearchBackend() ?? "duckduckgo";
  let hits: SearchHit[] = [];
  if (backend === "tavily") hits = await searchTavily(query);
  else if (backend === "brave") hits = await searchBrave(query);
  else if (backend === "serper") hits = await searchSerper(query);
  else hits = await searchDuckDuckGo(query);
  if (hits.length === 0 && backend !== "duckduckgo") {
    hits = await searchDuckDuckGo(query);
    return { backend: "duckduckgo", hits };
  }
  return { backend, hits };
}

export async function extractCandidates(query: string, hits: SearchHit[]): Promise<HuntCandidate[]> {
  if (hits.length === 0) return [];
  const prompt =
    `${ICP_EXTRACT_RULES}\n\nЗапрос: ${query}\n\nВыдача:\n${searchHitsPromptBlock(hits)}`;
  const text = await callAnthropic(prompt, 2500);
  if (!text) return [];
  return parseExtractedLeads(text);
}
