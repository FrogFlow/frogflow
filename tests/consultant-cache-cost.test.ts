import { describe, expect, it } from "vitest";
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  CONSULTANT_CACHE_TTL,
  estimateUsdFromTokens,
  extractAnthropicUsage,
} from "../src/lib/smart-search-cost";
import { addSmartSearchLifetime, parseSmartSearchLifetime } from "../src/lib/ai-usage";

/**
 * Боевые пропорции: системный промпт консультанта — каталог на 877 позиций
 * плюс база знаний из 16 статей, около 69 000 токенов. При работающем кеше
 * API возвращает в input_tokens только несколько процентов от этого, а
 * остальное — в полях кеша, которые раньше выбрасывались.
 */
const CACHED_PROMPT = 69_000;

describe("учёт кеша промпта", () => {
  it("забирает поля кеша из ответа API", () => {
    const usage = extractAnthropicUsage({
      usage: {
        input_tokens: 180,
        output_tokens: 240,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: CACHED_PROMPT,
      },
    });
    expect(usage).toEqual({
      inputTokens: 180,
      outputTokens: 240,
      cacheCreationTokens: 0,
      cacheReadTokens: CACHED_PROMPT,
    });
  });

  it("ответ без полей кеша даёт нули, а не NaN", () => {
    expect(extractAnthropicUsage({ usage: { input_tokens: 10, output_tokens: 5 } })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it("чтение из кеша попадает в стоимость", () => {
    const read = { inputTokens: 180, outputTokens: 240, cacheReadTokens: CACHED_PROMPT };
    const withCache = estimateUsdFromTokens(read);
    const ignoringCache = estimateUsdFromTokens({ inputTokens: 180, outputTokens: 240 });
    // Прежний расчёт видел только 180 входных токенов из 69 180 и занижал
    // счёт в разы. Клиенту этот счёт выставляют.
    expect(withCache).toBeGreaterThan(ignoringCache * 3);
    expect(withCache).toBeCloseTo((180 + CACHED_PROMPT * CACHE_READ_MULTIPLIER + 240 * 5) / 1e6, 10);
  });

  it("запись в кеш тарифицируется по выбранному TTL", () => {
    const write = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: CACHED_PROMPT };
    expect(estimateUsdFromTokens(write, "1h")).toBeCloseTo((CACHED_PROMPT * 2) / 1e6, 10);
    expect(estimateUsdFromTokens(write, "5m")).toBeCloseTo((CACHED_PROMPT * 1.25) / 1e6, 10);
    expect(CACHE_WRITE_MULTIPLIER["1h"]).toBeGreaterThan(CACHE_WRITE_MULTIPLIER["5m"]);
  });

  it("часовой TTL выбран сознательно — медиана промежутка 10,6 минуты", () => {
    // Замер по журналу событий бота: половина сообщений приходит позже, чем
    // через 5 минут после предыдущего, то есть пятиминутный кеш до них не
    // доживает, а часовой — доживает.
    expect(CONSULTANT_CACHE_TTL).toBe("1h");
  });

  it("чтение дешевле записи настолько, что попадание окупает промах", () => {
    const write = estimateUsdFromTokens({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: CACHED_PROMPT,
    });
    const read = estimateUsdFromTokens({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: CACHED_PROMPT,
    });
    // При часовом TTL запись стоит ровно в 20 раз дороже чтения (2 против
    // 0,1), поэтому одна запись окупается двадцатью попаданиями.
    expect(write / read).toBeCloseTo(20, 6);
  });
});

describe("сложение раундов внутри одного сообщения", () => {
  // На одно сообщение клиента приходится до четырёх вызовов подряд, и каждый
  // несёт весь промпт. Складывать надо все четыре счётчика: раньше со второго
  // раунда пересобирался объект из двух полей, и токены кеша — почти весь
  // ввод — пропадали из учёта.
  const accumulate = (a: typeof one, b: typeof one) => ({
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: (a.cacheCreationTokens ?? 0) + (b.cacheCreationTokens ?? 0),
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
  });
  const one = { inputTokens: 180, outputTokens: 120, cacheCreationTokens: 0, cacheReadTokens: CACHED_PROMPT };

  it("четыре раунда стоят вчетверо, а не как один", () => {
    const total = [one, one, one].reduce(accumulate, one);
    expect(total.cacheReadTokens).toBe(CACHED_PROMPT * 4);
    expect(estimateUsdFromTokens(total)).toBeCloseTo(estimateUsdFromTokens(one) * 4, 10);
  });
});

describe("накопленный расход", () => {
  it("читает старую запись без полей кеша", () => {
    const old = JSON.stringify({ count: 390, inputTokens: 1_240_353, outputTokens: 52_411, usd: 1.5 });
    expect(parseSmartSearchLifetime(old)).toEqual({
      count: 390,
      inputTokens: 1_240_353,
      outputTokens: 52_411,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      usd: 1.5,
    });
  });

  it("копит токены кеша отдельной строкой", () => {
    const start = parseSmartSearchLifetime(null);
    const next = addSmartSearchLifetime(start, {
      inputTokens: 180,
      outputTokens: 240,
      cacheCreationTokens: 0,
      cacheReadTokens: CACHED_PROMPT,
    });
    expect(next.count).toBe(1);
    expect(next.cacheReadTokens).toBe(CACHED_PROMPT);
    expect(next.usd).toBeGreaterThan(0);
  });
});
