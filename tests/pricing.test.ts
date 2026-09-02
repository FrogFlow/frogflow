import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  manualCountryPrice,
  resolvePrice,
  resolveDeliveryZoneFee,
  resetPricingCache,
} from "../src/lib/pricing.server";
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
// vi.fn(), а не голая функция — Блок A.2 нужен mockResolvedValueOnce, чтобы
// проверить откат resolvePrice на null от настоящей реализации.
vi.mock("../src/lib/currency.server", () => ({
  convertAmount: vi.fn((amount: number, from: string, to: string) =>
    Promise.resolve(from === "KZT" && to === "RUB" ? Math.round(amount * 0.16) : amount),
  ),
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

  /**
   * Блок A.2 (кейс 2, раунд 2): convertAmount вернул null (курс недоступен) —
   * resolvePrice обязан откатиться на честную базовую цену в своей валюте, а
   * не пропустить null дальше как будто это число.
   */
  it("курс недоступен (convertAmount вернул null) — откатывается на базовую цену", async () => {
    const { convertAmount } = await import("../src/lib/currency.server");
    vi.mocked(convertAmount).mockResolvedValueOnce(null);
    const plain = { price: 1000, currency: "KZT", country_prices: null };
    expect(await resolvePrice(plain, "RU")).toEqual({ amount: 1000, currency: "KZT" });
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

/**
 * Блок 12, находка 12.6 — resolvePrice с третьим аргументом (вариант,
 * Ниши, Блок D): все 9 сценариев выше вызывали функцию только без него.
 * Отдельно фиксируем сознательный обход ручной цены по стране для
 * варианта (Блок 8, находка 8.3, docblock pricing.server.ts:14-24) —
 * поведение неочевидное и раньше не было закреплено регрессионным тестом.
 */
describe("resolvePrice — вариант (Ниши, Блок D)", () => {
  const variant = { price: 500 };

  it("подставляет цену варианта вместо базовой products.price", async () => {
    const plain = { price: 1000, currency: "KZT", country_prices: null };
    expect(await resolvePrice(plain, "KZ", variant)).toEqual({ amount: 500, currency: "KZT" });
  });

  it("курс всё ещё применяется к цене варианта для другой страны", async () => {
    const plain = { price: 1000, currency: "KZT", country_prices: null };
    expect(await resolvePrice(plain, "RU", variant)).toEqual({ amount: 80, currency: "RUB" });
  });

  it("ручная цена страны (country_prices) для варианта не ищется — сознательный обход", async () => {
    // product.country_prices.KZ = 800 — для товара без варианта resolvePrice
    // вернул бы именно 800 (см. тест "для Казахстана берёт ручную цену"
    // выше); с вариантом эта ручная цена игнорируется целиком.
    expect(await resolvePrice(product, "KZ", variant)).toEqual({ amount: 500, currency: "KZT" });
  });

  it("без модуля multi_currency — тоже цена варианта, без конвертации", async () => {
    vi.mocked(hasModule).mockResolvedValue(false);
    const plain = { price: 1000, currency: "KZT", country_prices: null };
    expect(await resolvePrice(plain, "RU", variant)).toEqual({ amount: 500, currency: "KZT" });
  });
});

/**
 * resolveDeliveryZoneFee — комиссия зоны доставки хранится в домашней
 * валюте продавца (MIGRATION-52), но раньше показывалась и прибавлялась к
 * total с ярлыком валюты ПОКУПАТЕЛЯ без самой конвертации: покупатель из
 * России видел и платил "500 RUB" за зону, реально заведённую как "500 KZT".
 * Тот же приём, что и у resolvePrice — реюзает те же моки методов оплаты
 * (KZ — домашняя страна, RU — конвертируется, DE — нет реквизитов).
 */
describe("resolveDeliveryZoneFee", () => {
  it("для домашней страны продавца — без конвертации", async () => {
    expect(await resolveDeliveryZoneFee(500, "KZ")).toEqual({ amount: 500, currency: "KZT" });
  });

  it("для другой страны — конвертирует по курсу, а не просто меняет ярлык", async () => {
    expect(await resolveDeliveryZoneFee(500, "RU")).toEqual({ amount: 80, currency: "RUB" });
  });

  it("страна ещё не выбрана — считает по домашней стране продавца", async () => {
    expect(await resolveDeliveryZoneFee(500, null)).toEqual({ amount: 500, currency: "KZT" });
    expect(await resolveDeliveryZoneFee(500, undefined)).toEqual({ amount: 500, currency: "KZT" });
  });

  it("страна без реквизитов — остаётся домашняя валюта, число не выдумывается", async () => {
    expect(await resolveDeliveryZoneFee(500, "DE")).toEqual({ amount: 500, currency: "KZT" });
  });

  it("курс недоступен (convertAmount вернул null) — откатывается на домашнюю валюту", async () => {
    const { convertAmount } = await import("../src/lib/currency.server");
    vi.mocked(convertAmount).mockResolvedValueOnce(null);
    expect(await resolveDeliveryZoneFee(500, "RU")).toEqual({ amount: 500, currency: "KZT" });
  });

  it("без модуля multi_currency — всегда домашняя валюта, независимо от страны", async () => {
    vi.mocked(hasModule).mockResolvedValue(false);
    expect(await resolveDeliveryZoneFee(500, "RU")).toEqual({ amount: 500, currency: "KZT" });
    expect(await resolveDeliveryZoneFee(500, "KZ")).toEqual({ amount: 500, currency: "KZT" });
  });
});
