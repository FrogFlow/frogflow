import { describe, expect, it } from "vitest";
import { findManagerMessage, MANAGER_LOOKBACK_MS } from "../src/lib/consultant/manager-guard";
import type { ConsultantState } from "../src/lib/consultant/state";

/**
 * Жалоба продавца: бот не понимает, что в чате уже отвечает менеджер, и не
 * умолкает. В базе это подтвердилось — тринадцать диалогов BOVI и ни одной
 * паузы с причиной manager_intervention.
 */
const NOW = Date.parse("2026-09-20T10:00:00.000Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function msg(direction: "incoming" | "outgoing", message: string, minutesAgo: number) {
  return { direction, message, createdAt: at(minutesAgo) } as never;
}

const state: ConsultantState = {
  last_bot_reply: "Полотенца Uchino 50x70 есть. Какой цвет предпочитаете?",
  last_bot_reply_at: at(30),
};

describe("менеджер в чате", () => {
  it("ловит ответ менеджера, даже если после него написал покупатель", () => {
    const found = findManagerMessage(
      [
        msg("incoming", "Какие есть полотенца?", 35),
        msg("outgoing", state.last_bot_reply!, 30),
        msg("outgoing", "Здравствуйте, это Айгуль, подберу вам комплект", 10),
        msg("incoming", "Спасибо, жду", 5),
      ],
      state,
      NOW,
    );
    expect(found?.text).toContain("Айгуль");
  });

  it("свой же ответ бота менеджером не считает", () => {
    const found = findManagerMessage(
      [msg("incoming", "привет", 31), msg("outgoing", state.last_bot_reply!, 30)],
      state,
      NOW,
    );
    expect(found).toBeNull();
  });

  it("сообщение бота, пришедшее в ленту с задержкой, тоже не менеджер", () => {
    // Отправили ответ, в ленте Zernio он появился на минуту позже.
    const found = findManagerMessage([msg("outgoing", state.last_bot_reply!, 29)], state, NOW);
    expect(found).toBeNull();
  });

  it("старое сообщение менеджера бота не глушит", () => {
    const old = { last_bot_reply: undefined, last_bot_reply_at: undefined } as ConsultantState;
    const longAgo = MANAGER_LOOKBACK_MS / 60_000 + 60;
    expect(findManagerMessage([msg("outgoing", "Добрый день", longAgo)], old, NOW)).toBeNull();
    expect(findManagerMessage([msg("outgoing", "Добрый день", 60)], old, NOW)?.text).toBe("Добрый день");
  });

  it("входящие сообщения менеджером не считаются", () => {
    expect(
      findManagerMessage([msg("incoming", "а можно скидку?", 1)], state, NOW),
    ).toBeNull();
  });

  it("менеджер недавно писал — молчим, даже если бот успел ответить после него", () => {
    // Ровно случай продавца: менеджер написал, бот перебил и ответил, и по
    // прежнему правилу «смотрим только после нашего ответа» менеджер уходил
    // из поля зрения навсегда.
    const afterBotSpoke: ConsultantState = {
      last_bot_reply: "Хорошо, понимаю. Если передумаете — обращайтесь.",
      last_bot_reply_at: at(1),
    };
    const found = findManagerMessage(
      [
        msg("outgoing", "сейчас не работаем", 18),
        msg("incoming", "А окей", 17),
        msg("outgoing", afterBotSpoke.last_bot_reply!, 1),
      ],
      afterBotSpoke,
      NOW,
    );
    expect(found?.text).toBe("сейчас не работаем");
  });

  it("свои прошлые ответы узнаёт по журналу", () => {
    const earlier = "Спасибо за интерес. Если появятся вопросы — пишите.";
    const st: ConsultantState = { last_bot_reply: "Хорошо, понимаю.", last_bot_reply_at: at(1) };
    const messages = [msg("outgoing", earlier, 10), msg("outgoing", st.last_bot_reply!, 1)];
    // Без журнала прошлый ответ бота выглядит как чужой.
    expect(findManagerMessage(messages, st, NOW)?.text).toBe(earlier);
    // С журналом — свой.
    expect(findManagerMessage(messages, st, NOW, [earlier])).toBeNull();
  });

  it("пустая переписка ничего не ломает", () => {
    expect(findManagerMessage([], state, NOW)).toBeNull();
  });
});

/**
 * Живой случай 21.09, 17:45. Менеджер написал в чат, бот встал на паузу,
 * человек нажал в панели «вернуть бота» — и на следующем же сообщении бот
 * снова замолчал: окно в полчаса нашло ту же реплику менеджера и поставило
 * паузу заново. Так ушли без ответа и тестовое «Какие варианты есть от bovi?»,
 * и «Казахстан», и живой покупатель с «В рублях, пожалуйста».
 */
