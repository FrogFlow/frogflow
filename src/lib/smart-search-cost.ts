/** Official Claude Haiku 4.5 list price (standard Messages API, not batch). */
export const HAIKU_INPUT_USD_PER_MTOK = 1;
export const HAIKU_OUTPUT_USD_PER_MTOK = 5;
export const DEFAULT_USD_PER_REQUEST = 0.1;
export const SMART_SEARCH_DAILY_LIMIT = 200;

/**
 * Множители кеша промпта. Запись стоит дороже обычного ввода, чтение — почти
 * даром; оба считаются отдельно от input_tokens, потому что API возвращает в
 * input_tokens только то, что НЕ попало ни в запись, ни в чтение кеша.
 */
export const CACHE_WRITE_MULTIPLIER = { "5m": 1.25, "1h": 2 } as const;
export const CACHE_READ_MULTIPLIER = 0.1;

/** TTL кеша, выбранный для консультанта; от него зависит цена записи. */
export const CONSULTANT_CACHE_TTL: keyof typeof CACHE_WRITE_MULTIPLIER = "1h";

export type SmartSearchTokenUsage = {
  /** Токены, посчитанные по полной цене: мимо кеша. */
  inputTokens: number;
  outputTokens: number;
  /** Записано в кеш промпта — всего, по всем точкам. */
  cacheCreationTokens?: number;
  /** Из записи — то, что легло в пятиминутный кеш (хвост переписки). */
  cacheCreation5mTokens?: number;
  /** Из записи — то, что легло в часовой кеш (системный промпт и инструменты). */
  cacheCreation1hTokens?: number;
  /** Прочитано из кеша промпта. */
  cacheReadTokens?: number;
};

export type SmartSearchDailySpend = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  usd: number;
};

export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Стоимость вызова с учётом кеша промпта.
 *
 * Без слагаемых кеша счёт получается не «примерно», а в разы меньше: у
 * консультанта системный промпт с каталогом и базой знаний — около 69 тысяч
 * токенов, и при работающем кеше в input_tokens приходит лишь несколько
 * процентов от него. Клиенту этот счёт выставляют, поэтому недосчёт — это
 * деньги мимо кассы.
 *
 * Точек кеша у консультанта две, и ставки у них разные: системный промпт с
 * инструментами пишется на час (×2), хвост переписки — на пять минут (×1,25).
 * Одна общая цифра записи, посчитанная по часовой ставке, завышает счёт на
 * хвосте. Перерасчёт клиенту в его же пользу — такая же ошибка, как недосчёт.
 */
export function estimateUsdFromTokens(
  usage: SmartSearchTokenUsage,
  ttl: keyof typeof CACHE_WRITE_MULTIPLIER = CONSULTANT_CACHE_TTL,
): number {
  const input = Math.max(0, usage.inputTokens);
  const output = Math.max(0, usage.outputTokens);
  const read = Math.max(0, usage.cacheReadTokens ?? 0);
  const written5m = Math.max(0, usage.cacheCreation5mTokens ?? 0);
  const written1h = Math.max(0, usage.cacheCreation1hTokens ?? 0);
  // Общая цифра и разбивка должны сходиться; если ответ дал только общую,
  // остаток считается по TTL вызова — как считалось до появления разбивки.
  const written = Math.max(Math.max(0, usage.cacheCreationTokens ?? 0), written5m + written1h);
  const writtenRest = Math.max(0, written - written5m - written1h);
  const writtenUsd =
    written5m * CACHE_WRITE_MULTIPLIER["5m"] +
    written1h * CACHE_WRITE_MULTIPLIER["1h"] +
    writtenRest * CACHE_WRITE_MULTIPLIER[ttl];
  const inputUsd = (input + writtenUsd + read * CACHE_READ_MULTIPLIER) * HAIKU_INPUT_USD_PER_MTOK;
  return (inputUsd + output * HAIKU_OUTPUT_USD_PER_MTOK) / 1_000_000;
}

/**
 * Сложение двух замеров расхода.
 *
 * На одно сообщение покупателя приходится до четырёх вызовов модели подряд, и
 * складывать их надо целиком. Раньше сложение писалось на месте по полям, и
 * при добавлении нового поля оно молча выпадало из счёта со второго раунда.
 * Поэтому сложение живёт рядом с типом, а не у места вызова.
 */
