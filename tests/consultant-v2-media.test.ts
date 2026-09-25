import { describe, it, expect } from "vitest";
import type { ConsultantProduct } from "../src/lib/consultant/catalog";
import {
  mediaForProduct,
  mediaMatchesProduct,
  normalizeForMatch,
  parseProductMedia,
  type ProductMedia,
} from "../src/lib/consultant-v2/media";

/**
 * Фото товаров v2 привязаны к модели (части названия из прайса), а не к
 * номеру строки: номер у консультанта строится из названия и номера строки и
 * меняется при каждой загрузке прайса.
 */
const p = (name: string, colors: string[] = []): ConsultantProduct => ({
  id: name,
  name,
  category: "",
  size: "",
  colors,
  price_kzt: 1000,
  stock: true,
});
const media = (match: string, extra: Partial<ProductMedia> = {}): ProductMedia => ({
  id: match,
  match,
  path: "bot/x.jpg",
  kind: "image",
  createdAt: "",
  ...extra,
});

describe("фото товаров: привязка к модели", () => {
  it("модель подходит всем размерам и цветам; «х» и «x» в размере — одно", () => {
    const towel = p("Uchino Полотенце махровое Zero Twist, 70x140, белый");
    // Слова модели — в любом порядке и с чем угодно между ними.
    expect(mediaMatchesProduct(media("Uchino Zero Twist"), towel)).toBe(true);
    expect(mediaMatchesProduct(media("Zero Twist"), towel)).toBe(true);
    expect(mediaMatchesProduct(media("Uchino Air Waffle"), towel)).toBe(false);
    expect(
      mediaMatchesProduct(
        media("Les Fleurs 70х140"),
        p("Bedding House PIP Полотенце махровое Les Fleurs 70x140, цвет белый"),
      ),
    ).toBe(true);
    expect(normalizeForMatch("70 Х 140")).toBe("70x140");
  });

  it("фото с цветом — только этому цвету; с цветом — раньше общего, фото — раньше видео", () => {
    const white = media("Zero Twist", { id: "w", color: "белый" });
    const video = media("Zero Twist", { id: "v", kind: "video" });
    const general = media("Zero Twist", { id: "g" });
    const grey = p("Uchino Полотенце махровое Zero Twist, 70x140, серый", ["серый"]);
    const whiteTowel = p("Uchino Полотенце махровое Zero Twist, 70x140, белый", ["белый"]);
    expect(mediaForProduct([video, general, white], grey).map((m) => m.id)).toEqual(["g", "v"]);
    expect(mediaForProduct([video, general, white], whiteTowel).map((m) => m.id)).toEqual([
      "w",
      "g",
      "v",
    ]);
  });

  it("битая запись в настройках не роняет список", () => {
    expect(parseProductMedia("не json")).toEqual([]);
    expect(parseProductMedia(JSON.stringify([media("A B C"), { id: 1 }]))).toHaveLength(1);
  });
});
