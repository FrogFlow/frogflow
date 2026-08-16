/**
 * Самодиагностика клиентского деплоя: что у него настроено, а что нет.
 *
 * Ради этого файла и затевалось. Подключение нового клиента упирается не в
 * мастер, а в то, что происходит после: переменные вставлены в Vercel, деплой
 * собрался — и дальше приходится гадать. Print KZ отдавал 500, потому что не
 * было SUPABASE_URL. Дидактика — потому что в JWT попал символ «•» из
 * замаскированного поля Vercel. Оба раза диагноз ставился по логам сборки.
 *
 * Деплой знает о себе всё это сам. Здесь он отвечает списком: какие
 * переменные на месте, сходится ли ключ арендатора со своим BOT_ID, не
 * остались ли пароли по умолчанию.
 *
 * ЗНАЧЕНИЙ ЗДЕСЬ НЕ ОТДАЁТСЯ НИ ОДНОГО — только имена, флаги и то, что можно
 * безопасно показать оператору. Ответ уходит в панель, а панель — в браузер.
 */

export type CheckLevel = "ok" | "warn" | "fail";

export type ConfigCheck = {
  name: string;
  level: CheckLevel;
  /** Что оператор увидит рядом с пунктом. */
  detail: string;
};

export type Diagnostics = {
  bot_id: string | null;
  /** Адрес, за который деплой себя считает: сверяется с bots.app_url в панели. */
  app_origin: string | null;
  checks: ConfigCheck[];
};

const has = (v: string | undefined) => Boolean(v && v.trim());

