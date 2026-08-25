import { describe, it, expect } from "vitest";
import { parseSmartSearchIds } from "../src/lib/smart-search";

const valid = ["aaa", "bbb", "ccc"];

describe("parseSmartSearchIds", () => {
  it("достаёт id из чистого JSON", () => {
    expect(parseSmartSearchIds('{"ids": ["aaa", "bbb"]}', valid)).toEqual(["aaa", "bbb"]);
  });

  it("достаёт JSON, даже если модель добавила текст вокруг", () => {
    const text = 'Вот подходящие товары:\n{"ids": ["ccc"]}\nНадеюсь, это поможет!';
    expect(parseSmartSearchIds(text, valid)).toEqual(["ccc"]);
  });

  it("отбрасывает id, которых нет среди реальных кандидатов", () => {
    expect(parseSmartSearchIds('{"ids": ["aaa", "fake-id"]}', valid)).toEqual(["aaa"]);
  });

  it("пустой список ids — пустой результат", () => {
    expect(parseSmartSearchIds('{"ids": []}', valid)).toEqual([]);
  });

  it("невалидный JSON — пустой результат, не бросает", () => {
    expect(parseSmartSearchIds("не могу распарсить это", valid)).toEqual([]);
    expect(parseSmartSearchIds("{ вообще не json", valid)).toEqual([]);
  });

  it("ids не массив — пустой результат", () => {
    expect(parseSmartSearchIds('{"ids": "aaa"}', valid)).toEqual([]);
    expect(parseSmartSearchIds("{}", valid)).toEqual([]);
  });
});
