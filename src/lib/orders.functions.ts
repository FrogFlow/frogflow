import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchAll } from "./csv";
import { fulfillmentTypePatch } from "./fulfillment-edit";
import {
  manualCustomerTelegramId,
  manualCustomerUserKey,
  manualOrderStatus,
  manualOrderTotal,
} from "./manual-order";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

/** Самая ранняя допустимая дата получения при заданном сроке изготовления — тот же расчёт, что и maxLeadTimeDaysInCart в чекауте. */
async function minFulfillmentDate(maxLeadDays: number): Promise<string> {
  const { todayInAppTZ } = await import("./fulfillment.server");
  const { addDaysToIsoDate } = await import("./datetime");
  return addDaysToIsoDate(todayInAppTZ(), maxLeadDays);
}

type AdminDb = Awaited<ReturnType<typeof db>>;

async function decrementProductStock(s: AdminDb, productId: string, qty: number): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: product } = await s
      .from("products")
      .select("stock_quantity")
      .eq("id", productId)
      .maybeSingle();
    if (!product || product.stock_quantity === null) return true;
    if (product.stock_quantity < qty) return false;
    const { data: updated } = await s
      .from("products")
      .update({ stock_quantity: product.stock_quantity - qty })
      .eq("id", productId)
      .eq("stock_quantity", product.stock_quantity)
      .select("id")
      .maybeSingle();
    if (updated) return true;
  }
  return false;
}

async function restoreProductStock(s: AdminDb, productId: string, qty: number): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: product } = await s
      .from("products")
      .select("stock_quantity")
      .eq("id", productId)
      .maybeSingle();
    if (!product || product.stock_quantity === null) return;
    const { data: updated } = await s
      .from("products")
      .update({ stock_quantity: product.stock_quantity + qty })
      .eq("id", productId)
      .eq("stock_quantity", product.stock_quantity)
      .select("id")
      .maybeSingle();
    if (updated) return;
  }
}

export const listOrders = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  const s = await db();
  // Без потолка: он резал историю до 200 заказов, и всё, что старше, просто
  // пропадало из админки — а заказы тут живут годами и нужны для разбора
  // обращений. Выборка идёт под ключом арендатора, то есть только свои строки.
  //
  // PostgREST сам молча обрывает любой единичный select на 1000 строках —
  // при 497 заказах это ещё не било, но это вопрос времени; fetchAll читает
  // страницами, пока страница приходит полной (Блок 3.3).
  return fetchAll(
    (from, to) =>
      s
        .from("orders")
        .select("*, order_items(id, name_snapshot, price_snapshot, quantity)")
        .order("created_at", { ascending: false })
        .range(from, to),
    "заказы",
  );
});

/** Короткий каталог для формы «заказ с телефона» — без картинок и файлов. */
export const listCatalogForOrders = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  const s = await db();
  return fetchAll(
    (from, to) =>
      s
        .from("products")
        .select(
          "id, name, price, currency, is_active, fulfillment_kind, stock_quantity, product_variants(id, name, price, sort_order)",
        )
        .eq("is_active", true)
        .order("name")
        .range(from, to),
    "каталог",
  );
});

/** Точные счётчики для дашборда: считаются в базе, а не по загруженному списку. */
export const getDashboardStats = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  const s = await db();

  const countOrders = async (statusIn?: string[]) => {
    let q = s.from("orders").select("*", { count: "exact", head: true });
    if (statusIn) q = q.in("status", statusIn);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const countProducts = async () => {
    const { count, error } = await s.from("products").select("*", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  // Очереди дашборда для кондитера: оплата ≠ подтверждение, «в работе» ≠
  // «готов к выдаче». Раньше awaiting мешал awaiting_payment с
  // awaiting_confirmation, а inProduction захватывал ready — готовый торт
  // выглядел как ещё пекущийся.
  const [
    products,
    total,
    awaitingPayment,
    awaitingConfirmation,
    delivered,
    delivering,
    inProduction,
    ready,
  ] = await Promise.all([
    countProducts(),
    countOrders(),
    countOrders(["awaiting_payment"]),
    countOrders(["awaiting_confirmation"]),
    countOrders(["delivered"]),
    countOrders(["delivering"]),
    countOrders(["accepted", "in_production"]),
    countOrders(["ready"]),
  ]);

  return {
    products,
    total,
    awaiting: awaitingConfirmation,
    awaitingPayment,
    awaitingConfirmation,
    delivered,
    delivering,
    inProduction,
    ready,
  };
});

export const getOrder = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    const { data: order, error } = await s
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return order;
  });

