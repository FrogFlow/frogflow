import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./admin-session.server";
import { toCsv, fetchAll } from "./csv";
import { appTimeZone, formatDateTimeIso } from "./datetime";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

/**
 * Выгрузка заказов и клиентской базы — «в один клик для бухгалтерии и
 * аналитики» из базовых возможностей прайса.
 *
 * Сборка CSV и постраничное чтение живут в ./csv — там они без серверных
 * зависимостей и покрыты тестами.
 */

// Блок 6, находка 6.7 — без accepted/in_production/ready бухгалтерская
// выгрузка получала английские коды статуса вместо перевода (фолбэк `??
// o.status` ниже).
const STATUS_RU: Record<string, string> = {
  awaiting_payment: "ожидает оплаты",
  awaiting_confirmation: "проверяется",
  delivering: "выдаётся",
  delivered: "выдан",
  rejected: "отклонён",
  accepted: "принят в работу",
  in_production: "в работе",
  ready: "готов",
};

/**
 * Заказы. Данные читаются под ключом арендатора, поэтому фильтр по bot_id не
 * нужен — RLS отдаёт только свои строки (MIGRATION-02).
 */
export const exportOrdersCsvFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const tz = appTimeZone();
    const shopDate = (v: unknown) => {
      if (!v) return "";
      const raw = String(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      return formatDateTimeIso(raw, tz) || raw;
    };

    // fulfillment_kind/_type/_at/_address, paid_amount, delivery_zone_name,
    // delivery_fee — Блок 6, находка 6.8: раньше выгрузка не содержала ни
    // одной физической колонки, бесполезная именно для той ниши, ради
    // которой всё делалось (кондитерская бухгалтерия не видит ни дат
    // получения, ни адресов доставки, ни фактически внесённой суммы).
    const rows = await fetchAll<{
      order_no: number | null;
      id: number;
      created_at: string | null;
      status: string;
      total: number;
      paid_amount: number | null;
      currency: string;
      display_name: string | null;
      username: string | null;
      telegram_id: number;
      contact: string | null;
      country_name: string | null;
      admin_note: string | null;
      fulfillment_kind: string | null;
      fulfillment_type: string | null;
      fulfillment_at: string | null;
      fulfillment_address: string | null;
      fulfillment_note: string | null;
      delivery_zone_name: string | null;
      delivery_fee: number | null;
    }>((from, to) => {
      let q = s
        .from("orders")
        .select(
          "order_no, id, created_at, status, total, paid_amount, currency, display_name, username, telegram_id, contact, country_name, admin_note, fulfillment_kind, fulfillment_type, fulfillment_at, fulfillment_address, fulfillment_note, delivery_zone_name, delivery_fee",
        )
        .order("created_at", { ascending: false })
        .range(from, to);
      if (data.from) q = q.gte("created_at", `${data.from}T00:00:00`);
      // Конец периода включительно: оператор выбирает «по 31 августа», имея в
      // виду весь этот день.
      if (data.to) q = q.lte("created_at", `${data.to}T23:59:59`);
      return q;
    }, "заказы");

    const csv = toCsv(
      [
        "Номер",
        "Дата",
        "Статус",
        "Сумма",
        "Внесено",
        "Валюта",
        "Покупатель",
        "Username",
        "Telegram ID",
        "Контакт",
        "Страна",
        "Заметка",
        "Тип получения",
        "Способ",
        "Дата получения",
        "Адрес",
        "Комментарий покупателя",
        "Зона доставки",
        "Комиссия доставки",
      ],
      rows.map((o) => [
        o.order_no ?? o.id,
        shopDate(o.created_at),
        STATUS_RU[o.status as string] ?? o.status,
        o.total,
        o.paid_amount ?? "",
        o.currency,
        o.display_name,
        o.username,
        o.telegram_id,
        o.contact,
        o.country_name,
        o.admin_note,
        o.fulfillment_kind === "physical" ? "физический" : "цифровой",
        o.fulfillment_type === "delivery"
          ? "доставка"
          : o.fulfillment_type === "pickup"
            ? "самовывоз"
            : "",
        o.fulfillment_at ? shopDate(o.fulfillment_at) : "",
        o.fulfillment_address ?? "",
        o.fulfillment_note ?? "",
        o.delivery_zone_name ?? "",
        o.delivery_fee ?? "",
      ]),
    );
    return { csv, count: rows.length };
  });

/** Клиентская база. Заказы считаются на месте — «сколько купил» и есть главное, ради чего её открывают. */
export const exportCustomersCsvFn = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const tz = appTimeZone();
  const shopDate = (v: unknown) => {
    if (!v) return "";
    const raw = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return formatDateTimeIso(raw, tz) || raw;
  };

  const users = await fetchAll<{
    telegram_id: number | null;
    first_name: string | null;
    last_name: string | null;
    username: string | null;
    contact_phone: string | null;
    language_code: string | null;
    created_at: string | null;
  }>(
    (from, to) =>
      s
        .from("bot_users")
        .select(
          "telegram_id, first_name, last_name, username, contact_phone, language_code, created_at",
        )
        .order("created_at", { ascending: false })
        .range(from, to),
    "клиентов",
  );

  // Заказы читаются целиком один раз, а не по запросу на каждого покупателя.
  const orders = await fetchAll<{
    telegram_id: number | null;
    total: number;
    paid_amount: number | null;
    status: string;
    fulfillment_kind: string | null;
    created_at: string | null;
  }>(
    (from, to) =>
      s
        .from("orders")
        .select("telegram_id, total, paid_amount, status, fulfillment_kind, created_at")
        .range(from, to),
    "заказы для статистики",
  );
  const stats = new Map<number, { count: number; sum: number; last: string | null }>();
  // Блок 6, находка 6.9 — LTV раньше считал только status==="delivered" и
  // игнорировал paid_amount вовсе. Свадебный торт, три недели в
  // in_production с внесённым задатком, в LTV не попадал совсем — хотя
  // деньги от покупателя уже получены.
  for (const o of orders) {
    const id = Number(o.telegram_id);
    if (!Number.isFinite(id)) continue;
    const cur = stats.get(id) ?? { count: 0, sum: 0, last: null };
    cur.count += 1;
    if (o.fulfillment_kind === "physical") {
      // Физический заказ — реально внесённое, на любой стадии производства,
      // не только "delivered".
      cur.sum += Number(o.paid_amount) || 0;
    } else if (o.status === "delivered") {
      // Цифровой — paid_amount там не пишется (Блок 1, находка 1.13,
      // сознательно не расширена в этом заходе), берём total выданного.
      cur.sum += Number(o.total) || 0;
    }
    const at = String(o.created_at ?? "");
    if (!cur.last || at > cur.last) cur.last = at;
    stats.set(id, cur);
  }

  const csv = toCsv(
    [
      "Telegram ID",
      "Имя",
      "Фамилия",
      "Username",
      "Телефон",
      "Язык",
      "Регистрация",
      "Заказов",
      "Куплено на",
      "Последний заказ",
    ],
    users.map((u) => {
      const st = stats.get(Number(u.telegram_id));
      return [
        u.telegram_id,
        u.first_name,
        u.last_name,
        u.username,
        u.contact_phone,
        u.language_code,
        shopDate(u.created_at),
        st?.count ?? 0,
        st?.sum ?? 0,
        shopDate(st?.last),
      ];
    }),
  );
  return { csv, count: users.length };
});
