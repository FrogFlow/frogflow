import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { priceRub } from "../src/lib/consultant/rate";
import { searchProducts, getProduct, type ConsultantProduct } from "../src/lib/consultant/catalog";
import {
  matchCountry,
  matchPurchaseIntent,
  containsForbiddenPhrase,
} from "../src/lib/consultant/intent";
import { validateConsultantReply } from "../src/lib/consultant/validate";
import { presentCard } from "../src/lib/consultant/tools";
import { isAutomationPaused, isBotEcho, readConsultantState } from "../src/lib/consultant/state";
import { consultantCopy } from "../src/lib/consultant/copy";
import { DEFAULT_CONSULTANT_MODEL, consultantModel } from "../src/lib/consultant/config";

const towel: ConsultantProduct = {
  id: "t1",
  name: "Полотенце банное",
  category: "towels",
  size: "70x140",
  colors: ["белый", "серый"],
  price_kzt: 45000,
  stock: true,
  stock_qty: 3,
};

describe("consultant — курс и карточка", () => {
  it("RUB = ₸ / (VTB buy × 0.95): 45000 / (5.15 × 0.95) = 9198", () => {
    expect(priceRub(45000, 5.15)).toBe(9198);
  });

  it("presentCard считает RUB на backend, не оставляет это модели", () => {
    const card = presentCard(towel, "RU", 5.15);
    expect(card.price_rub).toBe(9198);
    expect(presentCard(towel, "KZ", 5.15).price_rub).toBeNull();
  });
});

describe("consultant — поиск по снимку, не по памяти модели", () => {
  it("находит по размеру и цвету", async () => {
    const found = await searchProducts({ size: "70×140", color: "белый" }, [towel]);
    expect(found.map((p) => p.id)).toEqual(["t1"]);
  });

  it("пустой снимок — пустой результат, не догадка", async () => {
    expect(await searchProducts({ query: "полотенце" }, [])).toEqual([]);
  });

  it("get_product не возвращает чужой id", async () => {
    expect(await getProduct("missing", [towel])).toBeNull();
    expect((await getProduct("t1", [towel]))?.price_kzt).toBe(45000);
  });
});

describe("consultant — намерения", () => {
  it("покупка и менеджер — handoff", () => {
    expect(matchPurchaseIntent("давайте оформляем")).toBe(true);
    expect(matchPurchaseIntent("беру, куда платить")).toBe(true);
    expect(matchPurchaseIntent("свяжите с менеджером")).toBe(true);
    expect(matchPurchaseIntent("есть полотенце 70x140?")).toBe(false);
  });

  it("страна KZ/RU", () => {
    expect(matchCountry("Казахстан")).toBe("KZ");
    expect(matchCountry("я из России")).toBe("RU");
    expect(matchCountry("полотенце")).toBeNull();
  });
});

describe("consultant — валидатор ответа", () => {
  it("режет запрещённые фразы", () => {
    expect(containsForbiddenPhrase("Отлично, сейчас подберу")).toBe(true);
    expect(validateConsultantReply("Отлично, есть за 45000", [towel]).ok).toBe(false);
  });

  it("режет цену, которой не было в tools", () => {
    expect(validateConsultantReply("Стоит 99999 тенге", [towel]).ok).toBe(false);
    expect(validateConsultantReply("Цена 45 000 ₸", [towel]).ok).toBe(true);
  });

  it("пустой ответ не отправляем", () => {
    expect(validateConsultantReply("   ", []).ok).toBe(false);
  });
});

describe("consultant — pause / echo", () => {
  it("paused state блокирует исходящие", () => {
    expect(isAutomationPaused({ automation_paused: true })).toBe(true);
    expect(isAutomationPaused({})).toBe(false);
  });

  it("своё исходящее не считает вмешательством менеджера", () => {
    expect(
      isBotEcho(
        {
          last_bot_reply:
            "Спасибо! В ближайшее время с вами свяжется менеджер для оформления заказа.",
        },
        consultantCopy.purchase,
      ),
    ).toBe(true);
    expect(isBotEcho({ last_bot_reply: "Спасибо!" }, "Здравствуйте, это менеджер")).toBe(false);
  });

  it("state читается из вложенного ключа и не ломает shop DirectState", () => {
    const raw = {
      mode: "awaiting_country",
      consultant: { country: "KZ", automation_paused: true },
    };
    expect(readConsultantState(raw)).toEqual({ country: "KZ", automation_paused: true });
    expect(readConsultantState({ mode: "awaiting_proof" })).toEqual({});
  });
});

describe("consultant — model config", () => {
  const original = process.env.CONSULTANT_MODEL;
  afterEach(() => {
    if (original === undefined) delete process.env.CONSULTANT_MODEL;
    else process.env.CONSULTANT_MODEL = original;
  });

  it("по умолчанию Haiku 4.5, имя можно сменить ENV", () => {
    delete process.env.CONSULTANT_MODEL;
    expect(consultantModel()).toBe(DEFAULT_CONSULTANT_MODEL);
    process.env.CONSULTANT_MODEL = "claude-sonnet-4-6";
    expect(consultantModel()).toBe("claude-sonnet-4-6");
  });
});

describe("consultant — decideConsultantReply без магазинного чекаута", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("покупка → регламентированный handoff и pause", async () => {
    const { decideConsultantReply } = await import("../src/lib/consultant/handle-message");
    const res = await decideConsultantReply("оформляем", {});
    expect(res?.text).toBe(consultantCopy.purchase);
    expect(res?.patch.automation_paused).toBe(true);
    expect(res?.patch.pause_reason).toBe("purchase");
  });

  it("без страны — сначала KZ/RU, не поиск товара", async () => {
    const { decideConsultantReply } = await import("../src/lib/consultant/handle-message");
    const res = await decideConsultantReply("есть белое полотенце?", {});
    expect(res?.text).toBe(consultantCopy.askCountry);
    expect(res?.patch.conversation_state).toBe("awaiting_country");
  });
});
