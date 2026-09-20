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
  loadConsultantCatalogSnapshot,
  saveConsultantCatalog,
} from "./catalog";
import { parseCatalogCsv } from "./catalog-import";
import { consultantApiKey, consultantModel } from "./config";
import { getStoredVtbRate } from "./rate";
import { listConsultantCustomers, listPausedConsultations, resumeConsultant } from "./state";
import { loadVtbAttemptLog, refreshVtbRate, saveVtbRate } from "./vtb";
import { loadConsultantEvents, summarizeConsultantEvents } from "./analytics";
import { clearConsultantTasks, loadConsultantTasks, setConsultantTaskDone } from "./tasks";
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
    catalogSnapshot,
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
    rateAttempt,
    usageStats,
  ] = await Promise.all([
    loadConsultantCatalogSnapshot(),
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
    loadVtbAttemptLog(),
    (await import("./runs")).loadConsultantUsageStats(7),
  ]);
  // Каталог для админки — тот же, что видит консультант. Снятое с
  // производства идёт отдельным числом: продавцу видно, что строки в прайсе
  // есть, а покупателю они не показываются.
  const catalog = catalogSnapshot.products;
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
    const { getConsultantStoreInfo } = await import("./store-info");
    const { loadConsultantKnowledge } = await import("./knowledge");
    const [storeInfo, knowledge] = await Promise.all([
      getConsultantStoreInfo(),
      loadConsultantKnowledge(),
    ]);

    return {
      catalogCount: catalog.length,
      catalog,
      discontinuedCount: catalogSnapshot.hidden.length,
      meta,
      rate,
      rateStale: rateAgeHours != null && rateAgeHours > 2,
      rateMissing: !rate,
      rateAgeHours,
      // Последняя попытка обновления и её причина отказа: без этого «курс не
      // подтягивается» выглядит как загадка и разбирается перепиской.
      rateAttempt,
      shopUrl,
      sheetsUrl: sheetsRow.data?.value?.trim() || "",
      driveUrl: driveRow.data?.value?.trim() || "",
      model: consultantModel(),
      apiKeyConfigured: Boolean(consultantApiKey()),
      spend: { ...spend, usdLabel: formatUsd(spend.usd) },
      // Цена одного сообщения и доля кеша за неделю — из журнала сообщений,
      // а не из накопительной суммы: по одной цифре «всего потрачено»
      // оптимизировать нечего.
      usageStats,
      paused,
      customers,
      analytics: summarizeConsultantEvents(events),
      events: events.slice(-20).reverse(),
      tasks,
      ab: ab ?? "split",
      checklist,
      storeInfo,
      knowledge,
      paymentNote: "Оплата в боте не делается — только handoff менеджеру (ТЗ).",
      oneCNote: "1С API недоступно по ТЗ. Источник — Excel/CSV/Sheets/Drive.",
      lastDirectAt: lastDirect?.created_at ?? null,
      lastDirectStatus: lastDirect?.status ?? null,
      botEnabled: await (await import("./state")).isConsultantBotGloballyEnabled(),
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

export const testConsultantTelegramFn = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const { notifyConsultantHandoff } = await import("./notify");
  const res = await notifyConsultantHandoff({
    userKey: "test_preview",
    reason: "purchase",
    text: "Тестовое уведомление: проверка связи с менеджером BOVI",
    customerName: "Тестовый менеджер",
    customerUsername: "bovi_manager",
    lastProducts: ["Комплект постельного белья Сатин", "Полотенце махровое 100х150"],
  });
  // Возвращаем поимённый итог: кому дошло, кому нет и почему. Прежнее
  // «ok: true» печаталось даже тогда, когда Telegram отказал всем.
  const deliveries = res.deliveries ?? [];
  return {
    ok: res.ok,
    delivered: deliveries.filter((d) => d.ok).map((d) => d.chatId),
    failed: deliveries.filter((d) => !d.ok).map((d) => ({ chatId: d.chatId, error: d.error ?? "" })),
    message: res.ok ? "" : res.message,
  };
});

