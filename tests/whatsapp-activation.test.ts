import { describe, expect, it } from "vitest";
import { WHATSAPP_START_PROMPT, whatsappActivationAction } from "../src/lib/whatsapp-activation";

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
      }),
    ).toBe("continue");
    expect(
      whatsappActivationAction({
        platform: "whatsapp",
        state: { locale: "ru" },
        isStartCommand: false,
        hasIncomingContent: true,
      }),
    ).toBe("continue");
  });

  it("uses the requested activation text", () => {
    expect(WHATSAPP_START_PROMPT).toContain("/start");
  });
});
