import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-session.server";
import { CONSULTANT_LIFETIME_KEY, parseSmartSearchLifetime } from "@/lib/ai-usage";
import { formatUsd } from "@/lib/smart-search-cost";
import {
  DEFAULT_SHOP_URL,
  SHEETS_URL_KEY,
  SHOP_URL_KEY,
  getConsultantShopUrl,
  loadCatalogMeta,
  loadConsultantCatalog,
  saveConsultantCatalog,
} from "./catalog";
import { googleSheetsCsvUrl, parseCatalogCsv } from "./catalog-import";
import { consultantApiKey, consultantModel } from "./config";
import { getStoredVtbRate } from "./rate";
import { refreshVtbRate, saveVtbRate } from "./vtb";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export const getConsultantAdminFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const [catalog, meta, rate, shopUrl, sheetsRow, spendRow] = await Promise.all([
    loadConsultantCatalog(),
    loadCatalogMeta(),
    getStoredVtbRate(),
    getConsultantShopUrl(),
    s.from("app_settings").select("value").eq("key", SHEETS_URL_KEY).maybeSingle(),
    s.from("app_settings").select("value").eq("key", CONSULTANT_LIFETIME_KEY).maybeSingle(),
  ]);
  const spend = parseSmartSearchLifetime(spendRow.data?.value);
  return {
    catalogCount: catalog.length,
    meta,
    rate,
    shopUrl,
    sheetsUrl: sheetsRow.data?.value?.trim() || "",
    model: consultantModel(),
    apiKeyConfigured: Boolean(consultantApiKey()),
    spend: { ...spend, usdLabel: formatUsd(spend.usd) },
  };
});

export const importConsultantCatalogFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ csv: z.string().min(1).max(2_000_000), source: z.string().max(200).optional() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const parsed = parseCatalogCsv(data.csv);
    if (parsed.products.length === 0) {
      throw new Error(parsed.errors[0]?.message || "В файле нет строк с ценой");
    }
    const meta = await saveConsultantCatalog(parsed.products, data.source || "csv");
    return { ok: true as const, meta, skipped: parsed.errors.length };
  });

export const importConsultantSheetsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ url: z.string().trim().min(8).max(500) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const csvUrl = googleSheetsCsvUrl(data.url);
    if (!csvUrl) throw new Error("Нужна ссылка на Google Sheet (docs.google.com/spreadsheets/…)");
    const res = await fetch(csvUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok)
      throw new Error(
        `Google Sheets ответил ${res.status}. Проверьте, что таблица открыта по ссылке.`,
      );
    const csv = await res.text();
    const parsed = parseCatalogCsv(csv);
    if (parsed.products.length === 0) {
      throw new Error(parsed.errors[0]?.message || "В таблице нет строк с ценой");
    }
    const s = await db();
    const now = new Date().toISOString();
    await s.from("app_settings").upsert({ key: SHEETS_URL_KEY, value: data.url, updated_at: now });
    const meta = await saveConsultantCatalog(parsed.products, "google_sheets");
    return { ok: true as const, meta, skipped: parsed.errors.length };
  });

export const saveConsultantShopUrlFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ url: z.string().trim().max(300) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const url = data.url || DEFAULT_SHOP_URL;
    const s = await db();
    await s.from("app_settings").upsert({
      key: SHOP_URL_KEY,
      value: url,
      updated_at: new Date().toISOString(),
    });
    return { ok: true as const, url };
  });

export const refreshConsultantRateFn = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  return refreshVtbRate();
});

export const setConsultantRateFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ rate: z.number().gt(1).lt(20) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const stored = await saveVtbRate(data.rate, "manual");
    return { ok: true as const, stored };
  });
