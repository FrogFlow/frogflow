import { describe, expect, it } from "vitest";
import {
  decodeBase64,
  extractDocumentText,
  hasSectionMarkers,
  titleFromFileName,
  KNOWLEDGE_FILE_MAX_MB,
} from "../src/lib/consultant/doc-text";

const encode = (text: string) => new TextEncoder().encode(text);

describe("текст из файла базы знаний", () => {
  it("читает обычный текст и markdown", async () => {
    const res = await extractDocumentText(encode("## Уход\nСтирка при 40°C"), "care.md");
    expect(res).toEqual({ ok: true, text: "## Уход\nСтирка при 40°C" });
  });

  it("не принимает пустой файл", async () => {
    expect(await extractDocumentText(new Uint8Array(), "empty.txt")).toEqual({
      ok: false,
      error: "Файл пустой.",
    });
  });

  it("узнаёт PDF по сигнатуре, даже если расширение другое", async () => {
    const notReallyAPdf = encode("%PDF-1.7\nтут не настоящий pdf");
    const res = await extractDocumentText(notReallyAPdf, "catalog.bin");
    // Главное — файл ушёл в ветку PDF и получил внятную ошибку,
    // а не был молча разобран как текст с бинарным мусором внутри.
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/PDF/);
  });

  it("base64 читается и с префиксом data:, и без него", () => {
    const plain = Buffer.from("привет").toString("base64");
    expect(new TextDecoder().decode(decodeBase64(plain))).toBe("привет");
    expect(new TextDecoder().decode(decodeBase64(`data:text/plain;base64,${plain}`))).toBe("привет");
  });

  it("видит разделители статей", () => {
    expect(hasSectionMarkers("## Первая\nтекст\n---\n## Вторая")).toBe(true);
    expect(hasSectionMarkers("Сплошной текст из PDF без разделителей")).toBe(false);
  });

  it("делает заголовок из имени файла", () => {
    expect(titleFromFileName("Dorelan_Mattresses_Overview.pdf")).toBe("Dorelan Mattresses Overview");
    expect(titleFromFileName("traumina-bot-catalog.pdf")).toBe("traumina bot catalog");
    expect(titleFromFileName(".pdf")).toBe("Документ");
  });

  it("предел размера задан одним числом для сервера и формы", () => {
    expect(KNOWLEDGE_FILE_MAX_MB).toBe(3);
  });
});
