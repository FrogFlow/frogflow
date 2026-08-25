import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./admin-session.server";
import { normalizeGiftCertificateCode, generateGiftCertificateCode } from "./gift-certificates";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export const listGiftCertificates = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data, error } = await s
    .from("gift_certificates")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

const SaveInput = z.object({
  code: z.string().max(40).optional(),
  amount: z.number().positive(),
  currency: z.string().min(1).max(10),
  note: z.string().max(200).nullable(),
});

/**
 * Только создание — сертификат выдаётся один раз (продавец получил оплату
 * вне бота) и дальше живёт по своему статусу active/redeemed/cancelled,
 * редактировать номинал уже выданного смысла нет.
 */
export const createGiftCertificate = createServerFn({ method: "POST" })
  .validator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const code = data.code?.trim()
      ? normalizeGiftCertificateCode(data.code)
      : generateGiftCertificateCode();
    const { error } = await s.from("gift_certificates").insert({
      code,
      amount: data.amount,
      currency: data.currency,
      note: data.note,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, code };
  });

export const cancelGiftCertificate = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { error } = await s
      .from("gift_certificates")
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .eq("status", "active");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