export const confirmOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    // Снимок fulfillment_kind на заказе (не на товаре — товар мог смениться
    // задним числом), тем же приёмом, что и в bot.server.ts confirm:.
    const { data: order, error } = await s
      .from("orders")
      .select("fulfillment_kind, total, status, paid_amount")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (order?.fulfillment_kind === "physical") {
      const { acceptOrder, amountDueNow, recordPayment, remainingDueNow } =
        await import("./fulfillment.server");
      // Статус ДО acceptOrder — она его меняет. "awaiting_payment" значит,
      // что покупатель ещё не присылал чек: продавец здесь принимает заказ
      // "на доверие", а не подтверждает получение денег, поэтому платёж
      // писать не в чём (Блок 1, находка 1.2). "awaiting_confirmation" —
      // чек был прислан, тут запись платежа законна.
      const hadProof = order.status !== "awaiting_payment";
      const result = await acceptOrder(data.id);
      // alreadyAccepted — это либо двойной клик, либо повторный webhook: во
      // обоих случаях запись платежа второй раз задвоила бы paid_amount
      // (Блок 1, находка 1.1). remainingDueNow — кондитер могла уже нажать
      // «Внести оплату» до «Принять заказ»; amountDueNow этого не знает.
      if (!result.alreadyAccepted && hadProof) {
        const due = remainingDueNow(
          await amountDueNow({
            total: Number(order.total),
            fulfillment_kind: order.fulfillment_kind,
          }),
          order.paid_amount,
        );
        if (due > 0) {
          // recordPayment сама не бросает при исчерпанных попытках CAS —
          // возвращает false (Блок 1, находка 1.8), .catch() ловил только
          // исключения.
          const paid = await recordPayment(data.id, due).catch((e) => {
            console.error("[orders] recordPayment failed", data.id, e);
            return false;
          });
          if (!paid) console.error("[orders] recordPayment returned false", data.id);
        }
      }
      const { scheduleAdminOrderNotifyDismiss } = await import("./admin-order-notify.server");
      await scheduleAdminOrderNotifyDismiss(data.id).catch((e) =>
        console.error("[orders] schedule admin notify dismiss failed", data.id, e),
      );
      return result;
    }
    const { deliverOrder } = await import("./orders.server");
    const delivered = await deliverOrder(data.id);
    const { scheduleAdminOrderNotifyDismiss } = await import("./admin-order-notify.server");
    await scheduleAdminOrderNotifyDismiss(data.id).catch((e) =>
      console.error("[orders] schedule admin notify dismiss failed", data.id, e),
    );
    return delivered;
  });

/**
 * Внести оплату вручную (остаток по задатку, оплата наличными при выдаче) —
 * единственная точка входа, которая позволяет продавцу закрыть разрыв между
 * paid_amount и total после того, как все автоматические пути уже
 * отработали (Блок 1, находка 1.5 / Блок 7, находка 7.2). Не даёт уйти в
 * минус и не даёт превысить total — сумма "к доплате" считается на клиенте
 * из total-paid_amount, но сервер всё равно перепроверяет сам, без доверия
 * к присланному числу.
 *
 * fulfillment_kind раньше запрашивался, но никогда не проверялся — кнопка
 * «Внести оплату» в admin.orders.tsx рендерится для любого заказа с
 * paid_amount < total, без учёта статуса. Без гейта продавец мог случайно
 * записать платёж на уже отклонённый (rejected) заказ — деньги повисали на
 * мёртвой записи, а remainingDueNow ни разу больше её не увидит. Задаток/
 * доплата наличными — сценарий только физических заказов (Ниши, Блок 7):
 * цифровые оплачиваются полностью до выдачи материалов, у них здесь взяться
 * нечему.
 */
