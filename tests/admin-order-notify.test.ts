import { describe, expect, it } from "vitest";
import {
  ADMIN_NOTIFY_DISMISS_DELAY_MS,
  adminNotifySettingKey,
  collectTgMessageIds,
  isAdminNotifyDue,
  isAdminNotifySettingKey,
  mergeAdminNotifyRefs,
  parseAdminNotifyPack,
  parseAdminNotifyRefs,
} from "../src/lib/admin-order-notify";

describe("admin order notify refs", () => {
  it("парсит сохранённые message_id и отбрасывает мусор", () => {
    expect(parseAdminNotifyRefs(undefined)).toEqual([]);
    expect(parseAdminNotifyRefs("not-json")).toEqual([]);
    expect(
      parseAdminNotifyRefs(
        JSON.stringify([
          { chat_id: "100", message_id: 12 },
          { chat_id: 100, message_id: 13 },
          { chat_id: "100" },
        ]),
      ),
    ).toEqual([{ chat_id: "100", message_id: 12 }]);
  });

  it("читает пачку с отложенным удалением и старый массив", () => {
    expect(
      parseAdminNotifyPack(
        JSON.stringify({
          refs: [{ chat_id: "1", message_id: 9, buttons: true }],
          deleteAfter: "2026-09-02T08:25:00.000Z",
        }),
      ),
    ).toEqual({
      refs: [{ chat_id: "1", message_id: 9, buttons: true }],
      deleteAfter: "2026-09-02T08:25:00.000Z",
    });
    expect(parseAdminNotifyPack(JSON.stringify([{ chat_id: "1", message_id: 9 }]))).toEqual({
      refs: [{ chat_id: "1", message_id: 9 }],
      deleteAfter: null,
    });
  });

  it("считает пачку готовой к удалению только после deleteAfter", () => {
    const pack = {
      refs: [{ chat_id: "1", message_id: 1 }],
      deleteAfter: "2026-09-02T08:25:00.000Z",
    };
    expect(isAdminNotifyDue(pack, Date.parse("2026-09-02T08:24:59.000Z"))).toBe(false);
    expect(isAdminNotifyDue(pack, Date.parse("2026-09-02T08:25:00.000Z"))).toBe(true);
    expect(isAdminNotifyDue({ refs: [], deleteAfter: null })).toBe(false);
    expect(ADMIN_NOTIFY_DISMISS_DELAY_MS).toBe(5 * 60 * 1000);
  });

  it("достаёт id из одного сообщения и из media group", () => {
    expect(collectTgMessageIds({ message_id: 7 })).toEqual([7]);
    expect(collectTgMessageIds([{ message_id: 1 }, { message_id: 2 }])).toEqual([1, 2]);
    expect(collectTgMessageIds({ ok: true })).toEqual([]);
  });

  it("не дублирует одни и те же сообщения и сохраняет флаг кнопок", () => {
    expect(
      mergeAdminNotifyRefs(
        [{ chat_id: "1", message_id: 10, buttons: true }],
        [
          { chat_id: "1", message_id: 10 },
          { chat_id: "1", message_id: 11 },
        ],
      ),
    ).toEqual([
      { chat_id: "1", message_id: 10, buttons: true },
      { chat_id: "1", message_id: 11 },
    ]);
  });

  it("не отдаёт служебные ключи в клиентские настройки", () => {
    expect(adminNotifySettingKey(42)).toBe("admin_notify_tg:42");
    expect(isAdminNotifySettingKey("admin_notify_tg:42")).toBe(true);
    expect(isAdminNotifySettingKey("admin_chat_id")).toBe(false);
  });
});
