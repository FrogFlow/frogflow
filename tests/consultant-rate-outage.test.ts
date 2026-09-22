import { describe, expect, it } from "vitest";
import {
  cleanRateExcuses,
  collapseManagerPromises,
  promisesManagerFollowUp,
} from "../src/lib/consultant/validate";
import { HANDOFF_TO_MANAGER_REPLY, PHOTO_FROM_MANAGER_NOTE } from "../src/lib/consultant/copy";

/**
 * Живой тест 22.09 в bovi_kz. Покупателю назвали цену полотенца в тенге, он
 * попросил в рублях — курс в этот момент не подтянулся, и бот ответил разом:
 *
 *   К сожалению, сейчас курс недоступен. Точную сумму в рублях подтвердит
 *   менеджер по актуальному курсу.
 *
 *   Спасибо. Я передам ваш вопрос менеджеру — он скоро с вами свяжется.
 *
 * Два разных сбоя в одном сообщении: наружу вылезла внутренняя поломка
 * («курс недоступен» — это про наш крон, а не про магазин), и менеджер
 * обещан дважды. Задачу при этом не завели ни разу: обе фразы проходили
 * мимо страховки «обещал и не сделал».
 */
const LIVE_REPLY =
  "К сожалению, сейчас курс недоступен. Точную сумму в рублях подтвердит менеджер по актуальному курсу.\n\n" +
  "Спасибо. Я передам ваш вопрос менеджеру — он скоро с вами свяжется.";

const clean = (text: string) => collapseManagerPromises(cleanRateExcuses(text));

describe("недоступный курс рубля", () => {
  it("из живого ответа остаётся одна фраза — та, что по делу", () => {
    expect(clean(LIVE_REPLY)).toBe("Точную сумму в рублях подтвердит менеджер по актуальному курсу.");
  });

  it("покупатель не узнаёт про наш курс", () => {
    expect(clean(LIVE_REPLY)).not.toMatch(/курс недоступен/i);
    for (const excuse of [
      "К сожалению, сейчас курс недоступен.",
      "Курс рубля сейчас не доступен.",
      "Актуальный курс отсутствует.",
      "Не могу пересчитать в рубли.",
    ]) {
      expect(cleanRateExcuses(`${excuse} Полотенце — 52 000 ₸.`)).toBe("Полотенце — 52 000 ₸.");
    }
  });

  it("если отговорка была всем ответом, молчать не начинаем", () => {
    expect(cleanRateExcuses("К сожалению, сейчас курс недоступен.")).toBe(
      "К сожалению, сейчас курс недоступен.",
    );
  });

  it("теперь по такому ответу заводится задача менеджеру", () => {
    expect(promisesManagerFollowUp(clean(LIVE_REPLY))).toBe(true);
    expect(promisesManagerFollowUp(HANDOFF_TO_MANAGER_REPLY)).toBe(true);
  });
});

describe("две фразы про менеджера подряд", () => {
  it("дежурная уходит, когда рядом уже сказано, что сделает менеджер", () => {
    expect(
      collapseManagerPromises(`Размер 50x80, цена 52 000 ₸. Фото пришлёт менеджер.\n\n${HANDOFF_TO_MANAGER_REPLY}`),
    ).toBe("Размер 50x80, цена 52 000 ₸. Фото пришлёт менеджер.");
  });

  it("«Спасибо.» не остаётся висеть само по себе", () => {
    expect(clean(LIVE_REPLY)).not.toMatch(/^Спасибо\.$/m);
  });

  it("одна дежурная фраза — это правильный ответ, её не трогаем", () => {
    expect(collapseManagerPromises(HANDOFF_TO_MANAGER_REPLY)).toBe(HANDOFF_TO_MANAGER_REPLY);
  });

  it("приписку про фото не режет и за обещание не считает", () => {
    const withPhoto = `Полотенце Uchino Merveille 50x80 — 52 000 ₸.\n\n${PHOTO_FROM_MANAGER_NOTE}`;
    expect(clean(withPhoto)).toBe(withPhoto);
    expect(promisesManagerFollowUp(withPhoto)).toBe(false);
  });

  it("обычный ответ по товару проходит насквозь", () => {
    const normal = "Полотенце Uchino Merveille 50x80 белого цвета — 52 000 ₸. В наличии.";
    expect(clean(normal)).toBe(normal);
    expect(promisesManagerFollowUp(normal)).toBe(false);
  });

  it("закрытие заказа не считается обещанием ответа", () => {
    expect(
      promisesManagerFollowUp("Спасибо! В ближайшее время с вами свяжется менеджер для оформления заказа."),
    ).toBe(false);
    expect(
      promisesManagerFollowUp(
        "Сейчас нерабочие часы магазина — наш менеджер свяжется с вами утром для оформления заказа",
      ),
    ).toBe(false);
  });
});