export const recordManualPayment = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.number().int(), amount: z.number().positive() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    const { data: order, error } = await s
      .from("orders")
      .select("total, paid_amount, fulfillment_kind, status")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Заказ не найден");
    if (order.status === "rejected") {
      throw new Error("Заказ отклонён — оплата по нему не принимается");
    }
    if (order.fulfillment_kind !== "physical") {
      throw new Error("Ручное внесение оплаты доступно только для физических заказов");
    }
    const remaining = Number(order.total) - (Number(order.paid_amount) || 0);
    if (data.amount > remaining + 0.01) {
      throw new Error(`Сумма больше остатка: осталось внести ${remaining.toFixed(2)}`);
    }
    const { recordPayment } = await import("./fulfillment.server");
    const ok = await recordPayment(data.id, data.amount);
    if (!ok) throw new Error("Не удалось записать платёж, попробуйте ещё раз");
    return { ok: true as const };
  });

/**
 * Завести заказ вручную (Блок 7, находка 7.3) — звонок, комментарий
 * Instagram, человек без бота. Позиции, дата/адрес, зона и уже внесённая
 * сумма пишутся сразу; если деньги приняты, заказ идёт в работу, иначе
 * ждёт оплату как обычный awaiting_payment.
 */
export const createManualOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        displayName: z.string().trim().min(1).max(120),
        contact: z.string().trim().max(40).nullable(),
        items: z
          .array(
            z.object({
              productId: z.string().uuid(),
              variantId: z.string().uuid().nullable(),
              quantity: z.number().int().min(1).max(99),
            }),
          )
          .min(1)
          .max(20),
        fulfillmentType: z.enum(["pickup", "delivery"]),
        fulfillmentAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        address: z.string().trim().max(500).nullable(),
        note: z.string().trim().max(500).nullable(),
        deliveryZoneId: z.string().uuid().nullable(),
        paidAmount: z.number().min(0),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    const { randomUUID } = await import("node:crypto");
    const { materialsForProduct, availableMaterialLanguages } = await import("./product-materials");

    if (data.fulfillmentType === "delivery" && !data.deliveryZoneId) {
      throw new Error("Для доставки выберите зону");
    }

    const productIds = [...new Set(data.items.map((it) => it.productId))];
    const { data: products, error: prodErr } = await s
      .from("products")
      .select(
        "id, name, price, currency, is_active, fulfillment_kind, stock_quantity, lead_time_days, file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz, product_material_files(language, file_path, file_name, sort_order), product_variants(id, name, price)",
      )
      .in("id", productIds);
    if (prodErr) throw new Error(prodErr.message);
    const byId = new Map((products ?? []).map((p) => [p.id as string, p]));

    const lines: Array<{
      productId: string;
      variantId: string | null;
      quantity: number;
      name: string;
      unit: number;
      currency: string;
      kind: "digital" | "physical";
      product: NonNullable<typeof products>[number];
    }> = [];
    for (const it of data.items) {
      const p = byId.get(it.productId);
      if (!p || !p.is_active) throw new Error("Товар не найден или скрыт");
      const variants = (p.product_variants ?? []) as Array<{
        id: string;
        name: string;
        price: number;
      }>;
      let unit = Number(p.price) || 0;
      let name = p.name as string;
      if (variants.length > 0) {
        if (!it.variantId) throw new Error(`Выберите вариант для «${p.name}»`);
        const v = variants.find((row) => row.id === it.variantId);
        if (!v) throw new Error(`Вариант не найден для «${p.name}»`);
        unit = Number(v.price) || 0;
        name = `${p.name} — ${v.name}`;
      } else if (it.variantId) {
        throw new Error(`У «${p.name}» нет вариантов`);
      }
      lines.push({
        productId: it.productId,
        variantId: it.variantId,
        quantity: it.quantity,
        name,
        unit,
        currency: p.currency || "KZT",
        kind: p.fulfillment_kind === "physical" ? "physical" : "digital",
        product: p,
      });
    }

    const currencies = new Set(lines.map((l) => l.currency));
    if (currencies.size > 1) throw new Error("Все позиции должны быть в одной валюте");
    const kinds = new Set(lines.map((l) => l.kind));
    if (kinds.size > 1) {
      throw new Error("В одном заказе нельзя смешивать торты и цифровые товары");
    }
    const fulfillmentKind = kinds.has("physical") ? "physical" : "digital";

    // Тот же минимальный срок изготовления, что и в обычном чекауте всех
    // трёх каналов (maxLeadTimeDaysInCart + todayInAppTZ): ручной ввод не
    // должен позволять поставить дату получения раньше, чем товар физически
    // успеют сделать — иначе кондитерская обязуется перед клиентом на бумаге
    // раньше, чем реально может.
    if (fulfillmentKind === "physical" && data.fulfillmentAt) {
      const maxLeadDays = Math.max(0, ...lines.map((l) => Number(l.product.lead_time_days) || 0));
      if (maxLeadDays > 0) {
        const minIso = await minFulfillmentDate(maxLeadDays);
        if (data.fulfillmentAt < minIso) {
          throw new Error(
            `Слишком ранняя дата получения — минимальный срок изготовления ${maxLeadDays} дн., доступно с ${minIso}`,
          );
        }
      }
    }

    let deliveryFee = 0;
    let deliveryZoneName: string | null = null;
    let deliveryZoneId: string | null = null;
    if (
      fulfillmentKind === "physical" &&
      data.fulfillmentType === "delivery" &&
      data.deliveryZoneId
    ) {
      const { data: zone, error: zoneErr } = await s
        .from("delivery_zones")
        .select("id, name, price")
        .eq("id", data.deliveryZoneId)
        .maybeSingle();
      if (zoneErr) throw new Error(zoneErr.message);
      if (!zone) throw new Error("Зона доставки не найдена");
      deliveryZoneId = zone.id;
      deliveryZoneName = zone.name;
      deliveryFee = Number(zone.price) || 0;
    }

    const total = manualOrderTotal(
      lines.map((l) => l.unit * l.quantity),
      fulfillmentKind === "physical" ? deliveryFee : 0,
    );
    if (data.paidAmount > total + 0.01) {
      throw new Error(`Сумма больше итога заказа (${total})`);
    }

    const reserved: Array<{ productId: string; qty: number }> = [];
    try {
      for (const l of lines) {
        const ok = await decrementProductStock(s, l.productId, l.quantity);
        if (!ok) {
          throw new Error(`Недостаточно «${l.name}» на складе`);
        }
        reserved.push({ productId: l.productId, qty: l.quantity });
      }

      const entropy = randomUUID();
      const telegramId = manualCustomerTelegramId(data.contact, entropy);
      const userKey = manualCustomerUserKey(data.contact, entropy);
      const paid = Number(data.paidAmount) || 0;
      const status = manualOrderStatus(paid);
      const isPhysical = fulfillmentKind === "physical";

      const { data: order, error } = await s
        .from("orders")
        .insert({
          telegram_id: telegramId,
          user_key: userKey,
          platform: "manual",
          display_name: data.displayName,
          contact: data.contact,
          username: null,
          total,
          currency: lines[0]?.currency || "KZT",
          status,
          paid_amount: paid,
          admin_note: "Создан вручную",
          fulfillment_kind: fulfillmentKind,
          fulfillment_type: isPhysical ? data.fulfillmentType : null,
          fulfillment_at: isPhysical ? data.fulfillmentAt : null,
          fulfillment_address:
            isPhysical && data.fulfillmentType === "delivery" ? data.address : null,
          fulfillment_note: isPhysical ? data.note : null,
          delivery_zone_id: isPhysical ? deliveryZoneId : null,
          delivery_zone_name: isPhysical ? deliveryZoneName : null,
          delivery_fee: isPhysical ? deliveryFee : 0,
        })
        .select("id, order_no")
        .single();
      if (error || !order) throw new Error(error?.message || "Не удалось создать заказ");

      const { error: itemsError } = await s.from("order_items").insert(
        lines.map((l) => {
          const p = l.product;
          const byLang: Record<string, ReturnType<typeof materialsForProduct>> = {};
          for (const lang of availableMaterialLanguages(p)) {
            byLang[lang] = materialsForProduct(p, lang);
          }
          return {
            order_id: order.id,
            product_id: l.productId,
            product_variant_id: l.variantId,
            name_snapshot: l.name,
            price_snapshot: l.unit,
            quantity: l.quantity,
            file_path_snapshot: p.file_path ?? null,
            file_name_snapshot: p.file_name ?? null,
            file_url_snapshot: p.file_url ?? null,
            file_path_kz_snapshot: p.file_path_kz ?? null,
            file_name_kz_snapshot: p.file_name_kz ?? null,
            file_url_kz_snapshot: p.file_url_kz ?? null,
            material_files_snapshot: byLang.ru ?? [],
            material_files_kz_snapshot: byLang.kk ?? [],
            material_files_by_lang: byLang,
          };
        }),
      );
      if (itemsError) {
        await s.from("orders").delete().eq("id", order.id);
        throw new Error(itemsError.message);
      }

      return { ok: true as const, id: order.id as number, orderNo: order.order_no as number };
    } catch (e) {
      for (const r of reserved) {
        await restoreProductStock(s, r.productId, r.qty).catch(() => {});
      }
      throw e;
    }
  });

