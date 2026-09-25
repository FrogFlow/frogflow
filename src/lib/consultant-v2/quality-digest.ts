/**
 * Сводка качества консультанта за сутки — владельцу в Telegram, раз в день.
 *
 * Считает код, без модели и без денег: те же проверки, что у эталонного
 * набора (цены по прайсу, длина, два вопроса, рекламные слова, «ты», эмодзи),
 * по всем ответам бота из журнала за прошлые сутки по Алматы. На v1 с
 * включённой тенью (shadow.ts) — рядом ответы v2 на те же сообщения.
 *
 * Включается настройкой consultant_quality_digest = "on"; уходит с утренним
 * кроном consultant-vtb после 9:00 по Алматы, один раз в сутки.
 */
import type { ConsultantProduct } from "@/lib/consultant/catalog";
import { checkForm, checkPrices, indexCatalog, type CatalogIndex } from "./eval/checks";

export const DIGEST_SETTING_KEY = "consultant_quality_digest";
export const DIGEST_SENT_KEY = "consultant_quality_digest_sent";
const DIGEST_HOUR_ALMATY = 9;
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export type DigestRun = {
  conversation_id: string | null;
  incoming_text: string | null;
  reply_text: string | null;
  reply_kind: string | null;
  status: string | null;
  model: string | null;
  token_usage: { usd?: number } | null;
  tool_trace: unknown;
};

type ShadowEntry = { text?: string; kind?: string; usd?: number };

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/** Замечания к ответу — названия проверок, без повторов. */
export function replyFlags(text: string, index: CatalogIndex, isFirst: boolean): string[] {
  const flags = [
    ...checkPrices(text, index),
    ...checkForm({ text, kind: "", handoff: null, rate: null }, {}, isFirst),
  ].map((f) => f.check);
  if (EMOJI_RE.test(text) || text.includes("!")) flags.push("эмодзи или «!»");
  return [...new Set(flags)];
}

function shadowOf(trace: unknown): ShadowEntry | null {
  if (!Array.isArray(trace)) return null;
  for (const item of trace) {
    if (item && typeof item === "object" && "shadow_v2" in item) {
      return (item as { shadow_v2: ShadowEntry }).shadow_v2;
    }
  }
  return null;
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");
const usd = (n: number) => `$${n.toFixed(2)}`;
const cut = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

function countFlags(list: string[][]): string {
  const counts = new Map<string, number>();
  for (const flags of list) for (const f of flags) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `${f} ${n}`)
    .join(", ");
}

/** Текст сводки или null, если за сутки бот не ответил ни разу. */
export function buildQualityDigest(
  runs: DigestRun[],
  catalog: ConsultantProduct[],
  opts: { day: string },
): string | null {
  const index = indexCatalog(catalog.filter((p) => p.stock));
  const replied = runs.filter((r) => r.status === "replied" && r.reply_text?.trim());
  if (replied.length === 0) return null;
  const seen = new Set<string>();
  const scored = replied.map((r) => {
    const conv = r.conversation_id ?? "";
    const isFirst = !seen.has(conv);
    seen.add(conv);
    const shadow = shadowOf(r.tool_trace);
    return {
      run: r,
      flags: replyFlags(r.reply_text ?? "", index, isFirst),
      shadow,
      shadowFlags: shadow?.text ? replyFlags(shadow.text, index, isFirst) : null,
    };
  });

  const dialogs = new Set(runs.map((r) => r.conversation_id)).size;
  const handoffs = replied.filter((r) => r.reply_kind === "handoff" || r.reply_kind === "purchase");
  const paused = runs.filter((r) => r.status === "cancelled").length;
  const noModel = replied.filter((r) => !r.model).length;
  const cost = runs.reduce((sum, r) => sum + (Number(r.token_usage?.usd) || 0), 0);
  const clean = scored.filter((s) => s.flags.length === 0).length;

  const lines = [
    `📊 Консультант за ${opts.day.split("-").reverse().slice(0, 2).join(".")} (по Алматы)`,
    "",
    `Диалогов: ${dialogs}, ответов бота: ${replied.length}.`,
    `Передано менеджеру: ${handoffs.length}${paused ? `, отвечал менеджер (бот молчал): ${paused}` : ""}.`,
    `Без модели (шаблон или сбой): ${noModel}.`,
    `Ответы без замечаний: ${clean} из ${replied.length} (${pct(clean, replied.length)}).`,
  ];
  const flagged = scored.filter((s) => s.flags.length > 0);
  if (flagged.length) lines.push(`Замечания: ${countFlags(flagged.map((s) => s.flags))}.`);
  lines.push(
    `Расход модели: ${usd(cost)}${replied.length ? `, в среднем ${usd(cost / replied.length)} за ответ` : ""}.`,
  );

  const withShadow = scored.filter((s) => s.shadowFlags);
  if (withShadow.length) {
    const shadowClean = withShadow.filter((s) => s.shadowFlags!.length === 0).length;
    const v1Clean = withShadow.filter((s) => s.flags.length === 0).length;
    const shadowCost = withShadow.reduce((sum, s) => sum + (Number(s.shadow?.usd) || 0), 0);
    const better = withShadow.filter((s) => s.flags.length > 0 && s.shadowFlags!.length === 0);
    const worse = withShadow.filter((s) => s.flags.length === 0 && s.shadowFlags!.length > 0);
    lines.push(
      "",
      `Тень v2 — те же ${withShadow.length} сообщений, покупатель её не видел:`,
      `без замечаний v1 ${pct(v1Clean, withShadow.length)}, v2 ${pct(shadowClean, withShadow.length)}; v2 чище в ${better.length}, хуже в ${worse.length}.`,
      `Расход тени: ${usd(shadowCost)}.`,
    );
    const shadowFlagged = withShadow.filter((s) => s.shadowFlags!.length > 0);
    if (shadowFlagged.length)
      lines.push(`Замечания v2: ${countFlags(shadowFlagged.map((s) => s.shadowFlags!))}.`);
    const examples = [...worse.slice(0, 2), ...better.slice(0, 2)];
    if (examples.length) lines.push("", "Примеры:");
    for (const s of examples) {
      lines.push(
        `• «${cut(s.run.incoming_text ?? "", 60)}»`,
        `  v1${s.flags.length ? ` (${s.flags.join(", ")})` : ""}: ${cut(s.run.reply_text ?? "", 160)}`,
        `  v2${s.shadowFlags!.length ? ` (${s.shadowFlags!.join(", ")})` : ""}: ${cut(s.shadow?.text ?? "", 160)}`,
      );
    }
  } else if (flagged.length) {
    lines.push("", "Примеры:");
    for (const s of flagged.slice(0, 3)) {
      lines.push(
        `• «${cut(s.run.incoming_text ?? "", 60)}» (${s.flags.join(", ")})`,
        `  ${cut(s.run.reply_text ?? "", 180)}`,
      );
    }
  }
  return lines.join("\n").slice(0, 4000);
}

