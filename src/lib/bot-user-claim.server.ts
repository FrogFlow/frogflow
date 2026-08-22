import type { Json } from "@/integrations-supabase/types";

/**
 * Общий приём CAS ("прочитал → проверил → записал с условием updated_at"),
 * применённый в проекте трижды по отдельности: claimOrderForDelivery
 * (orders.server.ts), claimAwaitingProof (direct-purchase.server.ts, чинит
 * дублирующийся заказ при двух чеках подряд) и claimOrderPlacement
 * (bot.server.ts, чинит двойной тап по кнопке оформления). Здесь обобщены
 * только два последних: у обоих один и тот же субстрат (bot_users.state,
 * ключ — telegram_id либо user_key). claimOrderForDelivery работает с другой
 * таблицей и другой формой условия (набор статусов, а не один флаг) —
 * обобщать её сюда значило бы усложнить ради сходства, а не ради общего кода.
 *
 * Гонка, которую это чинит: два конкурентных запроса читают одно и то же
 * "старое" состояние и оба посчитали бы себя вправе действовать. CAS не даёт
 * второму запросу применить изменение поверх уже устаревшего updated_at —
 * он получает null и должен считать, что первый его опередил.
 *
 * db — уже разрешённый supabaseAdmin (вызывающий код сам делает
 * `await import("@/integrations-supabase/client.server")`, как и раньше) —
 * здесь не типизируется структурно, чтобы не дублировать вручную форму
 * Supabase-клиента: TS выводит её из реального использования ниже.
 */
export async function claimBotUserState<S>(params: {
  db: (typeof import("@/integrations-supabase/client.server"))["supabaseAdmin"];
  column: "telegram_id" | "user_key";
  value: string | number;
  isClaimable: (state: S) => boolean;
  claim: (state: S) => S;
}): Promise<S | null> {
  const s = params.db;
  const { data: existing, error: readError } = await s
    .from("bot_users")
    .select("state, updated_at")
    .eq(params.column, params.value)
    .maybeSingle();
  if (readError) {
    console.error("[bot-user-claim] failed to read bot user state", readError);
    return null;
  }
  if (!existing?.updated_at) return null;

  const state = (existing.state ?? {}) as S;
  if (!params.isClaimable(state)) return null;

  const { data: updated, error: updateError } = await s
    .from("bot_users")
    .update({
      state: params.claim(state) as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq(params.column, params.value)
    .eq("updated_at", existing.updated_at)
    // У bot_users нет колонки id: после tenant migration её первичный ключ —
    // (bot_id, user_key). Из-за select("id") PostgREST отклонял уже выполненный
    // CAS-запрос, data становилась null, а обработчик чека принимал это за
    // проигранную гонку и молча завершался и в Instagram, и в WhatsApp.
    .select("user_key")
    .maybeSingle();

  if (updateError) {
    console.error("[bot-user-claim] failed to claim bot user state", updateError);
    return null;
  }

  return updated ? state : null;
}
