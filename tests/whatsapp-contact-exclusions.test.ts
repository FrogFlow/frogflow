import { describe, expect, it } from "vitest";
import {
  isExcludedWhatsAppSender,
  normalizeExcludedWhatsAppPhones,
} from "../src/lib/whatsapp-contact-exclusions";

describe("WhatsApp contact exclusions", () => {
  it("normalizes pasted numbers and removes duplicates", () => {
    expect(
      normalizeExcludedWhatsAppPhones("+7 705 123-45-67\n8 (705) 123-45-67; +7 777 000 11 22"),
    ).toEqual(["77051234567", "77770001122"]);
  });

  it("matches the webhook phone across Kazakhstan/Russia formats", () => {
    expect(
      isExcludedWhatsAppSender({
        senderPhone: "+77051234567",
        senderId: "KZ.123",
        excludedPhones: "8 705 123 45 67",
      }),
    ).toBe(true);
  });

  it("falls back to a numeric sender id and ignores invalid entries", () => {
    expect(
      isExcludedWhatsAppSender({
        senderId: "77051234567",
        excludedPhones: "мама\n+7 705 123 45 67",
      }),
    ).toBe(true);
    expect(
      isExcludedWhatsAppSender({
        senderId: "77050000000",
        excludedPhones: "мама\n123",
      }),
    ).toBe(false);
  });
});
