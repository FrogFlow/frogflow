import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * convertAmount раньше на сбое (неизвестная валюта или недоступный API курсов)
 * возвращало Math.round(amount) как есть — число из валюты `from`, подписанное
 * как `to`. Для заказа это не «цена чуть устарела», а прямая неверная сумма
 * (Блок A.2, кейс 2, раунд 2). Проверяем, что теперь оба случая дают `null`, а
 * не выдуманное число.
 */

let cachedSettingsRow: { value: string } | null = null;

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: cachedSettingsRow }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      insert: () => Promise.resolve({ data: null, error: null }),
    }),
  },
}));

const originalFetch = global.fetch;

beforeEach(() => {
  cachedSettingsRow = null;
  vi.resetModules();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("convertAmount", () => {
  it("одна и та же валюта — без похода в сеть, просто округляет", async () => {
    global.fetch = vi.fn(() => {
      throw new Error("не должно вызываться");
    }) as unknown as typeof fetch;
    const { convertAmount } = await import("../src/lib/currency.server");
    expect(await convertAmount(1000.4, "KZT", "kzt")).toBe(1000);
  });

  it("валюта не найдена в таблице курсов — null, а не исходное число", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: "success", rates: { USD: 1, KZT: 450 } }),
      }),
    ) as unknown as typeof fetch;
    const { convertAmount } = await import("../src/lib/currency.server");
    // BYN отсутствует в возвращённой таблице курсов.
    expect(await convertAmount(1000, "KZT", "BYN")).toBeNull();
  });

  it("API курсов недоступен и кэша ещё не было — null, а не исходное число", async () => {
    global.fetch = vi.fn(() =>
      Promise.reject(new Error("network down")),
    ) as unknown as typeof fetch;
    const { convertAmount } = await import("../src/lib/currency.server");
    expect(await convertAmount(1000, "KZT", "RUB")).toBeNull();
  });

  it("API недоступен, но есть кэш — считает по устаревшему курсу, не по null", async () => {
    cachedSettingsRow = {
      value: JSON.stringify({
        ts: Date.now() - 48 * 60 * 60 * 1000, // старше TTL, но лучше, чем ничего
        rates: { USD: 1, KZT: 450, RUB: 90 },
      }),
    };
    global.fetch = vi.fn(() =>
      Promise.reject(new Error("network down")),
    ) as unknown as typeof fetch;
    const { convertAmount } = await import("../src/lib/currency.server");
    const result = await convertAmount(450, "KZT", "RUB");
    expect(result).not.toBeNull();
    expect(result).toBe(90); // 450 KZT -> 1 USD -> 90 RUB по кэшированному курсу
  });
});
