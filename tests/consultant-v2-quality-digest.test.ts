import { describe, it, expect } from "vitest";
import type { ConsultantProduct } from "../src/lib/consultant/catalog";
import {
  buildQualityDigest,
  previousAlmatyDay,
  type DigestRun,
} from "../src/lib/consultant-v2/quality-digest";

/** Сводка качества за сутки: считает код, без модели. */

const catalog: ConsultantProduct[] = [
  {
    id: "pip",
    name: "PIP Полотенце махровое Les Fleurs 55х100",
    category: "Полотенца",
    size: "55х100",
    colors: ["бежевый"],
    price_kzt: 15000,
    stock: true,
  },
];

const run = (over: Partial<DigestRun>): DigestRun => ({
  conversation_id: "c1",
  incoming_text: "Цена?",
  reply_text: "55х100 — 15 000 ₸. Какой размер нужен?",
  reply_kind: "product",
  status: "replied",
  model: "claude-haiku-4-5-20251001",
  token_usage: { usd: 0.01 },
  tool_trace: [],
  ...over,
});

describe("сводка качества за сутки", () => {
  it("ответов не было — сводки нет", () => {
    expect(buildQualityDigest([], catalog, { day: "2026-09-24" })).toBeNull();
    expect(
      buildQualityDigest([run({ status: "cancelled", reply_text: null })], catalog, {
        day: "2026-09-24",
      }),
    ).toBeNull();
  });

  it("счёт ответов, передач, замечаний и расхода", () => {
    const text = buildQualityDigest(
      [
        run({}),
        run({
          conversation_id: "c2",
          reply_text: "Отличный выбор! Это премиальные полотенца. Какой размер? Какой цвет?",
        }),
        run({ conversation_id: "c3", reply_kind: "handoff", reply_text: "Опт ведёт менеджер." }),
        run({ conversation_id: "c4", status: "cancelled", reply_text: null }),
      ],
      catalog,
      { day: "2026-09-24" },
    )!;
    expect(text).toContain("за 24.09");
    expect(text).toContain("Диалогов: 4, ответов бота: 3.");
    expect(text).toContain("Передано менеджеру: 1, отвечал менеджер (бот молчал): 1.");
    expect(text).toContain("Ответы без замечаний: 2 из 3 (67%).");
    expect(text).toMatch(/Замечания: [^\n]*рекламные слова 1/);
    expect(text).toContain("Расход модели: $0.04");
  });

  it("тень v2 — рядом с v1 на тех же сообщениях, с примерами", () => {
    const text = buildQualityDigest(
      [
        run({
          reply_text: "Отличный выбор! Премиальные полотенца. Какой размер? Какой цвет?",
          tool_trace: [
            { tools: ["search_products"] },
            {
              shadow_v2: {
                text: "55х100 — 15 000 ₸. Какой размер нужен?",
                kind: "product",
                usd: 0.004,
              },
            },
          ],
        }),
      ],
      catalog,
      { day: "2026-09-24" },
    )!;
    expect(text).toContain("Тень v2 — те же 1 сообщений");
    expect(text).toContain("без замечаний v1 0%, v2 100%; v2 чище в 1, хуже в 0.");
    expect(text).toContain("Примеры:");
    expect(text).toContain("v2: 55х100 — 15 000 ₸.");
  });
});

describe("сутки по Алматы", () => {
  it("утром 26.09 по Алматы — сводка за 25.09", () => {
    expect(previousAlmatyDay(new Date("2026-09-26T04:30:00Z"))).toEqual({
      day: "2026-09-25",
      from: "2026-09-24T19:00:00.000Z",
      to: "2026-09-25T19:00:00.000Z",
    });
  });
});