export function addTokenUsage(
  a: SmartSearchTokenUsage | null | undefined,
  b: SmartSearchTokenUsage | null | undefined,
): SmartSearchTokenUsage | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const sum = (x?: number, y?: number) => Math.max(0, x ?? 0) + Math.max(0, y ?? 0);
  const out: SmartSearchTokenUsage = {
    inputTokens: sum(a.inputTokens, b.inputTokens),
    outputTokens: sum(a.outputTokens, b.outputTokens),
    cacheCreationTokens: sum(a.cacheCreationTokens, b.cacheCreationTokens),
    cacheReadTokens: sum(a.cacheReadTokens, b.cacheReadTokens),
  };
  // Разбивку по TTL несём дальше только если её дал хотя бы один раунд:
  // пустые нули превратили бы часовую запись в неразобранный остаток.
  if (a.cacheCreation5mTokens !== undefined || b.cacheCreation5mTokens !== undefined) {
    out.cacheCreation5mTokens = sum(a.cacheCreation5mTokens, b.cacheCreation5mTokens);
  }
  if (a.cacheCreation1hTokens !== undefined || b.cacheCreation1hTokens !== undefined) {
    out.cacheCreation1hTokens = sum(a.cacheCreation1hTokens, b.cacheCreation1hTokens);
  }
  return out;
}

export function parseDailyCount(raw: string | null | undefined, today = todayUtcDate()): number {
  const [storedDate, storedCountRaw] = (raw ?? "").split(":");
  return storedDate === today ? Number(storedCountRaw) || 0 : 0;
}

export function parseDailySpend(
  raw: string | null | undefined,
  today = todayUtcDate(),
): SmartSearchDailySpend {
  const empty: SmartSearchDailySpend = {
    date: today,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    usd: 0,
  };
  if (!raw?.trim()) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<SmartSearchDailySpend>;
    if (parsed.date !== today) return empty;
    return {
      date: today,
      inputTokens: Math.max(0, Number(parsed.inputTokens) || 0),
      outputTokens: Math.max(0, Number(parsed.outputTokens) || 0),
      // Старые записи полей кеша не содержат — считаем их нулями, а не NaN.
      cacheCreationTokens: Math.max(0, Number(parsed.cacheCreationTokens) || 0),
      cacheReadTokens: Math.max(0, Number(parsed.cacheReadTokens) || 0),
      usd: Math.max(0, Number(parsed.usd) || 0),
    };
  } catch {
    return empty;
  }
}

export function addDailySpend(
  current: SmartSearchDailySpend,
  usage: SmartSearchTokenUsage,
  today = todayUtcDate(),
): SmartSearchDailySpend {
  const base =
    current.date === today
      ? current
      : {
          date: today,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          usd: 0,
        };
  return {
    date: today,
    inputTokens: base.inputTokens + Math.max(0, usage.inputTokens),
    outputTokens: base.outputTokens + Math.max(0, usage.outputTokens),
    cacheCreationTokens: base.cacheCreationTokens + Math.max(0, usage.cacheCreationTokens ?? 0),
    cacheReadTokens: base.cacheReadTokens + Math.max(0, usage.cacheReadTokens ?? 0),
    usd: base.usd + estimateUsdFromTokens(usage),
  };
}

export function extractAnthropicUsage(payload: unknown): SmartSearchTokenUsage | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (
    payload as {
      usage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
        cache_creation_input_tokens?: unknown;
        cache_read_input_tokens?: unknown;
        cache_creation?: {
          ephemeral_5m_input_tokens?: unknown;
          ephemeral_1h_input_tokens?: unknown;
        };
      };
    }
  ).usage;
  if (!usage) return null;
  const inputTokens = Number(usage.input_tokens);
  const outputTokens = Number(usage.output_tokens);
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return null;
  // Разбивка записи по TTL приходит отдельным объектом. Поля может не быть —
  // тогда остаёмся на общей цифре, и она считается по TTL вызова.
  const breakdown = usage.cache_creation;
  const has5m = breakdown && breakdown.ephemeral_5m_input_tokens !== undefined;
  const has1h = breakdown && breakdown.ephemeral_1h_input_tokens !== undefined;
  return {
    inputTokens: Math.max(0, inputTokens || 0),
    outputTokens: Math.max(0, outputTokens || 0),
    // Эти два поля раньше выбрасывались, и вместе с ними — почти весь ввод.
    cacheCreationTokens: Math.max(0, Number(usage.cache_creation_input_tokens) || 0),
    cacheReadTokens: Math.max(0, Number(usage.cache_read_input_tokens) || 0),
    ...(has5m
      ? { cacheCreation5mTokens: Math.max(0, Number(breakdown.ephemeral_5m_input_tokens) || 0) }
      : {}),
    ...(has1h
      ? { cacheCreation1hTokens: Math.max(0, Number(breakdown.ephemeral_1h_input_tokens) || 0) }
      : {}),
  };
}

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
