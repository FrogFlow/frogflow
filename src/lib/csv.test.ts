import { describe, it, expect } from "vitest";
import { cell, toCsv, fetchAll, BOM, SEP, PAGE } from "./csv";

/**
 * Выгрузка — та часть, где ошибка не видна: файл открывается, строки на месте,
 * и только сверка с базой показывает, что половины нет. Так и было: выгрузка
 * клиентов молча отдала 999 строк из 2199, потому что PostgREST обрывает ответ
 * на тысяче.
 */

describe("cell — экранирование значения", () => {
  it("пустое значение вместо null и undefined", () => {
    expect(cell(null)).toBe("");
    expect(cell(undefined)).toBe("");
  });

  it("оборачивает в кавычки то, что иначе развалит строку", () => {
    expect(cell(`a${SEP}b`)).toBe(`"a${SEP}b"`);
    expect(cell("две\nстроки")).toBe('"две\nстроки"');
    expect(cell('он сказал "да"')).toBe('"он сказал ""да"""');
  });

  it("не трогает обычный текст", () => {
    expect(cell("Айгуль")).toBe("Айгуль");
    expect(cell(1500)).toBe("1500");
  });

  /**
   * Excel исполняет значение, начинающееся с =, +, - или @. Имя покупателя и
   * заметку вводит человек, поэтому подставить туда формулу может кто угодно.
   */
  it("обезвреживает формулу апострофом", () => {
    for (const dangerous of ["=1+1", "+SUM(A1)", "-2+3", "@SUM(A1)"]) {
      expect(cell(dangerous)).toBe(`'${dangerous}`);
    }
    // Через кавычки формула тоже не должна пролезть.
    expect(cell(`=HYPERLINK("http://x")`)).toBe(`"'=HYPERLINK(""http://x"")"`);
  });

  it("минус внутри строки — не формула", () => {
    expect(cell("Мария-Луиза")).toBe("Мария-Луиза");
  });
});

describe("toCsv — файл целиком", () => {
  it("начинается с BOM, иначе Excel показывает кракозябры", () => {
    expect(toCsv(["Имя"], [["Айгуль"]]).startsWith(BOM)).toBe(true);
  });

  it("разделяет столбцы «;», а строки — CRLF", () => {
    const csv = toCsv(["A", "B"], [["1", "2"]]);
    expect(csv).toBe(`${BOM}A${SEP}B\r\n1${SEP}2`);
  });

  it("заголовок остаётся и при пустых данных", () => {
    expect(toCsv(["Имя", "Сумма"], [])).toBe(`${BOM}Имя${SEP}Сумма`);
  });
});

describe("fetchAll — постраничное чтение", () => {
  /** Отдаёт ровно `total` строк, кусками по PAGE, как это делает PostgREST. */
  const source = (total: number, seen: Array<[number, number]> = []) => {
    const page = (from: number, to: number) => {
      seen.push([from, to]);
      const rows = [];
      for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ i });
      return Promise.resolve({ data: rows, error: null });
    };
    return { page, seen };
  };

  it("забирает всё, что больше одной страницы", async () => {
    const { page } = source(2199);
    const rows = await fetchAll(page, "клиентов");
    // Ровно тот случай, на котором выгрузка обрывалась.
    expect(rows.length).toBe(2199);
  });

  it("запрашивает страницы подряд, без пропусков и нахлёстов", async () => {
    const seen: Array<[number, number]> = [];
    const { page } = source(2199, seen);
    await fetchAll(page, "клиентов");
    expect(seen).toEqual([
      [0, PAGE - 1],
      [PAGE, 2 * PAGE - 1],
      [2 * PAGE, 3 * PAGE - 1],
    ]);
  });

  it("останавливается на неполной странице — ровно одна страница", async () => {
    const seen: Array<[number, number]> = [];
    const { page } = source(10, seen);
    expect((await fetchAll(page, "заказов")).length).toBe(10);
    expect(seen.length).toBe(1);
  });

  /**
   * Граница, на которой легко ошибиться: страница пришла полной, значит надо
   * спросить следующую — даже если она окажется пустой.
   */
  it("ровно PAGE строк — спрашивает следующую страницу", async () => {
    const seen: Array<[number, number]> = [];
    const { page } = source(PAGE, seen);
    expect((await fetchAll(page, "заказов")).length).toBe(PAGE);
    expect(seen.length).toBe(2);
  });

  it("пустая выборка — пустой результат, один запрос", async () => {
    const seen: Array<[number, number]> = [];
    const { page } = source(0, seen);
    expect(await fetchAll(page, "заказов")).toEqual([]);
    expect(seen.length).toBe(1);
  });

  it("ошибку базы не проглатывает — иначе выгрузка выйдет неполной молча", async () => {
    const failing = () => Promise.resolve({ data: null, error: { message: "разрыв связи" } });
    await expect(fetchAll(failing, "заказы")).rejects.toThrow(/заказы.*разрыв связи/);
  });
});
