import { describe, expect, it } from "vitest";
import {
  adminNotifySettingKey,
  collectTgMessageIds,
  isAdminNotifySettingKey,
  mergeAdminNotifyRefs,
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

  it("достаёт id из одного сообщения и из media group", () => {
    expect(collectTgMessageIds({ message_id: 7 })).toEqual([7]);
    expect(collectTgMessageIds([{ message_id: 1 }, { message_id: 2 }])).toEqual([1, 2]);
    expect(collectTgMessageIds({ ok: true })).toEqual([]);
  });

  it("не дублирует одни и те же сообщения", () => {
    expect(
      mergeAdminNotifyRefs(
        [{ chat_id: "1", message_id: 10 }],
        [
          { chat_id: "1", message_id: 10 },
          { chat_id: "1", message_id: 11 },
        ],
      ),
    ).toEqual([
      { chat_id: "1", message_id: 10 },
      { chat_id: "1", message_id: 11 },
    ]);
  });

  it("не отдаёт служебные ключи в клиентские настройки", () => {
    expect(adminNotifySettingKey(42)).toBe("admin_notify_tg:42");
    expect(isAdminNotifySettingKey("admin_notify_tg:42")).toBe(true);
    expect(isAdminNotifySettingKey("admin_chat_id")).toBe(false);
  });
});