/**
 * Исправить данные получения физического заказа (Блок 7, находка 7.1) —
 * покупательница позвонила перенести на субботу, продавцу нужно место
 * поправить в интерфейсе, а не в Supabase напрямую. Дата/адрес/комментарий
 * не трогают деньги. Смена доставка → самовывоз снимает зону и комиссию
 * с total; самовывоз → доставка требует зону и прибавляет её комиссию.
 */
export const updateOrderFulfillment = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.number().int(),
        fulfillmentAt: z.string().min(1).nullable(),
        address: z.string().max(500).nullable(),
        note: z.string().max(500).nullable(),
        fulfillmentType: z.enum(["pickup", "delivery"]).nullable().optional(),
        deliveryZoneId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    const { data: order, error: readErr } = await s
      .from("orders")
      .select(
        "fulfillment_kind, fulfillment_type, delivery_fee, total, country_code, order_items(products(lead_time_days))",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!order) throw new Error("Заказ не найден");
    if (order.fulfillment_kind !== "physical") {
      throw new Error("Способ получения правится только у физического заказа");
    }
    // Тот же минимальный срок изготовления, что и при первичном оформлении
    // (createManualOrder выше, чекаут всех трёх каналов) — перенос даты не
    // должен позволять поставить её раньше, чем товар физически успеют
    // сделать заново.
    if (data.fulfillmentAt) {
      const items =
        (order as { order_items?: Array<{ products?: { lead_time_days?: number | null } }> })
          .order_items ?? [];
      const maxLeadDays = Math.max(
        0,
        ...items.map((it) => Number(it.products?.lead_time_days) || 0),
      );
      if (maxLeadDays > 0) {
        const minIso = await minFulfillmentDate(maxLeadDays);
        if (data.fulfillmentAt < minIso) {
          throw new Error(
            `Слишком ранняя дата получения — минимальный срок изготовления ${maxLeadDays} дн., доступно с ${minIso}`,
          );
        }
      }
    }
    let zone: { id: string; name: string; price: number } | null = null;
    if (data.fulfillmentType === "delivery") {
      if (!data.deliveryZoneId) {
        throw new Error("Выберите зону доставки");
      }
      const { data: zoneRow, error: zoneErr } = await s
        .from("delivery_zones")
        .select("id, name, price")
        .eq("id", data.deliveryZoneId)
        .maybeSingle();
      if (zoneErr) throw new Error(zoneErr.message);
      if (!zoneRow) throw new Error("Зона доставки не найдена");
      // resolveDeliveryZoneFee, а не голое zoneRow.price: та же конвертация,
      // что и в чекауте всех трёх каналов — комиссия зоны хранится в
      // домашней валюте продавца, а order.total (в который она складывается
      // ниже) уже в валюте покупателя этого заказа.
      const { resolveDeliveryZoneFee } = await import("./pricing.server");
      const fee = await resolveDeliveryZoneFee(Number(zoneRow.price) || 0, order.country_code);
      zone = { id: zoneRow.id, name: zoneRow.name, price: fee.amount };
    }
    const typePatch = fulfillmentTypePatch(
      {
        fulfillment_type: order.fulfillment_type,
        delivery_fee: order.delivery_fee,
        total: Number(order.total),
      },
      data.fulfillmentType,
      zone,
    );
    const { error } = await s
      .from("orders")
      .update({
        fulfillment_at: data.fulfillmentAt,
        fulfillment_address: data.address,
        fulfillment_note: data.note,
        // Сбрасываем флаг напоминания безусловно, а не только когда дата
        // реально сменилась: sendFulfillmentReminders (fulfillment-reminder.server.ts)
        // построена на допущении "дата получения после оформления не
        // меняется" и никогда не перезаписывает уже поставленный флаг —
        // без сброса здесь перенос даты после уже отправленного
        // напоминания навсегда лишал бы заказ нового напоминания.
        fulfillment_reminder_sent_at: null,
        ...typePatch,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Продвинуть физический заказ: accepted → in_production → ready → delivered. */
export const advanceOrderFulfillment = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    // Гейт по fulfillment_kind (Блок 3, находка 3.5) — без него цифровой
    // заказ можно было провести accepted → in_production → ready →
    // delivered (эти статусы у digital никогда не пишутся штатно, но
    // ничто в этой функции раньше не мешало вызвать её на любом id), минуя
    // deliverOrder целиком — заказ становится delivered, начисляются
    // баллы/реферал, а ни один файл не отправлен.
    const { data: order, error } = await s
      .from("orders")
      .select("fulfillment_kind, status")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (order?.fulfillment_kind !== "physical") {
      throw new Error("Это не физический заказ — статус продвигается только у физических товаров");
    }
    // Физический заказ в "delivering" — обломок старого пути (выдача файлов).
    // Кнопок производства на этом статусе не было; возвращаем в accepted,
    // откуда кондитер ведёт дальше штатно.
    if (order.status === "delivering") {
      const { error: upErr } = await s
        .from("orders")
        .update({ status: "accepted" })
        .eq("id", data.id)
        .eq("status", "delivering");
      if (upErr) throw new Error(upErr.message);
      return { status: "accepted" as const };
    }
    const { advanceFulfillment } = await import("./fulfillment.server");
    return await advanceFulfillment(data.id);
  });

