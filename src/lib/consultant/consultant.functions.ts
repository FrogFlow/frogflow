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
  importCatalogFromSheetsUrl,
  loadCatalogMeta,
  loadConsultantCatalog,
  saveConsultantCatalog,
} from "./catalog";
import { parseCatalogCsv } from "./catalog-import";
import { consultantApiKey, consultantModel } from "./config";
import { getStoredVtbRate } from "./rate";
import { listPausedConsultations, resumeConsultant } from "./state";
import { refreshVtbRate, saveVtbRate } from "./vtb";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export const getConsultantAdminFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const [catalog, meta, rate, shopUrl, sheetsRow, spendRow, paused] = await Promise.all([
    loadConsultantCatalog(),
    loadCatalogMeta(),
    getStoredVtbRate(),
    getConsultantShopUrl(),
    s.from("app_settings").select("value").eq("key", SHEETS_URL_KEY).maybeSingle(),
    s.from("app_settings").select("value").eq("key", CONSULTANT_LIFETIME_KEY).maybeSingle(),
    listPausedConsultations(),
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
    paused,
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
    const result = await importCatalogFromSheetsUrl(data.url);
    if (!result.ok) {
      if (result.reason === "bad_url") {
        throw new Error("Нужна ссылка на Google Sheet (docs.google.com/spreadsheets/…)");
      }
      if (result.reason.startsWith("http_")) {
        throw new Error(
          `Google Sheets ответил ${result.reason.slice(5)}. Проверьте, что таблица открыта по ссылке.`,
        );
      }
      throw new Error(result.reason === "empty" ? "В таблице нет строк с ценой" : result.reason);
    }
    return { ok: true as const, meta: result.meta, skipped: result.skipped };
  });

export const resumeConsultantFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ userKey: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const state = await resumeConsultant(data.userKey);
    return { ok: true as const, paused: state.automation_paused === true };
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
