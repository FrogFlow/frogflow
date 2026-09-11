import { describe, it, expect, afterEach } from "vitest";
import { currentVertical, currentVerticalDef } from "./vertical.server";
import {
  VERTICAL_KEYS,
  isConsultantVertical,
  isPhysicalShopVertical,
  verticalDef,
} from "./registry";
import { SUPPORTED_LOCALES } from "@/lib/i18n";

const ORIGINAL_VERTICAL = process.env.VERTICAL;

afterEach(() => {
  if (ORIGINAL_VERTICAL === undefined) delete process.env.VERTICAL;
  else process.env.VERTICAL = ORIGINAL_VERTICAL;
});

describe("currentVertical — deploy-level discriminator, mirrors CONTROL_PLANE", () => {
  it("падает в digital, когда VERTICAL не задан — семь живых деплоев не должны заметить разницу", () => {
    delete process.env.VERTICAL;
    expect(currentVertical()).toBe("digital");
  });

  it("падает в digital на пустой строке", () => {
    process.env.VERTICAL = "  ";
    expect(currentVertical()).toBe("digital");
  });

  it("падает в digital на опечатке — не должна ронять магазин", () => {
    process.env.VERTICAL = "confectionary"; // опечатка: не confectionery
    expect(currentVertical()).toBe("digital");
  });

  it("подхватывает известную нишу", () => {
    process.env.VERTICAL = "confectionery";
    expect(currentVertical()).toBe("confectionery");
  });

  it("подхватывает consultant", () => {
    process.env.VERTICAL = "consultant";
    expect(currentVertical()).toBe("consultant");
  });

  it("currentVerticalDef() согласован с currentVertical()", () => {
    process.env.VERTICAL = "confectionery";
    expect(currentVerticalDef()).toBe(verticalDef("confectionery"));
  });
});

describe("mode — витрина vs консультант", () => {
  it("digital — shop, не physical-shop UI", () => {
    expect(verticalDef("digital").mode).toBe("shop");
    expect(isPhysicalShopVertical("digital")).toBe(false);
    expect(isConsultantVertical("digital")).toBe(false);
  });

  it("confectionery — shop + physical-shop UI", () => {
    expect(verticalDef("confectionery").mode).toBe("shop");
    expect(isPhysicalShopVertical("confectionery")).toBe(true);
    expect(isConsultantVertical("confectionery")).toBe(false);
  });

  it("consultant — физические товары, без UI кондитерской", () => {
    expect(verticalDef("consultant").mode).toBe("consultant");
    expect(verticalDef("consultant").defaultFulfillment).toBe("physical");
    expect(isPhysicalShopVertical("consultant")).toBe(false);
    expect(isConsultantVertical("consultant")).toBe(true);
    expect(verticalDef("consultant").suggestedModules).toEqual(["instagram", "manager_chat"]);
  });
});

describe("реестр ниш — полный пакет текстов на каждую нишу", () => {
  it.each(VERTICAL_KEYS)("%s объявляет копию для всех поддерживаемых локалей", (key) => {
    const def = verticalDef(key);
    for (const locale of SUPPORTED_LOCALES) {
      const c = def.locales[locale];
      expect(c, `${key}/${locale}`).toBeDefined();
      expect(c.welcomeGreeting.length).toBeGreaterThan(0);
      expect(c.welcomeCatalog.length).toBeGreaterThan(0);
      expect(c.welcomePayment.length).toBeGreaterThan(0);
      expect(c.contactBtn.length).toBeGreaterThan(0);
      expect(c.instructionComingSoon.length).toBeGreaterThan(0);
      expect(c.instructionDefaultCaption.length).toBeGreaterThan(0);
    }
  });

  it.each(VERTICAL_KEYS)("%s: профиль бота укладывается в лимит Telegram (512)", (key) => {
    const def = verticalDef(key);
    // botDescriptionIntro — только вводная часть; сама функция botPublicDescription
    // добавляет ссылки на оферту и обрезает итог до 512 символов, но вводная
    // часть одна не должна съедать весь лимит и не оставлять места на ссылки.
    expect(def.botDescriptionIntro.length).toBeLessThan(400);
  });

  it.each(VERTICAL_KEYS)("%s: короткое описание укладывается в лимит Telegram (120)", (key) => {
    const def = verticalDef(key);
    expect(def.shortDescription.length).toBeLessThanOrEqual(120);
  });
});
