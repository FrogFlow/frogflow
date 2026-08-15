import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./admin-session.server";
import { toCsv, fetchAll, isoDate } from "./csv";

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

const STATUS_RU: Record<string, string> = {
  awaiting_payment: "ожидает оплаты",
  awaiting_confirmation: "проверяется",
  delivering: "выдаётся",
  delivered: "выдан",
  rejected: "отклонён",
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

    const rows = await fetchAll<{
      order_no: number | null;
      id: number;
      created_at: string | null;
      status: string;
      total: number;
      currency: string;
      display_name: string | null;
      username: string | null;
      telegram_id: number;
      contact: string | null;
      country_name: string | null;
      admin_note: string | null;
    }>((from, to) => {
      let q = s
        .from("orders")
        .select(
          "order_no, id, created_at, status, total, currency, display_name, username, telegram_id, contact, country_name, admin_note",
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
        "Валюта",
        "Покупатель",
        "Username",
        "Telegram ID",
        "Контакт",
        "Страна",
        "Заметка",
      ],
      rows.map((o) => [
        o.order_no ?? o.id,
        isoDate(o.created_at),
        STATUS_RU[o.status as string] ?? o.status,
        o.total,
        o.currency,
        o.display_name,
        o.username,
        o.telegram_id,
        o.contact,
        o.country_name,
        o.admin_note,
      ]),
    );
    return { csv, count: rows.length };
  });

/** Клиентская база. Заказы считаются на месте — «сколько купил» и есть главное, ради чего её открывают. */
export const exportCustomersCsvFn = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const s = await db();

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
    status: string;
    created_at: string | null;
  }>(
    (from, to) => s.from("orders").select("telegram_id, total, status, created_at").range(from, to),
    "заказы для статистики",
  );
  const stats = new Map<number, { count: number; sum: number; last: string | null }>();
  for (const o of orders) {
    const id = Number(o.telegram_id);
    if (!Number.isFinite(id)) continue;
    const cur = stats.get(id) ?? { count: 0, sum: 0, last: null };
    cur.count += 1;
    // В сумму идёт только доставленное: ожидающие оплаты заказы — ещё не выручка.
    if (o.status === "delivered") cur.sum += Number(o.total) || 0;
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
        isoDate(u.created_at),
        st?.count ?? 0,
        st?.sum ?? 0,
        isoDate(st?.last),
      ];
    }),
  );
  return { csv, count: users.length };
});