/** Прошлые сутки по Алматы: [начало, конец) в UTC и дата «ГГГГ-ММ-ДД». */
export function previousAlmatyDay(now: Date): { day: string; from: string; to: string } {
  const local = new Date(now.getTime() + ALMATY_OFFSET_MS);
  const todayStart =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - ALMATY_OFFSET_MS;
  const from = new Date(todayStart - 24 * 60 * 60 * 1000);
  return {
    day: new Date(from.getTime() + ALMATY_OFFSET_MS).toISOString().slice(0, 10),
    from: from.toISOString(),
    to: new Date(todayStart).toISOString(),
  };
}

/** С крона раз в 15 минут: после 9:00 по Алматы — сводка за вчера, один раз. */
export async function sendDailyQualityDigest(
  now = new Date(),
): Promise<{ sent: boolean; reason?: string }> {
  const localHour = new Date(now.getTime() + ALMATY_OFFSET_MS).getUTCHours();
  if (localHour < DIGEST_HOUR_ALMATY) return { sent: false, reason: "early" };
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data: settings } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .in("key", [DIGEST_SETTING_KEY, DIGEST_SENT_KEY]);
  const byKey = new Map((settings ?? []).map((r) => [r.key as string, String(r.value ?? "")]));
  if (byKey.get(DIGEST_SETTING_KEY)?.trim() !== "on") return { sent: false, reason: "off" };
  const { day, from, to } = previousAlmatyDay(now);
  if (byKey.get(DIGEST_SENT_KEY) === day) return { sent: false, reason: "already" };
  // Отметка до отправки: два крона подряд не дадут две сводки.
  await supabaseAdmin.from("app_settings").upsert({
    key: DIGEST_SENT_KEY,
    value: day,
    updated_at: now.toISOString(),
  });

  const botId = process.env.BOT_ID?.trim();
  if (!botId) return { sent: false, reason: "no_bot" };
  const { data: runs } = await supabaseAdmin
    .from("consultant_message_runs")
    .select(
      "conversation_id, incoming_text, reply_text, reply_kind, status, model, token_usage, tool_trace",
    )
    .eq("bot_id", botId)
    .gte("received_at", from)
    .lt("received_at", to)
    .order("received_at", { ascending: true })
    .limit(2000);
  const { loadConsultantCatalog } = await import("@/lib/consultant/catalog");
  const catalog = await loadConsultantCatalog().catch(() => []);
  const text = buildQualityDigest((runs ?? []) as DigestRun[], catalog, { day });
  if (!text) return { sent: false, reason: "empty" };
  const { sendToOwner } = await import("./model-alert");
  return { sent: (await sendToOwner(text)) > 0 };
}
