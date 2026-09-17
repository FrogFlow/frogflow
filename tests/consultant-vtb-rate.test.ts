import { describe, expect, it } from "vitest";
import { parseVtbBuyRate, parseVtbRateQuote } from "../src/lib/consultant/vtb-parse";
import { getRubMultiplier, priceRub } from "../src/lib/consultant/rate";

/**
 * Числа взяты со скрина online.vtb.kz, присланного продавцом:
 * RUB — покупка 4.79 ₸, продажа 5.79 ₸.
 * Перепутать их — это ~20% в рублёвой цене, продавец спрашивал об этом прямо.
 */
const BUY = 4.79;
const SELL = 5.79;

describe("курс ВТБ из API", () => {
  it("берёт безналичный курс покупки RUB/KZT", () => {
    const body = JSON.stringify([
      { baseCurrencyIsoCode: "USD", currencyIsoCode: "KZT", typeId: 2, coursePurchase: 535.5, courseSell: 541 },
      { baseCurrencyIsoCode: "RUB", currencyIsoCode: "KZT", typeId: 2, coursePurchase: BUY, courseSell: SELL },
      { baseCurrencyIsoCode: "CNY", currencyIsoCode: "KZT", typeId: 2, coursePurchase: 62.5, courseSell: 70.5 },
    ]);
    expect(parseVtbRateQuote(body)).toEqual({ buy: BUY, sell: SELL });
  });

  it("предпочитает безналичную строку наличной", () => {
    const body = JSON.stringify([
      { baseCurrencyIsoCode: "RUB", currencyIsoCode: "KZT", typeId: 1, coursePurchase: 4.6, courseSell: 6.1 },
      { baseCurrencyIsoCode: "RUB", currencyIsoCode: "KZT", type: { value: "CASHLESS" }, coursePurchase: BUY, courseSell: SELL },
    ]);
    expect(parseVtbBuyRate(body)).toBe(BUY);
  });

  it("не берёт курс, если покупка оказалась выше продажи — поля перепутаны", () => {
    const body = JSON.stringify([
      { baseCurrencyIsoCode: "RUB", currencyIsoCode: "KZT", typeId: 2, coursePurchase: SELL, courseSell: BUY },
    ]);
    expect(parseVtbRateQuote(body)).toBeNull();
  });

  it("не выдумывает курс, если поля покупки нет", () => {
    const body = JSON.stringify([
      { baseCurrencyIsoCode: "RUB", currencyIsoCode: "KZT", typeId: 2, courseSell: SELL },
    ]);
    expect(parseVtbRateQuote(body)).toBeNull();
  });

  it("не принимает курс НБРК за курс ВТБ", () => {
    const nbk = `<rss><item><title>RUB</title><description>5.33</description></item></rss>`;
    expect(parseVtbBuyRate(nbk)).toBeNull();
  });
});

describe("курс ВТБ со страницы курсов", () => {
  const page =
    "<h1>Безналичные курсы валют</h1><table><tr><th>Валюта</th><th>Покупка</th><th>Продажа</th></tr>" +
    "<tr><td>RUB</td><td>4.79₸</td><td>5.79₸</td></tr>" +
    "<tr><td>CNY</td><td>62.5₸</td><td>70.5₸</td></tr></table>";

  it("берёт покупку, а не продажу", () => {
    expect(parseVtbRateQuote(page)).toEqual({ buy: BUY, sell: SELL });
  });

  it("берёт покупку даже если колонки поменяли местами", () => {
    const swapped = page
      .replace("<th>Покупка</th><th>Продажа</th>", "<th>Продажа</th><th>Покупка</th>")
      .replace("<td>4.79₸</td><td>5.79₸</td>", "<td>5.79₸</td><td>4.79₸</td>");
    expect(parseVtbRateQuote(swapped)?.buy).toBe(BUY);
  });

  it("без слова «покупка» рядом это не таблица курсов банка", () => {
    expect(parseVtbBuyRate("<div>RUB 4.79 5.79</div>")).toBeNull();
  });
});

describe("формула цены в рублях", () => {
  const monday = new Date("2026-09-14T09:00:00Z");
  const saturday = new Date("2026-09-19T09:00:00Z");

  it("совпадает с формулой продавца: ₸ / (курс покупки × 0,95)", () => {
    // Расчёт продавца: 4,79 − 5% = 4,551; 60 000 / 4,55 ≈ 13 187 ₽.
    // Мы делим на неокруглённые 4,5505, поэтому получаем 13 185 ₽.
    expect(getRubMultiplier(monday)).toBe(0.95);
    expect(priceRub(60_000, BUY, monday)).toBe(13_185);
  });

  it("в выходные коэффициент 0,93", () => {
    expect(getRubMultiplier(saturday)).toBe(0.93);
    expect(priceRub(60_000, BUY, saturday)).toBe(13_469);
  });

  it("курс продажи дал бы цену почти на 20% ниже — цену занижало бы именно это", () => {
    expect(priceRub(60_000, SELL, monday)).toBe(10_908);
  });

  it("курс НБРК 5,28 давал ту самую цифру 11 962 ₽ со скрина", () => {
    expect(priceRub(60_000, 5.28, monday)).toBe(11_962);
  });
});
