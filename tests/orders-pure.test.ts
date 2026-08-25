import { describe, it, expect } from "vitest";
import { legacyAsMaterials, downloadFileName } from "../src/lib/orders.server";

// Чистые кусочки денежного пути выдачи (Блок 4 плана работ) — раньше
// orders.server.ts не импортировался ни одним тестом вообще.

describe("legacyAsMaterials", () => {
  it("оборачивает внешнюю ссылку", () => {
    expect(legacyAsMaterials(null, null, "https://cdn/x.pdf")).toEqual([
      { path: null, name: null, url: "https://cdn/x.pdf" },
    ]);
  });

  it("оборачивает путь+имя, когда ссылки нет", () => {
    expect(legacyAsMaterials("path/x.pdf", "Материал", null)).toEqual([
      { path: "path/x.pdf", name: "Материал", url: null },
    ]);
  });

  it("ссылка приоритетнее пути, если заданы оба", () => {
    expect(legacyAsMaterials("path/x.pdf", "Материал", "https://cdn/x.pdf")).toEqual([
      { path: null, name: null, url: "https://cdn/x.pdf" },
    ]);
  });

  it("пустой массив, если нет ни ссылки, ни пути", () => {
    expect(legacyAsMaterials(null, null, null)).toEqual([]);
  });
});

describe("downloadFileName", () => {
  it("дописывает расширение из storagePath к человеческому имени", () => {
    expect(downloadFileName("Пазлы БУКВЫ", "1782643012614-ni1xub.pdf")).toBe("Пазлы БУКВЫ.pdf");
  });

  it("не дублирует расширение, если оно уже есть в имени", () => {
    expect(downloadFileName("Пазлы.PDF", "1782643012614-ni1xub.pdf")).toBe("Пазлы.PDF");
  });

  it("заменяет запрещённые в именах файлов символы на пробел", () => {
    expect(downloadFileName('A/B:C*D?E"F<G>H|I', "x.pdf")).toBe("A B C D E F G H I.pdf");
  });

  it("схлопывает повторные пробелы и обрезает края", () => {
    expect(downloadFileName("  A    B  ", "x.pdf")).toBe("A B.pdf");
  });

  it("обрезает слишком длинное имя до 80 символов основы", () => {
    const long = "А".repeat(200);
    const result = downloadFileName(long, "x.pdf");
    expect(result).toBe(`${"А".repeat(80)}.pdf`);
  });

  it("подставляет запасное имя, если после очистки ничего не осталось", () => {
    expect(downloadFileName("   ", "x.pdf")).toBe("Материал.pdf");
  });

  it("без расширения в пути хранилища возвращает имя как есть", () => {
    expect(downloadFileName("Файл", "path-without-extension")).toBe("Файл");
  });
});
