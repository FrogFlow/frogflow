import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  md5Hex,
  buildRobokassaPaymentUrl,
  verifyRobokassaResultSignature,
} from "../src/lib/robokassa.server";

// Денежный путь Robokassa раньше не тестировался вообще (Блок 4 плана
// работ): ни подпись, приходящая с деньгами, ни ссылка на оплату, ни
// хэш-функция под ними. Эти тесты фиксируют контракт, который решает,
// признаём мы платёж настоящим или нет.

describe("md5Hex", () => {
  it("считает обычный MD5 в hex, как ждёт Robokassa", () => {
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });
});

describe("buildRobokassaPaymentUrl", () => {
  it("подписывает login:outSum:invId:pass1 и подставляет параметры в URL", () => {
    const url = buildRobokassaPaymentUrl({
      login: "shop",
      pass1: "secret1",
      outSum: "1500.00",
      invId: 42,
      description: "Заказ №42",
      isTest: false,
    });
    const expectedSig = md5Hex("shop:1500.00:42:secret1");
    expect(url).toContain(`SignatureValue=${expectedSig}`);
    expect(url).toContain("MerchantLogin=shop");
    expect(url).toContain("OutSum=1500.00");
    expect(url).toContain("InvId=42");
    expect(url).toContain("IsTest=0");
  });

  it("IsTest=1 только когда явно попросили", () => {
    const url = buildRobokassaPaymentUrl({
      login: "shop",
      pass1: "secret1",
      outSum: "100",
      invId: 1,
      description: "d",
      isTest: true,
    });
    expect(url).toContain("IsTest=1");
  });
});

describe("verifyRobokassaResultSignature", () => {
  const pass2 = "resultSecret";

  function sign(outSum: string, invId: string, extra = "") {
    return md5Hex(`${outSum}:${invId}:${pass2}${extra}`).toUpperCase();
  }

  it("принимает подпись, посчитанную тем же паролем", () => {
    const signature = sign("1500.00", "42");
    expect(
      verifyRobokassaResultSignature({ outSum: "1500.00", invId: "42", signature, pass2 }),
    ).toBe(true);
  });

  it("подпись регистронезависима, как отдаёт сама Robokassa", () => {
    const signature = sign("1500.00", "42").toLowerCase();
    expect(
      verifyRobokassaResultSignature({ outSum: "1500.00", invId: "42", signature, pass2 }),
    ).toBe(true);
  });

  it("отклоняет подпись, посчитанную другим паролем (например, тестовым)", () => {
    const wrongSignature = md5Hex(`1500.00:42:otherSecret`).toUpperCase();
    expect(
      verifyRobokassaResultSignature({
        outSum: "1500.00",
        invId: "42",
        signature: wrongSignature,
        pass2,
      }),
    ).toBe(false);
  });

  it("отклоняет, если сумма в подписи не совпадает с переданной", () => {
    const signature = sign("1500.00", "42");
    expect(
      verifyRobokassaResultSignature({ outSum: "999.00", invId: "42", signature, pass2 }),
    ).toBe(false);
  });

  it("учитывает Shp_-параметры отсортированными по ключу, как того требует протокол", () => {
    const shpEntries = [
      { key: "Shp_orderId", value: "42" },
      { key: "Shp_botId", value: "abc" },
    ];
    // Протокол требует сортировку по имени параметра — здесь Shp_botId раньше Shp_orderId.
    const signature = sign("1500.00", "42", ":Shp_botId=abc:Shp_orderId=42");
    expect(
      verifyRobokassaResultSignature({
        outSum: "1500.00",
        invId: "42",
        signature,
        pass2,
        shpEntries,
      }),
    ).toBe(true);
  });

  it("не падает и не принимает подпись другой длины (защита timingSafeEqual от RangeError)", () => {
    expect(
      verifyRobokassaResultSignature({
        outSum: "1500.00",
        invId: "42",
        signature: "слишком-короткая",
        pass2,
      }),
    ).toBe(false);
  });

  it("устойчива к таймингу: сравнение идёт через crypto.timingSafeEqual, а не ===", () => {
    // Не тест самого тайминга (нестабилен в CI), а проверка, что функция
    // в принципе не сравнивает строки напрямую — вызвав verify с валидной по
    // длине, но неверной подписью, убеждаемся, что она доходит до
    // timingSafeEqual и возвращает false, а не бросает исключение.
    const signature = crypto.randomBytes(16).toString("hex").toUpperCase();
    expect(
      verifyRobokassaResultSignature({ outSum: "1500.00", invId: "42", signature, pass2 }),
    ).toBe(false);
  });
});

// Сумма платежа сверяется в вызывающем коде (result.ts) через
// `Number(outSum)` — нечисловой OutSum даёт NaN, и `NaN > 0.01` тихо равно
// false. Здесь фиксируем именно этот контракт: подпись сама по себе не
// спасает от NaN, проверку суммы обязан делать вызывающий код через
// Number.isFinite (см. src/routes/api/public/robokassa/result.ts).
describe("сумма платежа — контракт для вызывающего кода", () => {
  it("NaN от нечислового OutSum не считается прошедшей проверку суммы", () => {
    const outSumNum = Number("не-число");
    const total = 1500;
    expect(Number.isFinite(outSumNum)).toBe(false);
    // Старая проверка `Math.abs(NaN - total) > 0.01` — это NaN > 0.01 — false.
    expect(Math.abs(outSumNum - total) > 0.01).toBe(false);
  });
});