/** Откатить физический заказ на шаг назад — исправить промах кнопкой (Блок 3, находка 3.6). */
export const revertOrderFulfillment = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    const { data: order, error } = await s
      .from("orders")
      .select("fulfillment_kind")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (order?.fulfillment_kind !== "physical") {
      throw new Error("Это не физический заказ — откат статуса только у физических товаров");
    }
    const { revertFulfillment } = await import("./fulfillment.server");
    return await revertFulfillment(data.id);
  });

export const redeliverOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    // Гейт по fulfillment_kind (Блок 3, находка 3.4) — deliverOrder(force)
    // пишет status:"delivering" без фильтра по текущему статусу вовсе:
    // на физическом заказе это выдёргивало бы его, например, из
    // in_production в "выдаётся", помечало все позиции отправленными без
    // единого файла (их и нет) и уводило в delivered с начислением баллов.
    const s = await db();
    const { data: order, error } = await s
      .from("orders")
      .select("fulfillment_kind")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (order?.fulfillment_kind === "physical") {
      throw new Error(
        "Это физический заказ — файлов для повторной отправки нет, статус ведите кнопками принять/в работу/готов/выдан",
      );
    }
    const { deliverOrder } = await import("./orders.server");
    // Full re-send from the beginning (files, not links)
    return await deliverOrder(data.id, { force: true, resume: false });
  });

