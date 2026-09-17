import { describe, expect, it } from "vitest";
import { getAlmatyHour, isOffHoursInAlmaty } from "./rate";
import { AB_COPY, TZ_COPY, formatStoreLocationReply } from "./copy";
import { isStoreLocationOrPickupIntent } from "./intent";
import {
  DEFAULT_KNOWLEDGE_ARTICLES,
  formatKnowledgeForPrompt,
  parseKnowledgeArticlesFromText,
} from "./knowledge";

describe("BOVI Consultant Features", () => {
  describe("Almaty Time & Off-Hours", () => {
    it("correctly determines Almaty hour (UTC+5)", () => {
      // 16:30 UTC -> 21:30 in Almaty
      const d1 = new Date("2026-09-17T16:30:00Z");
      expect(getAlmatyHour(d1)).toBe(21);
      expect(isOffHoursInAlmaty(d1)).toBe(true);

      // 09:00 UTC -> 14:00 in Almaty
      const d2 = new Date("2026-09-17T09:00:00Z");
      expect(getAlmatyHour(d2)).toBe(14);
      expect(isOffHoursInAlmaty(d2)).toBe(false);

      // 03:00 UTC -> 08:00 in Almaty (morning, before 10)
      const d3 = new Date("2026-09-17T03:00:00Z");
      expect(getAlmatyHour(d3)).toBe(8);
      expect(isOffHoursInAlmaty(d3)).toBe(true);
    });

    it("has off-hours copy configured for nighttime orders", () => {
      const nightDate = new Date("2026-09-17T16:30:00Z"); // 21:30 Almaty
      expect(isOffHoursInAlmaty(nightDate)).toBe(true);
      expect(AB_COPY.purchaseOffHours).toContain("рабочее время");
      expect(TZ_COPY.purchaseOffHours).toContain("рабочее время");

      const dayDate = new Date("2026-09-17T09:00:00Z"); // 14:00 Almaty
      expect(isOffHoursInAlmaty(dayDate)).toBe(false);
      expect(AB_COPY.purchase).toContain("свяжется");
      expect(AB_COPY.purchase).not.toContain("нерабочие часы");
    });
  });

  describe("Store Location and Pickup Intent", () => {
    it("recognizes location, address, and pickup queries", () => {
      expect(isStoreLocationOrPickupIntent("Где вы находитесь?")).toBe(true);
      expect(isStoreLocationOrPickupIntent("Какой у вас адрес в Алматы?")).toBe(true);
      expect(isStoreLocationOrPickupIntent("Хочу приехать посмотреть текстиль вживую")).toBe(true);
      expect(isStoreLocationOrPickupIntent("Можно ли забрать заказ самовывозом?")).toBe(true);
      expect(isStoreLocationOrPickupIntent("Вы в ТЦ Колибри?")).toBe(true);
      expect(isStoreLocationOrPickupIntent("Где ваш магазин?")).toBe(true);
    });

    it("does not trigger on general catalog questions", () => {
      expect(isStoreLocationOrPickupIntent("Сколько стоит комплект евро сатин?")).toBe(false);
      expect(isStoreLocationOrPickupIntent("Есть ли доставка по Казахстану?")).toBe(false);
      expect(isStoreLocationOrPickupIntent("Какие размеры одеял есть в наличии?")).toBe(false);
    });

    it("formats store location reply with address, hours, and phone", () => {
      const reply = formatStoreLocationReply({
        address: "г. Алматы, ул. Сатпаева 3, ТЦ COLIBRI, 1 этаж",
        phone: "+7 (777) 333 08 08",
        hours: "Ежедневно с 10:00 до 21:00",
      });
      expect(reply).toContain("г. Алматы, ул. Сатпаева 3, ТЦ COLIBRI, 1 этаж");
      expect(reply).toContain("+7 (777) 333 08 08");
      expect(reply).toContain("10:00 до 21:00");
      expect(reply).toContain("вживую");
    });
  });

  describe("Knowledge Base Articles", () => {
    it("parses articles with tags from text", () => {
      const raw = `
### Фабрика в Португалии [португалия, фабрика, европа]
Премиальная линия BOVI производится на фабрике в Португалии.

### Сатин 300 TC [сатин, хлопок, 300tc]
Комплекты шьются из мерсеризованного хлопка высшего сорта.
`;
      const articles = parseKnowledgeArticlesFromText(raw);
      expect(articles).toHaveLength(2);
      expect(articles[0].title).toBe("Фабрика в Португалии");
      expect(articles[0].tags).toEqual(["португалия", "фабрика", "европа"]);
      expect(articles[0].content).toContain("Португалии");
      expect(articles[1].title).toBe("Сатин 300 TC");
      expect(articles[1].tags).toEqual(["сатин", "хлопок", "300tc"]);
    });

    it("formats knowledge articles for system prompt", () => {
      const promptText = formatKnowledgeForPrompt(DEFAULT_KNOWLEDGE_ARTICLES);
      expect(promptText).toContain("OEKO-TEX Standard 100");
      expect(promptText).toContain("Combed Cotton");
      expect(promptText).toContain("300 TC");
      expect(promptText).toContain("swan down");
    });
  });
});
