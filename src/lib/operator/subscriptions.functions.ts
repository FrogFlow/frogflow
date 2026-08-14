import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator, getOperatorSession } from "./guard.server";
import {
  listPayments,
  getSubscription,
  addPayment,
  deletePayment,
  setPolicy,
} from "./subscriptions.server";

async function actor(): Promise<string> {
  const s = await getOperatorSession();
  return s.data.username || "operator";
}

const BotIdInput = z.object({ botId: z.string().uuid() });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");

export const getSubscriptionFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => BotIdInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return getSubscription(data.botId);
  });

export const listPaymentsFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => BotIdInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return listPayments(data.botId);
  });

export const addPaymentFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        period_start: IsoDate,
        period_end: IsoDate,
        amount: z.number().nonnegative(),
        currency: z.string().min(1).max(8),
        note: z.string().nullable(),
      })
      .refine((v) => v.period_end >= v.period_start, {
        message: "Конец периода раньше начала",
        path: ["period_end"],
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    const { botId, ...payment } = data;
    await addPayment(botId, payment, await actor());
    return { ok: true as const };
  });

export const deletePaymentFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ botId: z.string().uuid(), paymentId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    await deletePayment(data.botId, data.paymentId, await actor());
    return { ok: true as const };
  });

export const setPolicyFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        on_overdue: z.enum(["warn", "suspend"]),
        warn_days_before: z.number().int().min(0).max(90),
        grace_days: z.number().int().min(0).max(90),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    const { botId, ...policy } = data;
    await setPolicy(botId, policy, await actor());
    return { ok: true as const };
  });