/** Разбирает payload JWT, ничего не проверяя криптографически: нужен только claim. */
function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function selfDiagnostics(): Promise<Diagnostics> {
  const checks: ConfigCheck[] = [];
  const add = (name: string, level: CheckLevel, detail: string) =>
    checks.push({ name, level, detail });

  const botId = process.env.BOT_ID?.trim() || null;
  const { appOrigin } = await import("../app-origin.server");
  const origin = appOrigin() || null;

  // ── Арендатор ────────────────────────────────────────────────────────────
  if (!botId) {
    add("BOT_ID", "fail", "не задан — деплой не знает, чей он, и пойдёт в базу как service_role");
  } else {
    add("BOT_ID", "ok", botId);
  }

  const tenantKey = process.env.SUPABASE_TENANT_KEY?.trim();
  if (!tenantKey) {
    add(
      "SUPABASE_TENANT_KEY",
      "fail",
      "не задан — деплой видит данные всех клиентов, а не только свои",
    );
  } else {
    const payload = jwtPayload(tenantKey);
    const role = String(payload?.role ?? "");
    const keyBotId = String(payload?.bot_id ?? "");
    if (role !== "tenant_bot") {
      add(
        "SUPABASE_TENANT_KEY",
        "fail",
        `роль в ключе «${role || "не разобрана"}», а нужна tenant_bot`,
      );
    } else if (botId && keyBotId !== botId) {
      // Классическая ошибка при переезде: вставили ключ другого клиента.
      add("SUPABASE_TENANT_KEY", "fail", `ключ выписан на другого клиента (${keyBotId})`);
    } else {
      const exp = Number(payload?.exp ?? 0);
      const days = exp ? Math.round((exp * 1000 - Date.now()) / 86_400_000) : 0;
      add(
        "SUPABASE_TENANT_KEY",
        days > 30 ? "ok" : "warn",
        days > 0 ? `свой bot_id, годен ещё ${days} дн.` : "срок действия истёк",
      );
    }
  }

  // ── База ────────────────────────────────────────────────────────────────
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY"]) {
    add(
      name,
      has(process.env[name]) ? "ok" : "fail",
      has(process.env[name]) ? "задан" : "не задан",
    );
  }

  // Переменные VITE_* вшиваются в бандл во время сборки. Проверять их через
  // process.env бесполезно — Vite подставляет значения прямо в код, поэтому
  // читаем именно так. Пустое значение здесь значит одно: переменных не было
  // в момент сборки, и браузерная часть не заработает, пока не пересобрать.
  const viteUrl = import.meta.env?.VITE_SUPABASE_URL;
  const viteKey = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  add(
    "VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY",
    has(viteUrl) && has(viteKey) ? "ok" : "fail",
    has(viteUrl) && has(viteKey)
      ? "вшиты в сборку"
      : "не попали в сборку — добавьте их в Vercel и пересоберите проект",
  );

  // ── Telegram ────────────────────────────────────────────────────────────
  add(
    "TELEGRAM_BOT_TOKEN",
    has(process.env.TELEGRAM_BOT_TOKEN) ? "ok" : "fail",
    has(process.env.TELEGRAM_BOT_TOKEN) ? "задан" : "не задан — бот не сможет отвечать",
  );
  add(
    "TELEGRAM_WEBHOOK_SECRET",
    has(process.env.TELEGRAM_WEBHOOK_SECRET) ? "ok" : "warn",
    has(process.env.TELEGRAM_WEBHOOK_SECRET)
      ? "задан"
      : "не задан — вебхук примет запрос от кого угодно",
  );

  // ── Приложение ──────────────────────────────────────────────────────────
  add(
    "PUBLIC_APP_URL",
    origin ? "ok" : "fail",
    origin ?? "не определён — ссылки в боте и колбэки оплаты уйдут в никуда",
  );

  // Два пункта, из-за которых чужой человек попадает в админку клиента.
  const adminPass = process.env.ADMIN_PASSWORD?.trim();
  add(
    "ADMIN_PASSWORD",
    adminPass ? "ok" : "fail",
    adminPass ? "задан" : "не задан — вход в админку остаётся admin/admin",
  );
  const sessionSecret = process.env.SESSION_SECRET?.trim() ?? "";
  add(
    "SESSION_SECRET",
    sessionSecret.length >= 32 ? "ok" : "fail",
    sessionSecret.length >= 32
      ? "задан"
      : sessionSecret
        ? `короче 32 символов (${sessionSecret.length}) — сессия не поднимется`
        : "не задан — cookie админа подписывается значением из исходников",
  );
  add(
    "CRON_SECRET",
    has(process.env.CRON_SECRET) ? "ok" : "warn",
    has(process.env.CRON_SECRET) ? "задан" : "не задан — рассылка по расписанию не заработает",
  );

  // ── Модули, которым нужны свои ключи ────────────────────────────────────
  const { loadModules } = await import("@/lib/modules/modules.server");
  let modules: Record<string, boolean> = {};
  try {
    modules = await loadModules();
  } catch {
    // Не смогли прочитать модули — значит, не работает связка с базой, и об
    // этом уже сказано выше. Второй раз шуметь незачем.
  }

  if (modules.vip) {
    add(
      "VIP_BOT_TOKEN",
      has(process.env.VIP_BOT_TOKEN) ? "ok" : "fail",
      has(process.env.VIP_BOT_TOKEN)
        ? "задан"
        : "модуль VIP включён, а токен второго бота не задан",
    );
    add(
      "VIP_BOT_USERNAME",
      has(process.env.VIP_BOT_USERNAME) ? "ok" : "warn",
      has(process.env.VIP_BOT_USERNAME) ? "задан" : "не задан — ссылка на VIP-бота будет пустой",
    );
  }
  if (modules.instagram) {
    add(
      "ZERNIO_API_KEY",
      has(process.env.ZERNIO_API_KEY) ? "ok" : "fail",
      has(process.env.ZERNIO_API_KEY)
        ? "задан"
        : "модуль Instagram включён, а ключ Zernio не задан",
    );
  }
  if (modules.instagram) {
    add(
      "ZERNIO_WEBHOOK_SECRET",
      has(process.env.ZERNIO_WEBHOOK_SECRET) ? "ok" : "fail",
      has(process.env.ZERNIO_WEBHOOK_SECRET)
        ? "configured"
        : "Instagram is enabled but Zernio webhook signature verification is not configured",
    );
  }
  if (modules.receipt_ocr) {
    add(
      "GOOGLE_VISION_API_KEY",
      has(process.env.GOOGLE_VISION_API_KEY) ? "ok" : "warn",
      has(process.env.GOOGLE_VISION_API_KEY)
        ? "задан"
        : "распознавание чека включено, но ключ не задан — чеки придётся проверять глазами",
    );
  }

  return { bot_id: botId, app_origin: origin, checks };
}
