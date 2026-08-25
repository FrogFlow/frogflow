/**
 * Умный поиск по каталогу (Кейс 3, №9) — чистая часть: разбор и валидация
 * ответа LLM, без сетевого вызова.
 *
 * Модель отвечает текстом, из которого нужно вытащить JSON-объект вида
 * {"ids": [...]}; ответ не доверенный — id, которых нет среди реально
 * переданных кандидатов, отбрасываются, чтобы сбой или "фантазия" модели не
 * показали покупателю выдуманный товар.
 */

export function parseSmartSearchIds(
  responseText: string,
  validIds: Set<string> | string[],
): string[] {
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  const match = responseText.match(/\{[\s\S]*\}/);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }

  const ids = (parsed as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string" && valid.has(id));
}
