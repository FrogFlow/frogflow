import { supabaseAdmin } from "../integrations-supabase/client.server";
import { fetchVtbRubBuyRate } from "./vtb";

/**
 * Gets the current successful VTB rate from the DB, or triggers a fetch if none exists.
 */
export async function getActiveVtbRate(botId: string): Promise<number | null> {
  // Ideally, a cron updates a settings table or a specialized table.
  // We'll store the latest rate in bot_settings or we can just fetch it live 
  // with a fallback to a cached value in a generic settings row.
  
  // For the sake of the specification: "When VTB is unavailable, keep the last successful VTB rate."
  // We can query the `consultant_message_runs` table for the latest `rate_value` as a hacky cache,
  // or use `supabaseAdmin` to query a settings table.
  
  const { data } = await supabaseAdmin
    .from("consultant_message_runs")
    .select("rate_value")
    .eq("bot_id", botId)
    .not("rate_value", "is", null)
    .order("rate_updated_at", { ascending: false })
    .limit(1)
    .single();

  const lastKnownRate = data?.rate_value ? Number(data.rate_value) : null;
  
  try {
    const liveRate = await fetchVtbRubBuyRate();
    return liveRate.buyRate;
  } catch (err) {
    console.error("VTB rate fetch failed, falling back to last known", err);
    return lastKnownRate;
  }
}

/**
 * Calculates RUB price based on KZT price and VTB buy rate.
 * Formula: round(price_kzt / (vtb_buy_rate * 0.95))
 */
export function calculateRubPrice(priceKzt: number, vtbBuyRate: number): number {
  return Math.round(priceKzt / (vtbBuyRate * 0.95));
}
