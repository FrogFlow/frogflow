import { describe, it, expect, vi, beforeEach } from "vitest";
import { manualCountryPrice, resolvePrice, resetPricingCache } from "../src/lib/pricing.server";
import { hasModule } from "../src/lib/modules/modules.server";

/**
 * Числа взяты из настоящего каталога и из объяснения продавца: в основном поле
 * стоит завышенная цена (1000 ₸), в цене для Казахстана — настоящая (800 ₸), а
 * для остальных стран сумма считается по курсу от основной.
 */
const product = {
  price: 1000,
  currency: "KZT",
  country_prices: { KZ: 800 } as unknown as null,
};

/** Реквизиты клиента: Казахстан первым, дальше Россия и остальные. */
const methods = [
  { country_code: "KZ", currency: "KZT", sort_order: 1 },
  { country_code: "RU", currency: "RUB", sort_order: 2 },
  { country_code: "OTHER", currency: "USD", sort_order: 99 },
];

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => Promise.resolve({ data: methods }),
          }),
        }),
      }),
    }),
  },
}));

// Курс — фиксированный, чтобы проверять правило, а не сегодняшнюю цифру.
vi.mock("../src/lib/currency.server", () => ({
  convertAmount: (amount: number, from: string, to: string) =>
    Promise.resolve(from === "KZT" && to === "RUB" ? Math.round(amount * 0.16) : amount),
}));

// По умолчанию модуль включён — большинство тестов ниже писались для тенанта
// с multi_currency, а "выключено" проверяется отдельно (см. describe ниже).
vi.mock("../src/lib/modules/modules.server", () => ({
  hasModule: vi.fn().mockResolvedValue(true),
}));

beforeEach(() => {
  resetPricingCache();
  vi.mocked(hasModule).mockResolvedValue(true);
});

describe("manualCountryPrice", () => {
  it("читает плоскую карту, которую пишет админка", () => {
    expect(manualCountryPrice({ KZ: 800 } as never, "KZ")).toBe(800);
    expect(manualCountryPrice({ KZ: 800 } as never, "RU")).toBeNull();
  });

  it("понимает и старый вид с валютой", () => {
    expect(manualCountryPrice({ RU: { price: 500, currency: "RUB" } } as never, "RU")).toBe(500);
  });

  it("пустое поле — это «считать по курсу», а не ноль", () => {
    expect(manualCountryPrice({ KZ: 0 } as never, "KZ")).toBeNull();
    expect(manualCountryPrice({ KZ: null } as never, "KZ")).toBeNull();
    expect(manualCountryPrice(null, "KZ")).toBeNull();
  });
});

describe("resolvePrice", () => {
  it("для Казахстана берёт ручную цену, а не основную", async () => {
    expect(await resolvePrice(product, "KZ")).toEqual({ amount: 800, currency: "KZT" });
  });

  /**
   * Тот самый случай из живого теста: покупатель из России видел цену в тенге.
   * Ручной цены для RU нет — значит основная цена переводится в рубли.
   */
  it("для России считает по курсу и показывает рубли", async () => {
    expect(await resolvePrice(product, "RU")).toEqual({ amount: 160, currency: "RUB" });
  });

  /**
   * Второй случай: пока страна неизвестна, показывалась основная цена 1000 —
   * то есть завышенная. Правильный ответ — цена домашней страны продавца.
   */
  it("при неизвестной стране считает по домашней стране продавца", async () => {
    expect(await resolvePrice(product, null)).toEqual({ amount: 800, currency: "KZT" });
    expect(await resolvePrice(product, undefined)).toEqual({ amount: 800, currency: "KZT" });
  });

  it("товар без цен по странам считается по курсу от основной", async () => {
    const plain = { price: 1000, currency: "KZT", country_prices: null };
    expect(await resolvePrice(plain, "RU")).toEqual({ amount: 160, currency: "RUB" });
    expect(await resolvePrice(plain, "KZ")).toEqual({ amount: 1000, currency: "KZT" });
  });

  it("страна без реквизитов не роняет расчёт", async () => {
    // Валюты для такой страны нет — остаётся валюта товара, сумма не выдумывается.
    expect(await resolvePrice(product, "DE")).toEqual({ amount: 1000, currency: "KZT" });
  });
});

/**
 * Блок 3.3 плана работ: без модуля multi_currency покупатель всегда видит
 * базовую цену в базовой валюте товара — ни ручные цены по странам, ни
 * конвертация по курсу больше не участвуют, независимо от страны.
 */
describe("resolvePrice — модуль multi_currency выключен", () => {
  beforeEach(() => {
    vi.mocked(hasModule).mockResolvedValue(false);
  });

  it("игнорирует ручную цену страны и конвертацию — всегда база", async () => {
    expect(await resolvePrice(product, "KZ")).toEqual({ amount: 1000, currency: "KZT" });
    expect(await resolvePrice(product, "RU")).toEqual({ amount: 1000, currency: "KZT" });
    expect(await resolvePrice(product, "DE")).toEqual({ amount: 1000, currency: "KZT" });
    expect(await resolvePrice(product, null)).toEqual({ amount: 1000, currency: "KZT" });
  });
});
