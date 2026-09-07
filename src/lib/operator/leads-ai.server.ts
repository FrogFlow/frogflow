/**
 * Общий вызов Anthropic для воронки лидов. И оценка, и охота, и черновик
 * ходят сюда — один fetch-паттерн (как smart-search.server.ts), без SDK.
 */

export const LEADS_MODEL = "claude-haiku-4-5-20251001";
export const LEADS_AI_TIMEOUT_MS = 40_000;

export function isLeadsAiKeyPresent(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function callAnthropic(prompt: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "В переменных панели нет ANTHROPIC_API_KEY — оценка, письмо и поиск лидов без ключа не работают. Добавьте ключ в Vercel проекта панели оператора.",
    );
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: LEADS_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(LEADS_AI_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return json.content?.find((b) => b.type === "text")?.text ?? null;
}