export const toggleConsultantBotFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { setConsultantBotGloballyEnabled } = await import("./state");
    const enabled = await setConsultantBotGloballyEnabled(data.enabled);
    return { ok: true as const, enabled };
  });

export const clearConsultantTasksFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ onlyDone: z.boolean().optional() }).optional().parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await clearConsultantTasks(data?.onlyDone ?? false);
    return { ok: true as const };
  });

export const saveConsultantStoreInfoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        address: z.string().optional(),
        phone: z.string().optional(),
        hours: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const { saveConsultantStoreInfo } = await import("./store-info");
    await saveConsultantStoreInfo(data);
    return { ok: true as const };
  });

export const saveConsultantKnowledgeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        articles: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            tags: z.array(z.string()),
            content: z.string(),
            updatedAt: z.string(),
          }),
        ),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const { saveConsultantKnowledge } = await import("./knowledge");
    await saveConsultantKnowledge(data.articles);
    return { ok: true as const };
  });

export const importConsultantKnowledgeFileFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        fileName: z.string().min(1).max(200),
        // Потолок на строку base64 с запасом; настоящая проверка размера идёт
        // по распакованным байтам ниже, здесь — только защита от гигантского
        // тела запроса.
        base64: z.string().min(1).max(6_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const {
      decodeBase64,
      extractDocumentText,
      hasSectionMarkers,
      titleFromFileName,
      KNOWLEDGE_ARTICLE_MAX_CHARS,
      KNOWLEDGE_FILE_MAX_MB,
    } = await import("./doc-text");

    const bytes = decodeBase64(data.base64);
    if (bytes.length > KNOWLEDGE_FILE_MAX_MB * 1024 * 1024) {
      return {
        ok: false as const,
        error: `Файл больше ${KNOWLEDGE_FILE_MAX_MB} МБ — разделите его на части или вставьте текст через «Импорт текстом».`,
      };
    }

    const extracted = await extractDocumentText(bytes, data.fileName);
    if (!extracted.ok) return { ok: false as const, error: extracted.error };

    const { parseKnowledgeArticlesFromText, loadConsultantKnowledge, saveConsultantKnowledge } =
      await import("./knowledge");

    let newArticles = parseKnowledgeArticlesFromText(extracted.text);
    if (newArticles.length === 0) {
      return { ok: false as const, error: "Не удалось выделить текст из файла." };
    }

    // В PDF от фабрики разделителей ### и --- нет, поэтому файл становится
    // одной статьёй. Заголовком берём имя файла: иначе им станет случайная
    // первая строка вёрстки, и статью потом не найти в списке.
    if (newArticles.length === 1 && !hasSectionMarkers(extracted.text)) {
      newArticles = [
        { ...newArticles[0], title: titleFromFileName(data.fileName), content: extracted.text },
      ];
    }

    const capped = newArticles.map((a) => ({
      ...a,
      content: a.content.slice(0, KNOWLEDGE_ARTICLE_MAX_CHARS),
    }));
    const truncated: boolean = capped.some(
      (a, i) => a.content.length < newArticles[i].content.length,
    );
    newArticles = capped;

    const existing = await loadConsultantKnowledge();
    const merged = [...existing, ...newArticles];
    await saveConsultantKnowledge(merged);
    return {
      ok: true as const,
      count: newArticles.length,
      total: merged.length,
      truncated,
      maxChars: KNOWLEDGE_ARTICLE_MAX_CHARS,
    };
  });

export const importConsultantKnowledgeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ text: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { parseKnowledgeArticlesFromText, loadConsultantKnowledge, saveConsultantKnowledge } =
      await import("./knowledge");
    const newArticles = parseKnowledgeArticlesFromText(data.text);
    if (newArticles.length === 0) {
      return { ok: false as const, error: "Не удалось выделить статьи из текста. Используйте разделители ### или --- и теги." };
    }
    const existing = await loadConsultantKnowledge();
    const merged = [...existing, ...newArticles];
    await saveConsultantKnowledge(merged);
    return { ok: true as const, count: newArticles.length, total: merged.length };
  });

