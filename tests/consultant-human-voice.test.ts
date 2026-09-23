import { describe, expect, it } from "vitest";
import { buildConsultantSystemPrompt } from "../src/lib/consultant/claude";
import { humanizePunctuation } from "../src/lib/consultant/style";
import { HANDOFF_TO_MANAGER_REPLY } from "../src/lib/consultant/copy";

/**
 * Продавец 23.09: «Задача по простому — чтобы не говорил как ИИ — ближе к
 * реальному человеку и поменьше длинных рассуждений. Только по сути».
 */
describe("голос живого продавца", () => {
  it("длинное тире с пробелами становится дефисом, как с телефона", () => {
    expect(humanizePunctuation("• 55х100 см — 18 000 ₸\n• 70х140 см – 35 000 ₸")).toBe(
      "• 55х100 см - 18 000 ₸\n• 70х140 см - 35 000 ₸",
    );
  });

  it("слитные дефисы и диапазоны не трогаем", () => {
    const t = "темно-синий, от 33 116 до 75 695 ₽";
    expect(humanizePunctuation(t)).toBe(t);
  });

  it("дежурная фраза передачи без тире", () => {
    expect(HANDOFF_TO_MANAGER_REPLY).not.toMatch(/[—–]/);
  });

  it("промпт открывается ролью продавца и живыми примерами, а не «экспертным консультантом»", () => {
    const prompt = buildConsultantSystemPrompt([], null);
    expect(prompt.startsWith("КТО ВЫ И КАК ПИШЕТЕ")).toBe(true);
    expect(prompt).not.toMatch(/умный, заботливый, экспертный/);
    expect(prompt).toContain("Хорошо: «Перешлите сюда этот пост, подскажу цену.»");
  });
});