/** Continue a stuck «Выдаётся» order from delivery_index (next batch of files). */
export const continueDeliveryOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    // Тот же гейт, что и в redeliverOrder выше (Блок 3, находка 3.4).
    const s = await db();
    const { data: order, error } = await s
      .from("orders")
      .select("fulfillment_kind")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (order?.fulfillment_kind === "physical") {
      throw new Error(
        "Это физический заказ — файлов для выдачи нет, статус ведите кнопками принять/в работу/готов/выдан",
      );
    }
    const { deliverOrder } = await import("./orders.server");
    return await deliverOrder(data.id, { force: true, resume: true });
  });

export const rejectOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.number().int(), note: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { notifyOrderCustomer, rejectOrderSafely } = await import("./orders.server");
    await requireAdmin();
    // Only touch admin_note when the admin actually typed one — it also
    // carries the `proof_auto` OCR marker, which an unconditional write
    // here used to erase on every reject.
    const claim = await rejectOrderSafely(data.id, data.note);
    if (!claim.ok) {
      throw new Error(`Заказ #${data.id} нельзя отклонить: статус уже «${claim.status}».`);
    }
    const order = claim.order;

    /**
     * Пишем туда, откуда пришёл заказ.
     *
     * Раньше здесь была прямая отправка в Telegram по `order.telegram_id`. У
     * покупателя из Instagram этот идентификатор синтетический, чата с таким
     * номером нет — и об отклонении он не узнавал вовсе: просто ждал материалы,
     * которых не будет. А отклонения тут обычное дело: чек нечитаемый, сумма не
     * та.
     */
    const { scheduleAdminOrderNotifyDismiss } = await import("./admin-order-notify.server");
    await scheduleAdminOrderNotifyDismiss(data.id).catch((e) =>
      console.error("[orders] schedule admin notify dismiss failed", data.id, e),
    );
    const notified = await notifyOrderCustomer(
      data.id,
      `❌ Ваш заказ №${order?.order_no ?? data.id} отклонён.\n${data.note ? `\nПричина: ${data.note}\n` : ""}\nЕсли это ошибка — напишите продавцу.`,
    );

    // Instagram запрещает писать позже 24 часов с последнего сообщения
    // покупателя, поэтому сообщить удаётся не всегда. Отклонение при этом
    // состоялось, и продавец должен знать, что человека придётся окликнуть сам.
    return { ok: true as const, customerNotified: notified };
  });

/** Nudge buyer: re-send current payment options for an awaiting_payment order. */
export const remindPaymentOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { remindOrderPayment } = await import("./bot.server");
    await requireAdmin();
    return await remindOrderPayment(data.id);
  });

export const deleteOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    // Заказ с внесённой оплатой (задаток, полная оплата) удалять нельзя —
    // это тихо стирает единственный след, что деньги были получены (Блок 7,
    // находка 7.4). Отменить такой заказ — через "Отклонить" (rejectOrder),
    // она сохраняет строку и её paid_amount.
    const { data: order, error: readErr } = await s
      .from("orders")
      .select("paid_amount")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (order && Number(order.paid_amount) > 0) {
      throw new Error(
        "У заказа есть внесённая оплата — удалять нельзя, иначе пропадёт запись о деньгах. Отклоните заказ вместо удаления.",
      );
    }
    await s.from("order_items").delete().eq("order_id", data.id);
    const { error } = await s.from("orders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    // Не сбрасываем sequence — это опасно при параллельных заказах
    return { ok: true as const };
  });
