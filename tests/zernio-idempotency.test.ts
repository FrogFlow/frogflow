import { describe, it, expect } from "vitest";
import { runWithZernioEvent, idempotencyKeyFor } from "../src/lib/zernio-event-context.server";

/**
 * Ключ идемпотентности легко испортить незаметно: ошибёшься в одну сторону —
 * клиент получит два одинаковых сообщения при повторной доставке вебхука,
 * ошибёшься в другую — законный повтор будет молча проглочен как дубль.
 * Ни то, ни другое не видно ни в логах, ни в типах, поэтому проверяется здесь.
 */
describe("idempotencyKeyFor", () => {
  const body = { accountId: "acc-1", message: "Здравствуйте" };

  it("повтор того же события даёт тот же ключ", async () => {
    const first = await runWithZernioEvent("evt-1", async () => idempotencyKeyFor(body));
    const second = await runWithZernioEvent("evt-1", async () => idempotencyKeyFor(body));
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it("разные события с тем же текстом дают разные ключи", async () => {
    const first = await runWithZernioEvent("evt-1", async () => idempotencyKeyFor(body));
    const second = await runWithZernioEvent("evt-2", async () => idempotencyKeyFor(body));
    expect(second).not.toBe(first);
  });

  it("разные сообщения внутри одного события дают разные ключи", async () => {
    await runWithZernioEvent("evt-1", async () => {
      const a = idempotencyKeyFor({ ...body, message: "Первое" });
      const b = idempotencyKeyFor({ ...body, message: "Второе" });
      expect(a).not.toBe(b);
    });
  });

  it("вне обработки события ключа нет — ручную отправку подавлять нельзя", () => {
    expect(idempotencyKeyFor(body)).toBeUndefined();
  });

  it("без идентификатора события контекст не выставляется", async () => {
    const key = await runWithZernioEvent(null, async () => idempotencyKeyFor(body));
    expect(key).toBeUndefined();
  });

  it("контекст не протекает наружу после обработки", async () => {
    await runWithZernioEvent("evt-1", async () => idempotencyKeyFor(body));
    expect(idempotencyKeyFor(body)).toBeUndefined();
  });
});
