import { describe, expect, it } from "vitest";
import {
  WHATSAPP_START_PROMPT,
  isStartToken,
  isZernioStartIntent,
  resolveWhatsAppStartPrompt,
  whatsappActivationAction,
} from "../src/lib/whatsapp-activation";

describe("WhatsApp activation gate", () => {
  it.each(["здравствуйте", "https://example.com/product", "photo"])(
    "prompts once for the first incoming %s",
    () => {
      expect(
        whatsappActivationAction({
          platform: "whatsapp",
          state: {},
          isStartCommand: false,
          hasIncomingContent: true,
          startPromptEnabled: true,
        }),
      ).toBe("prompt");
    },
  );

  it("waits silently after the prompt until /start", () => {
    expect(
      whatsappActivationAction({
        platform: "whatsapp",
        state: { start_prompted_at: "2026-08-23T00:00:00.000Z" },
        isStartCommand: false,
        hasIncomingContent: true,
        startPromptEnabled: true,
      }),
    ).toBe("wait");
  });

  it("starts the existing flow when /start arrives", () => {
    expect(
      whatsappActivationAction({
        platform: "whatsapp",
        state: { start_prompted_at: "2026-08-23T00:00:00.000Z" },
        isStartCommand: true,
        hasIncomingContent: true,
        startPromptEnabled: true,
      }),
    ).toBe("start");
  });

  it("restarts an activated or in-progress WhatsApp flow on /start", () => {
    expect(
      whatsappActivationAction({
        platform: "whatsapp",
        state: { locale: "ru" },
        isStartCommand: true,
        hasIncomingContent: true,
        startPromptEnabled: true,
      }),
    ).toBe("start");
    expect(
      whatsappActivationAction({
        platform: "whatsapp",
        state: { locale: "ru", mode: "awaiting_proof" },
        isStartCommand: true,
        hasIncomingContent: true,
        startPromptEnabled: true,
      }),
    ).toBe("start");
  });

  it("restarts Instagram on /start so a CMD «Купить» button wakes the shop", () => {
    expect(
      whatsappActivationAction({
        platform: "instagram",
        state: {},
        isStartCommand: true,
        hasIncomingContent: true,
        startPromptEnabled: true,
      }),
    ).toBe("start");
    expect(
      whatsappActivationAction({
        platform: "instagram",
        state: { locale: "ru", mode: "awaiting_locale" },
        isStartCommand: true,
        hasIncomingContent: true,
        startPromptEnabled: true,
      }),
    ).toBe("start");
  });

  it("does not intercept Instagram or an activated WhatsApp flow", () => {
    expect(
      whatsappActivationAction({
        platform: "instagram",
        state: {},
        isStartCommand: false,
        hasIncomingContent: true,
        startPromptEnabled: true,
      }),
    ).toBe("continue");
    expect(
      whatsappActivationAction({
        platform: "whatsapp",
        state: { locale: "ru" },
        isStartCommand: false,
        hasIncomingContent: true,
        startPromptEnabled: true,
      }),
    ).toBe("continue");
  });

  it("can disable only the first auto-reply while keeping /start active", () => {
    expect(
      whatsappActivationAction({
        platform: "whatsapp",
        state: {},
        isStartCommand: false,
        hasIncomingContent: true,
        startPromptEnabled: false,
      }),
    ).toBe("wait");
    expect(
      whatsappActivationAction({
        platform: "whatsapp",
        state: {},
        isStartCommand: true,
        hasIncomingContent: true,
        startPromptEnabled: false,
      }),
    ).toBe("start");
  });

  it("uses the requested activation text", () => {
    expect(WHATSAPP_START_PROMPT).toContain("/start");
  });

  it("uses the configured activation text and falls back for a blank value", () => {
    expect(resolveWhatsAppStartPrompt("  Напишите /start, чтобы начать  ")).toBe(
      "Напишите /start, чтобы начать",
    );
    expect(resolveWhatsAppStartPrompt("   ")).toBe(WHATSAPP_START_PROMPT);
  });
});

describe("Instagram CMD start intent", () => {
  const triggers = ["заказать", "купить", "магазин", "каталог", "/start"];

  it("treats a hidden /start payload as start even when the chat shows «купить»", () => {
    expect(isZernioStartIntent("Купить", "/start", triggers)).toBe(true);
    expect(isZernioStartIntent("купить", "/START", triggers)).toBe(true);
    expect(isStartToken("/start")).toBe(true);
    expect(isStartToken("start")).toBe(true);
  });

  it("treats a CMD payload that is itself a trigger word as start", () => {
    expect(isZernioStartIntent("Купить", "купить", triggers)).toBe(true);
  });

  it("does not wake the shop on a typed «купить» without a postback", () => {
    expect(isZernioStartIntent("купить", null, triggers)).toBe(false);
    expect(isZernioStartIntent("Купить", "", triggers)).toBe(false);
  });

  it("ignores native Zernio ACT:: buttons and ordinary chat", () => {
    expect(
      isZernioStartIntent("Я подписался", "ACT::cc82e5ebd3b465e3243fde66982ba8d0", triggers),
    ).toBe(false);
    expect(isZernioStartIntent("привет", null, triggers)).toBe(false);
  });
});
