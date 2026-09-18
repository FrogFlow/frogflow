import { describe, expect, it } from "vitest";
import {
  bankNameFromFinkazUrl,
  parseFinkazRubQuote,
  parseFinkazUpdatedAt,
} from "../src/lib/consultant/finkaz-parse";
import { isRateFresh, priceRub, RATE_MAX_AGE_HOURS } from "../src/lib/consultant/rate";

/**
 * Живой кусок страницы finkaz.kz/kaspi-bank/exchange-rates от 18.09.2026.
 * ВТБ из-за границы недоступен, сайты банков отдают курс только скриптом,
 * finkaz — обычным текстом, поэтому источник здесь.
 */
const KASPI_PAGE = `
<div class="rates"><p>Обновлено: 18.09.2026 21:30</p>
<h2>Текущие курсы</h2>
<table><tr><th>Валюта</th><th>Банк покупает</th><th>Банк продает</th><th>Спред</th></tr>
<tr><td>EUR / KZT</td><td>538.89</td><td>544.89</td><td>1.11%</td></tr>
<tr><td>RUB / KZT</td><td>4.45</td><td>5.45</td><td>22.47%</td></tr>
<tr><td>USD / KZT</td><td>461.50</td><td>467.50</td><td>1.30%</td></tr>
</table></div>`;

describe("курс банка со страницы finkaz", () => {
  it("берёт курс покупки рубля, а не продажи и не евро", () => {
    const quote = parseFinkazRubQuote(KASPI_PAGE);
    expect(quote?.buy).toBe(4.45);
    expect(quote?.sell).toBe(5.45);
  });

  it("читает отметку времени страницы как время Алматы", () => {
    // 21:30 в Алматы — это 16:30 UTC того же дня.
    expect(parseFinkazUpdatedAt("Обновлено: 18.09.2026 21:30")).toBe("2026-09-18T16:30:00.000Z");
    expect(parseFinkazRubQuote(KASPI_PAGE)?.sourceUpdatedAt).toBe("2026-09-18T16:30:00.000Z");
  });

  it("не принимает страницу, где покупка не дешевле продажи", () => {
    const broken = KASPI_PAGE.replace("<td>4.45</td><td>5.45</td>", "<td>5.45</td><td>4.45</td>");
    expect(parseFinkazRubQuote(broken)).toBeNull();
  });

  it("не принимает число вне разумного коридора", () => {
    const broken = KASPI_PAGE.replace("<td>4.45</td><td>5.45</td>", "<td>461.50</td><td>467.50</td>");
    expect(parseFinkazRubQuote(broken)).toBeNull();
  });

  it("не принимает страницу без строки по рублю", () => {
    expect(parseFinkazRubQuote("<p>Обновлено: 18.09.2026 21:30</p><p>USD / KZT 461.50 467.50</p>")).toBeNull();
  });

  it("называет банк по адресу страницы", () => {
    expect(bankNameFromFinkazUrl("https://finkaz.kz/kaspi-bank/exchange-rates")).toBe("Kaspi");
    expect(bankNameFromFinkazUrl("https://finkaz.kz/halyk-bank/exchange-rates")).toBe("Halyk");
    expect(bankNameFromFinkazUrl("https://online-api.vtb.kz/api/")).toBeNull();
  });
});

describe("устаревший курс не идёт в цену", () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const at = (hoursAgo: number) => ({
    rate: 4.45,
    updatedAt: new Date(now - hoursAgo * 36e5).toISOString(),
  });

  it("свежий курс годится, трёхдневный — нет", () => {
    expect(isRateFresh(at(1), now)).toBe(true);
    expect(isRateFresh(at(RATE_MAX_AGE_HOURS - 1), now)).toBe(true);
    expect(isRateFresh(at(RATE_MAX_AGE_HOURS + 1), now)).toBe(false);
    expect(isRateFresh(null, now)).toBe(false);
  });

  it("цена в рублях считается от курса покупки", () => {
    // Kaspi покупает дешевле, чем ВТБ, поэтому рублёвая цена выше.
    const weekday = Date.parse("2026-09-18T09:00:00.000Z");
    expect(priceRub(100_000, 4.45, new Date(weekday))).toBe(23655);
    expect(priceRub(100_000, 4.79, new Date(weekday))).toBe(21976);
  });
});