describe("ручное включение переживает окно обнаружения", () => {
  const now = Date.parse("2026-09-21T11:46:00.000Z");
  const min = (m: number) => new Date(now - m * 60_000).toISOString();

  const managerTail = (at: string) => [
    { message: "Добрый день!", direction: "outgoing" as const, createdAt: at },
  ];

  it("реплика менеджера ДО включения паузу не возвращает", () => {
    const state = {
      last_bot_reply_at: min(10),
      last_bot_reply: "Размеры 30x50, 40x60 и 50x70 см подойдут для лица.",
      resumed_at: min(2),
    } as never;
    expect(findManagerMessage(managerTail(min(5)), state, now)).toBeNull();
  });

  it("реплика менеджера ПОСЛЕ включения паузу возвращает", () => {
    const state = {
      last_bot_reply_at: min(10),
      last_bot_reply: "Размеры 30x50, 40x60 и 50x70 см подойдут для лица.",
      resumed_at: min(5),
    } as never;
    const found = findManagerMessage(managerTail(min(2)), state, now);
    expect(found?.text).toBe("Добрый день!");
  });

  it("без включения окно работает как прежде", () => {
    // Защита от обратного: тихое снятие паузы не должно стать побочным
    // эффектом этой правки.
    const state = {
      last_bot_reply_at: min(10),
      last_bot_reply: "Размеры 30x50, 40x60 и 50x70 см подойдут для лица.",
    } as never;
    expect(findManagerMessage(managerTail(min(5)), state, now)?.text).toBe("Добрый день!");
  });
})

/**
 * Живой случай 21.09, 18:07. Менеджер свайп-ответом передал покупателю «300г»,
 * текст ушёл через наш же аккаунт Zernio — и следующая проверка увидела в
 * переписке исходящее, которого бот не писал, приняла его за живого человека
 * и поставила паузу. Покупатель тут же спросил «А есть подушки?» и остался
 * без ответа, хотя менеджер в чат не заходил и передал ровно один факт.
 */
describe("переданный ответ менеджера — свой голос, а не чужой", () => {
  const now = Date.parse("2026-09-21T12:08:00.000Z");
  const min = (m: number) => new Date(now - m * 60_000).toISOString();
  const tail = (text: string, at: string) => [
    { message: text, direction: "outgoing" as const, createdAt: at },
  ];

  it("свой переданный текст паузу не ставит", () => {
    const state = {
      last_bot_reply_at: min(3),
      last_bot_reply: "Уточню этот момент у менеджера и вернусь с ответом.",
      relayed: ["300г"],
    } as never;
    expect(findManagerMessage(tail("300г", min(1)), state, now, [])).toBeNull();
  });

  it("настоящая реплика менеджера паузу ставит по-прежнему", () => {
    const state = {
      last_bot_reply_at: min(3),
      last_bot_reply: "Уточню этот момент у менеджера и вернусь с ответом.",
      relayed: ["300г"],
    } as never;
    const found = findManagerMessage(tail("Здравствуйте, я менеджер, помогу", min(1)), state, now, []);
    expect(found?.text).toBe("Здравствуйте, я менеджер, помогу");
  });

  it("помним несколько переданных ответов, а не только последний", () => {
    const state = {
      last_bot_reply_at: min(9),
      last_bot_reply: "Уточню у менеджера.",
      relayed: ["300г", "Есть в бежевом и сером", "Доставка два дня"],
    } as never;
    expect(findManagerMessage(tail("Есть в бежевом и сером", min(2)), state, now, [])).toBeNull();
  });
})

/**
 * Живой случай 22.09, 12:43. Бот молчал в диалоге сутки. По журналу: на каждое
 * новое сообщение guard находил реплику менеджера, написанную накануне в
 * 19:50, и ставил паузу заново.
 *
 * Причина — Math.min в расчёте окна: он раскрывал поиск назад до последнего
 * ответа бота, а тот был вчера в 19:47. Шестичасовое окно паузу снимало, guard
 * тут же возвращал. Шесть диалогов молчали сутки.
 */
describe("вчерашний менеджер паузу сегодня не ставит", () => {
  const now = Date.parse("2026-09-22T07:43:00.000Z");
  const hours = (h: number) => new Date(now - h * 3600_000).toISOString();
  const SIX_HOURS = 6 * 3600_000;

  const tail = (at: string) => [
    { message: "Вас именно, что интересует от португального бренда?", direction: "outgoing" as const, createdAt: at },
  ];
  // Бот отвечал вчера вечером, больше в диалоге ничего не было.
  const state = {
    last_bot_reply_at: hours(17),
    last_bot_reply: "Да, у нас есть португальский бренд.",
  } as never;

  it("реплика старше окна паузы паузу не ставит", () => {
    expect(findManagerMessage(tail(hours(17)), state, now, [], SIX_HOURS)).toBeNull();
  });

  it("свежая реплика менеджера паузу ставит по-прежнему", () => {
    const found = findManagerMessage(tail(hours(1)), state, now, [], SIX_HOURS);
    expect(found?.text).toContain("португального бренда");
  });

  it("граница окна: на пять часов ставит, на семь — нет", () => {
    expect(findManagerMessage(tail(hours(5)), state, now, [], SIX_HOURS)).not.toBeNull();
    expect(findManagerMessage(tail(hours(7)), state, now, [], SIX_HOURS)).toBeNull();
  });

  it("короткое окно продавца сужает и поиск", () => {
    // Поставили три часа — реплика четырёхчасовой давности уже не считается.
    const threeHours = 3 * 3600_000;
    expect(findManagerMessage(tail(hours(4)), state, now, [], threeHours)).toBeNull();
    expect(findManagerMessage(tail(hours(2)), state, now, [], threeHours)).not.toBeNull();
  });
})
