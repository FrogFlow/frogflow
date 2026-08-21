import { describe, it, expect } from "vitest";
import {
  parseCatalogPayload,
  whatsappList,
  WA_LIST_MAX_ROWS,
  WA_LIST_PAGE_SIZE,
  type WhatsAppListRow,
} from "../src/lib/zernio-bot.server";

/**
 * Каталог WhatsApp упирается в лимиты Meta, а не в наши предпочтения: на всё
 * сообщение десять строк, заголовок строки 24 символа, описание 72, текст
 * кнопки 20. Перебор Meta не подсвечивает — она молча режет или отвечает
 * ошибкой, и для покупателя это выглядит как «половина каталога пропала».
 *
 * Первая версия каталога как раз в это и уперлась: плоский список на десять
 * товаров у клиента с 387 позициями и названиями по 162 символа. Тесты держат
 * обе границы — и раскладку страницы, и обрезку строк.
 */

type ListShape = {
  type: string;
  body: { text: string };
  action: {
    button: string;
    sections: Array<{ title: string; rows: WhatsAppListRow[] }>;
  };
};

const asList = (value: unknown) => value as unknown as ListShape;

const rows = (count: number, prefix = "r"): WhatsAppListRow[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, title: `Строка ${i}` }));

const allRows = (list: ListShape) => list.action.sections.flatMap((section) => section.rows);

describe("parseCatalogPayload", () => {
  it("корень разбирается в parentId = null", () => {
    expect(parseCatalogPayload("CAT:root:0")).toEqual({ parentId: null, offset: 0 });
  });

  it("категория и смещение читаются как есть", () => {
    expect(parseCatalogPayload("CAT:9f1c2d3e-0000-4000-8000-000000000001:8")).toEqual({
      parentId: "9f1c2d3e-0000-4000-8000-000000000001",
      offset: 8,
    });
  });

  it("отсутствующее или битое смещение — это ноль, а не NaN", () => {
    expect(parseCatalogPayload("CAT:root")?.offset).toBe(0);
    expect(parseCatalogPayload("CAT:root:абв")?.offset).toBe(0);
    expect(parseCatalogPayload("CAT:root:-5")?.offset).toBe(0);
  });

  it("чужие постбэки не перехватываются", () => {
    // Иначе каталог съел бы кнопки автоматизаций Zernio и шаги сценария.
    for (const payload of ["BUY:123", "CART", "CHECKOUT", "CATALOG", "STEP:1", "PROD:123", ""]) {
      expect(parseCatalogPayload(payload)).toBeNull();
    }
  });
});

describe("whatsappList", () => {
  it("не отдаёт больше строк, чем принимает Meta", () => {
    const list = asList(
      whatsappList({
        body: "тело",
        buttonLabel: "Открыть",
        sections: [{ title: "Товары", rows: rows(50) }],
      }),
    );
    expect(allRows(list)).toHaveLength(WA_LIST_MAX_ROWS);
  });

  it("лимит общий на сообщение, а не на секцию", () => {
    // Две секции по восемь строк — это 16, то есть больше лимита: вторая
    // секция обязана получить остаток, а не свои полные восемь.
    const list = asList(
      whatsappList({
        body: "тело",
        buttonLabel: "Открыть",
        sections: [
          { title: "Разделы", rows: rows(8, "c") },
          { title: "Товары", rows: rows(8, "p") },
        ],
      }),
    );
    expect(allRows(list)).toHaveLength(WA_LIST_MAX_ROWS);
    expect(list.action.sections[0].rows).toHaveLength(8);
    expect(list.action.sections[1].rows).toHaveLength(2);
  });

  it("пустые секции выбрасываются — Meta на них отвечает ошибкой", () => {
    const list = asList(
      whatsappList({
        body: "тело",
        buttonLabel: "Открыть",
        sections: [
          { title: "Разделы", rows: [] },
          { title: "Товары", rows: rows(3) },
          { title: "…", rows: [] },
        ],
      }),
    );
    expect(list.action.sections).toHaveLength(1);
    expect(list.action.sections[0].title).toBe("Товары");
  });

  it("длинные тексты режутся по границам Meta", () => {
    const list = asList(
      whatsappList({
        body: "тело",
        buttonLabel: "Очень длинная надпись на кнопке списка",
        sections: [
          {
            title: "Секция с очень длинным заголовком сверх лимита",
            rows: [
              {
                id: "p1",
                // Настоящий случай: у «Развивашка» названия доходят до 162 символов.
                title: "А".repeat(162),
                description: "Б".repeat(200),
              },
            ],
          },
        ],
      }),
    );
    expect(list.action.button).toHaveLength(20);
    expect(list.action.sections[0].title).toHaveLength(24);
    expect(list.action.sections[0].rows[0].title).toHaveLength(24);
    expect(list.action.sections[0].rows[0].description).toHaveLength(72);
  });

  it("страница оставляет место под «Назад» и «Ещё»", () => {
    // Обе строки нужны одновременно: вложенная категория, где товаров больше
    // страницы. Если бы содержимое занимало все десять строк, навигация
    // вытеснила бы товары.
    expect(WA_LIST_PAGE_SIZE + 2).toBe(WA_LIST_MAX_ROWS);

    const list = asList(
      whatsappList({
        body: "тело",
        buttonLabel: "Открыть",
        sections: [
          { title: "Товары", rows: rows(WA_LIST_PAGE_SIZE, "p") },
          {
            title: "…",
            rows: [
              { id: "CAT:root:8", title: "➡️ Показать ещё" },
              { id: "CAT:root:0", title: "⬆️ Назад" },
            ],
          },
        ],
      }),
    );
    const flat = allRows(list);
    expect(flat).toHaveLength(WA_LIST_MAX_ROWS);
    expect(flat.at(-2)?.id).toBe("CAT:root:8");
    expect(flat.at(-1)?.id).toBe("CAT:root:0");
  });
});
