import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./admin-session.server";
import { fetchAll } from "./csv";
import type { Json } from "@/integrations-supabase/types";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

type DbClient = Awaited<ReturnType<typeof db>>;

/**
 * `products.country_prices` — плоская карта `{"<country_code>": цена}`
 * (см. pricing.server.ts). Ключи набираются вручную и не связаны с
 * `payment_methods.country_code` внешним ключом — переименование страны
 * здесь раньше не трогало их вообще: `resolvePrice` переставал находить
 * ручную цену под новым кодом и молча съезжал на автоконвертацию от базовой
 * цены (которая у части клиентов намеренно завышена, см. pricing.server.ts)
 * без единого предупреждения в интерфейсе (Блок 2.5).
 */
async function migrateCountryPricesKey(s: DbClient, oldCode: string, newCode: string) {
  const rows = await fetchAll(
    (from, to) => s.from("products").select("id, country_prices").range(from, to),
    "товары для переноса цен по стране",
  );
  for (const row of rows) {
    const cp = row.country_prices;
    if (!cp || typeof cp !== "object" || Array.isArray(cp)) continue;
    const table = cp as Record<string, Json>;
    if (!(oldCode in table)) continue;
    const next = { ...table };
    const value = next[oldCode];
    delete next[oldCode];
    // Не затираем цену, если под новым кодом уже что-то стоит вручную.
    if (!(newCode in next)) next[newCode] = value;
    const { error } = await s
      .from("products")
      .update({ country_prices: next })
      .eq("id", row.id as string);
    if (error) throw new Error(error.message);
  }
}

export const listPaymentMethods = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data, error } = await s.from("payment_methods").select("*").order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
});

const SaveInput = z.object({
  id: z.string().uuid().optional(),
  country_code: z.string().min(1).max(8),
  country_name: z.string().min(1).max(80),
  currency: z.string().min(1).max(8).default("KZT"),
  instructions: z.string().min(1).max(4000),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
  qr_code_path: z.string().nullable().optional(),
});

export const savePaymentMethod = createServerFn({ method: "POST" })
  .validator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    if (data.id) {
      const { data: existing, error: existingError } = await s
        .from("payment_methods")
        .select("country_code")
        .eq("id", data.id)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);

      const { error } = await s
        .from("payment_methods")
        .update({
          country_code: data.country_code,
          country_name: data.country_name,
          currency: data.currency,
          instructions: data.instructions,
          sort_order: data.sort_order,
          is_active: data.is_active,
          qr_code_path: data.qr_code_path,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);

      if (existing?.country_code && existing.country_code !== data.country_code) {
        await migrateCountryPricesKey(s, existing.country_code, data.country_code);
      }
    } else {
      const { error } = await s.from("payment_methods").insert({
        country_code: data.country_code,
        country_name: data.country_name,
        currency: data.currency,
        instructions: data.instructions,
        sort_order: data.sort_order,
        is_active: data.is_active,
        qr_code_path: data.qr_code_path,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const deletePaymentMethod = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { error } = await s.from("payment_methods").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
