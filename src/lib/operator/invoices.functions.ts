import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator, getOperatorSession } from "./guard.server";
import {
  getPayoutRequisites,
  setPayoutRequisites,
  createInvoice,
  listInvoices,
  getInvoiceProofUrl,
  confirmInvoice,
  rejectInvoice,
  cancelInvoice,
} from "./invoices.server";

async function actor(): Promise<string> {
  const s = await getOperatorSession();
  return s.data.username || "operator";
}

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");

export const getPayoutRequisitesFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  return { value: await getPayoutRequisites() };
});

export const setPayoutRequisitesFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ value: z.string().max(2000) }).parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    await setPayoutRequisites(data.value);
    return { ok: true as const };
  });

export const createInvoiceFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        amount: z.number().positive(),
        currency: z.string().min(1).max(8),
        note: z.string().max(500).nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    return createInvoice(data.botId, data.amount, data.currency, data.note, await actor());
  });

export const listInvoicesFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => z.object({ botId: z.string().uuid().optional() }).parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return listInvoices(data.botId);
  });

export const getInvoiceProofUrlFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return { url: await getInvoiceProofUrl(data.invoiceId) };
  });

export const confirmInvoiceFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        invoiceId: z.string().uuid(),
        periodStart: IsoDate,
        periodEnd: IsoDate,
      })
      .refine((v) => v.periodEnd >= v.periodStart, {
        message: "Конец периода раньше начала",
        path: ["periodEnd"],
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    await confirmInvoice(data.invoiceId, data.periodStart, data.periodEnd, await actor());
    return { ok: true as const };
  });

export const rejectInvoiceFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ invoiceId: z.string().uuid(), reason: z.string().max(500) }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    await rejectInvoice(data.invoiceId, data.reason, await actor());
    return { ok: true as const };
  });

export const cancelInvoiceFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    await cancelInvoice(data.invoiceId, await actor());
    return { ok: true as const };
  });
