/**
 * Теневой режим v2 на боевом консультанте v1.
 *
 * Покупателю отвечает v1, как и раньше. После того как ответ ушёл и лёг в
 * журнал, на то же сообщение и ту же историю молча отвечает v2 — с dryRun:
 * без паузы, задачи, уведомления и счёта клиенту. Ответ v2 дописывается в
 * строку журнала этого сообщения (tool_trace, { shadow_v2 }), в reply_text
 * не попадает: по reply_text бот узнаёт свои сообщения в чате.
 *
 * Зачем: сравнить v1 и v2 на живых покупателях, а не на эталонном наборе, —
 * прежде чем переводить на v2 BOVI.
 *
 * Включается настройкой consultant_shadow_v2 = "on" и только на деплое v1.
 * Не больше SHADOW_DAILY_LIMIT сообщений в сутки: тень платит из того же
 * ключа Anthropic, что и боевой бот.
 */

export const SHADOW_SETTING_KEY = "consultant_shadow_v2";
export const SHADOW_COUNTER_KEY = "consultant_shadow_v2_count";
export const SHADOW_DAILY_LIMIT = 150;

export type ShadowV2Result = {
  text: string;
  kind: string;
  tools: string[];
  handoff: string | null;
  attachments: number;
  model: string | null;
  usd: number;
  ms: number;
  error?: string;
};

/** Сутки по Алматы — счётчик тени сбрасывается в полночь магазина. */
function almatyDay(now: Date): string {
  return new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

/** Включена ли тень и не исчерпан ли дневной предел; при «да» счётчик растёт. */
export async function takeShadowSlot(now = new Date()): Promise<boolean> {
  const { currentVertical } = await import("@/lib/verticals/vertical.server");
  const { isBoviConsultantV2Vertical } = await import("@/lib/verticals/registry");
  if (isBoviConsultantV2Vertical(currentVertical())) return false;
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("key, value")
    .in("key", [SHADOW_SETTING_KEY, SHADOW_COUNTER_KEY]);
  const byKey = new Map((data ?? []).map((r) => [r.key as string, String(r.value ?? "")]));
  if (byKey.get(SHADOW_SETTING_KEY)?.trim() !== "on") return false;
  const day = almatyDay(now);
  let count = 0;
  try {
    const parsed = JSON.parse(byKey.get(SHADOW_COUNTER_KEY) || "{}") as {
      day?: string;
      n?: number;
    };
    if (parsed.day === day) count = Number(parsed.n) || 0;
  } catch {
    count = 0;
  }
  if (count >= SHADOW_DAILY_LIMIT) return false;
  await s.from("app_settings").upsert({
    key: SHADOW_COUNTER_KEY,
    value: JSON.stringify({ day, n: count + 1 }),
    updated_at: now.toISOString(),
  });
  return true;
}

/**
 * Ответ v2 на сообщение, на которое уже ответил v1, — в журнал рядом с ним.
 * Ошибки только в лог: покупателю тень ничего не меняет.
 */
export async function runShadowV2(input: {
  messageId: string;
  userKey: string;
  text: string;
  state: import("@/lib/consultant/state").ConsultantState;
  storyId?: string | null;
  storyMediaUrl?: string | null;
  imageUrls?: string[];
  /** Строка журнала v1: дописываем после неё, иначе запись v1 затрёт тень. */
  recorded?: Promise<unknown>;
}): Promise<void> {
  try {
    if (!(await takeShadowSlot())) return;
    const { decideConsultantReplyV2 } = await import("./engine");
    const { runUsd } = await import("@/lib/consultant/runs");
    let usage: import("@/lib/smart-search-cost").SmartSearchTokenUsage | null = null;
    let model: string | null = null;
    let error: string | undefined;
    const started = Date.now();
    const reply = await decideConsultantReplyV2(input.text, input.state, {
      userKey: input.userKey,
      requestId: `shadow:${input.messageId}`,
      dryRun: true,
      storyId: input.storyId,
      storyMediaUrl: input.storyMediaUrl,
      ...(input.imageUrls?.length ? { imageUrls: input.imageUrls } : {}),
      onUsage: (u, m) => {
        usage = u;
        model = m;
      },
      onError: (e) => {
        error = e;
      },
    });
    if (!reply) return;
    const handoff = reply.kind === "handoff" || reply.kind === "purchase" ? reply.kind : null;
    const shadow: ShadowV2Result = {
      text: reply.text.slice(0, 2000),
      kind: reply.kind,
      tools: (reply.toolsUsed ?? []).slice(0, 20),
      handoff,
      attachments: reply.attachments?.length ?? 0,
      model,
      usd: runUsd(usage, model),
      ms: Date.now() - started,
      ...(error ? { error: error.slice(0, 200) } : {}),
    };
    await input.recorded?.catch(() => {});
    const { appendRunTrace } = await import("@/lib/consultant/runs");
    await appendRunTrace(input.messageId, { shadow_v2: shadow });
  } catch (err) {
    console.warn("[consultant-v2] тень не отработала", err);
  }
}
