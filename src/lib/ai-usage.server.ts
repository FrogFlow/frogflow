/**
 * Чтение, накопление и сброс расхода ИИ на деплое арендатора (app_settings).
 * Сброс делает только внутренний API — его зовёт панель оператора после оплаты.
 */
import {
  RECEIPT_OCR_LIFETIME_KEY,
  SMART_SEARCH_LIFETIME_KEY,
  addSmartSearchLifetime,
  buildAiUsageSnapshot,
  emptySmartSearchLifetime,
  parseReceiptOcrCount,
  parseSmartSearchLifetime,
  type AiUsageSnapshot,
} from "./ai-usage";
import type { SmartSearchTokenUsage } from "./smart-search-cost";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function readAiUsage(): Promise<AiUsageSnapshot> {
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("key, value")
    .in("key", [SMART_SEARCH_LIFETIME_KEY, RECEIPT_OCR_LIFETIME_KEY]);
  const map = Object.fromEntries((data ?? []).map((row) => [row.key, row.value as string]));
  return buildAiUsageSnapshot(map[SMART_SEARCH_LIFETIME_KEY], map[RECEIPT_OCR_LIFETIME_KEY]);
}

export async function recordSmartSearchLifetime(usage: SmartSearchTokenUsage): Promise<void> {
  if (usage.inputTokens <= 0 && usage.outputTokens <= 0) return;
  try {
    const s = await db();
    const { data } = await s
      .from("app_settings")
      .select("value")
      .eq("key", SMART_SEARCH_LIFETIME_KEY)
      .maybeSingle();
    const next = addSmartSearchLifetime(parseSmartSearchLifetime(data?.value), usage);
    await s.from("app_settings").upsert({
      key: SMART_SEARCH_LIFETIME_KEY,
      value: JSON.stringify(next),
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[ai-usage] failed to record smart search lifetime", e);
  }
}

export async function recordReceiptOcrCall(): Promise<void> {
  try {
    const s = await db();
    const { data } = await s
      .from("app_settings")
      .select("value")
      .eq("key", RECEIPT_OCR_LIFETIME_KEY)
      .maybeSingle();
    const next = parseReceiptOcrCount(data?.value) + 1;
    await s.from("app_settings").upsert({
      key: RECEIPT_OCR_LIFETIME_KEY,
      value: String(next),
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[ai-usage] failed to record receipt OCR call", e);
  }
}

export async function resetAiUsage(): Promise<AiUsageSnapshot> {
  const s = await db();
  const now = new Date().toISOString();
  const { error } = await s.from("app_settings").upsert([
    {
      key: SMART_SEARCH_LIFETIME_KEY,
      value: JSON.stringify(emptySmartSearchLifetime()),
      updated_at: now,
    },
    { key: RECEIPT_OCR_LIFETIME_KEY, value: "0", updated_at: now },
  ]);
  if (error) throw new Error(error.message);
  return buildAiUsageSnapshot(JSON.stringify(emptySmartSearchLifetime()), "0");
}
