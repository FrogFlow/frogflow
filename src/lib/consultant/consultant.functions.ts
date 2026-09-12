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
import { listConsultantCustomers, listPausedConsultations, resumeConsultant } from "./state";
import { refreshVtbRate, saveVtbRate } from "./vtb";
import { loadConsultantEvents, summarizeConsultantEvents } from "./analytics";
import { loadConsultantTasks, setConsultantTaskDone } from "./tasks";
import { getForcedAbBucket, saveForcedAbBucket } from "./ab";
import { importFromGoogleDriveUrl } from "./drive";
import { decodeBase64Xlsx, parseCatalogXlsx } from "./xlsx-import";

const CHECKLIST_KEY = "consultant_accept_json";
const DRIVE_URL_KEY = "consultant_drive_url";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export const getConsultantAdminFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const [
    catalog,
    meta,
    rate,
    shopUrl,
    sheetsRow,
    spendRow,
    paused,
    customers,
    events,
    tasks,
    ab,
    driveRow,
    checkRow,
  ] = await Promise.all([
    loadConsultantCatalog(),
    loadCatalogMeta(),
    getStoredVtbRate(),
    getConsultantShopUrl(),
    s.from("app_settings").select("value").eq("key", SHEETS_URL_KEY).maybeSingle(),
    s.from("app_settings").select("value").eq("key", CONSULTANT_LIFETIME_KEY).maybeSingle(),
    listPausedConsultations(),
    listConsultantCustomers(),
    loadConsultantEvents(),
    loadConsultantTasks(),
    getForcedAbBucket(),
    s.from("app_settings").select("value").eq("key", DRIVE_URL_KEY).maybeSingle(),
    s.from("app_settings").select("value").eq("key", CHECKLIST_KEY).maybeSingle(),
  ]);
  const spend = parseSmartSearchLifetime(spendRow.data?.value);
  let checklist: Record<string, boolean> = {};
  try {
    checklist = checkRow.data?.value
      ? (JSON.parse(checkRow.data.value) as Record<string, boolean>)
      : {};
  } catch {
    checklist = {};
  }
  const rateAgeHours = rate ? (Date.now() - Date.parse(rate.updatedAt)) / 36e5 : null;
  const { data: lastHooks } = await s
    .from("zernio_logs")
    .select("event_type, status, created_at")
    .eq("event_type", "message.received")
    .order("created_at", { ascending: false })
    .limit(1);
  const lastDirect = lastHooks?.[0] ?? null;
  return {
    catalogCount: catalog.length,
    preview: catalog.slice(0, 20),
    meta,
    rate,
    rateStale: rateAgeHours != null && rateAgeHours > 2,
    rateMissing: !rate,
    shopUrl,
    sheetsUrl: sheetsRow.data?.value?.trim() || "",
    driveUrl: driveRow.data?.value?.trim() || "",
    model: consultantModel(),
    apiKeyConfigured: Boolean(consultantApiKey()),
    spend: { ...spend, usdLabel: formatUsd(spend.usd) },
    paused,
    customers,
    analytics: summarizeConsultantEvents(events),
    events: events.slice(-20).reverse(),
    tasks,
    ab: ab ?? "split",
    checklist,
    paymentNote: "Оплата в боте не делается — только handoff менеджеру (ТЗ).",
    oneCNote: "1С API недоступно по ТЗ. Источник — Excel/CSV/Sheets/Drive.",
    lastDirectAt: lastDirect?.created_at ?? null,
    lastDirectStatus: lastDirect?.status ?? null,
  };
});

export const pollConsultantInboxFn = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const { pollIncomingConsultantMessages } = await import("./inbox-poll");
  return pollIncomingConsultantMessages();
});

export const importConsultantCatalogFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        csv: z.string().max(2_000_000).optional(),
        xlsxBase64: z.string().max(4_000_000).optional(),
        source: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const parsed = data.xlsxBase64
      ? parseCatalogXlsx(decodeBase64Xlsx(data.xlsxBase64))
      : parseCatalogCsv(data.csv || "");
    if (parsed.products.length === 0) {
      throw new Error(parsed.errors[0]?.message || "В файле нет строк с ценой");
    }
    const meta = await saveConsultantCatalog(
      parsed.products,
      data.source || (data.xlsxBase64 ? "xlsx" : "csv"),
    );
    return {
      ok: true as const,
      meta,
      skipped: parsed.errors.length,
      errors: parsed.errors.slice(0, 8),
    };
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

export const importConsultantDriveFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ url: z.string().trim().min(8).max(500) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const parsed = await importFromGoogleDriveUrl(data.url);
    if (parsed.products.length === 0) {
      throw new Error(parsed.errors[0]?.message || "В файле Drive нет строк с ценой");
    }
    const s = await db();
    await s.from("app_settings").upsert({
      key: DRIVE_URL_KEY,
      value: data.url,
      updated_at: new Date().toISOString(),
    });
    const meta = await saveConsultantCatalog(parsed.products, "google_drive");
    return { ok: true as const, meta, skipped: parsed.errors.length };
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

export const saveConsultantAbFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ bucket: z.enum(["a", "b", "split"]) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await saveForcedAbBucket(data.bucket);
    return { ok: true as const };
  });

export const saveConsultantChecklistFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ checklist: z.record(z.boolean()) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    await s.from("app_settings").upsert({
      key: CHECKLIST_KEY,
      value: JSON.stringify(data.checklist),
      updated_at: new Date().toISOString(),
    });
    return { ok: true as const };
  });

export const setConsultantTaskDoneFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string(), done: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await setConsultantTaskDone(data.id, data.done);
    return { ok: true as const };
  });
