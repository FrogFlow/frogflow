import { createHash } from "node:crypto";

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

/** Короткий отпечаток секрета — чтобы сравнить два деплоя, не показывая ключ. */
function secretFingerprint(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return createHash("sha256").update(trimmed).digest("hex").slice(0, 8);
}

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

  // Блок 11, находка 11.3 — currentVertical() (vertical.server.ts) молча
  // откатывается на "digital" на пустой ИЛИ неизвестной переменной: без
  // этой проверки расхождение "в панели выбрана Кондитерская, на деплое
  // digital" необнаружимо ни оператором, ни клиентом — бот просто ведёт
  // себя как цифровой, без единой ошибки.
  {
    const { VERTICALS } = await import("@/lib/verticals/registry");
    const raw = process.env.VERTICAL?.trim();
    if (!raw) {
      add("VERTICAL", "ok", "не задан — digital (по умолчанию)");
    } else if (raw in VERTICALS) {
      add("VERTICAL", "ok", raw);
    } else {
      add(
        "VERTICAL",
        "warn",
        `неизвестное значение "${raw}" — деплой работает как digital, а не как задумано`,
      );
    }
  }

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
      "Ключ Instagram API",
      has(process.env.ZERNIO_API_KEY) ? "ok" : "fail",
      has(process.env.ZERNIO_API_KEY)
        ? `задан, отпечаток ${secretFingerprint(process.env.ZERNIO_API_KEY)}`
        : "модуль Instagram включён, а ключ сервиса не задан",
    );
  }
  if (modules.instagram) {
    /**
     * Почта — обязательная часть продаж в Instagram, а не удобство.
     *
     * Заказ оттуда выдаётся письмом, потому что Direct не принимает
     * вложениями документы, а окно на ответ там 24 часа (см. mail.server.ts).
     * Без SMTP путь покупателя доходит до самого конца — человек оплатил,
     * прислал чек, оставил адрес — и обрывается на подтверждении продавцом.
     * Поэтому здесь fail, а не warn: узнать об этом надо до первой продажи,
     * а не после неё.
     */
    const smtpReady =
      has(process.env.SMTP_HOST) && has(process.env.SMTP_USER) && has(process.env.SMTP_PASSWORD);
    const smtpMissing = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"].filter(
      (name) => !has(process.env[name]),
    );
    add(
      "Отправка почты покупателям",
      smtpReady ? "ok" : "fail",
      smtpReady
        ? `настроена (${process.env.SMTP_HOST})`
        : `не задано: ${smtpMissing.join(", ")} — заказы из Instagram выдать будет нечем, ` +
            "материалы туда уходят письмом",
    );

    /**
     * Автовыдача по чеку — не обязательна, но именно она снимает работу с
     * продавца: сумма в чеке сошлась, материалы ушли сами. Без ключа Vision
     * каждый заказ придётся подтверждать руками, и продавец должен понимать,
     * почему это так, а не думать, что бот сломался.
     */
    if (modules.receipt_ocr) {
      add(
        "Автовыдача по чеку",
        has(process.env.GOOGLE_VISION_API_KEY) ? "ok" : "warn",
        has(process.env.GOOGLE_VISION_API_KEY)
          ? "распознавание чеков настроено — сошедшиеся суммы выдаются без участия продавца"
          : "модуль распознавания включён, но GOOGLE_VISION_API_KEY не задан: каждый заказ придётся подтверждать вручную",
      );
    }

    add(
      "Профиль Instagram",
      has(process.env.ZERNIO_PROFILE_ID) ? "ok" : "fail",
      has(process.env.ZERNIO_PROFILE_ID)
        ? `задан, отпечаток ${secretFingerprint(process.env.ZERNIO_PROFILE_ID)}`
        : "Instagram включён, но профиль интеграции не задан — webhook будет отключён для безопасности",
    );
    add(
      "Секрет Instagram webhook",
      has(process.env.ZERNIO_WEBHOOK_SECRET) ? "ok" : "fail",
      has(process.env.ZERNIO_WEBHOOK_SECRET)
        ? "задан"
        : "Instagram включён, но секрет webhook не задан — подпись событий нельзя проверить",
    );

    /**
     * Переменные могут быть на месте, а Direct всё равно молчит: вебхук в
     * Zernio снят, аккаунт истёк, либо события просто перестали доезжать.
     * Это как раз кейс aa_teach_ в сентябре 2026 — Comment-to-DM жил, /start
     * в директ нет. Смотрим живое состояние, а не только env.
     */
    if (has(process.env.ZERNIO_API_KEY)) {
      const { inspectZernioConnection } = await import("../zernio.server");
      const connection = await inspectZernioConnection();
      if (connection.error) {
        add("Подключение Instagram", "fail", `сервис интеграции не ответил: ${connection.error}`);
      } else {
        const expired = connection.accounts.filter((account) => account.expired);
        const igAccounts = connection.accounts.filter(
          (account) => account.platform === "instagram",
        );
        if (connection.fit === "ok") {
          add(
            "Webhook Instagram",
            "ok",
            connection.currentUrl ? `слушает ${connection.currentUrl}` : "зарегистрирован",
          );
        } else {
          add(
            "Webhook Instagram",
            "fail",
            connection.fit === "missing"
              ? "запись webhook в интеграции отсутствует — Direct не получает /start"
              : `webhook указывает на ${connection.currentUrl || "другой адрес"} — нужен адрес этого деплоя`,
          );
        }
        if (igAccounts.length === 0) {
          add(
            "Аккаунт Instagram",
            "fail",
            "к профилю интеграции не привязан ни один Instagram-аккаунт",
          );
        } else if (expired.length > 0) {
          add(
            "Аккаунт Instagram",
            "fail",
            `истёк токен: ${expired.map((account) => account.username).join(", ")} — нужно переподключить в админке`,
          );
        } else {
          add("Аккаунт Instagram", "ok", igAccounts.map((account) => account.username).join(", "));
        }
      }

      try {
        const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
        const { data: lastDm } = await supabaseAdmin
          .from("zernio_logs")
          .select("created_at")
          .eq("event_type", "message.received")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!lastDm?.created_at) {
          add("Входящие Direct", "warn", "в журнале ещё нет ни одного входящего сообщения");
        } else {
          const ageHours = (Date.now() - new Date(lastDm.created_at).getTime()) / 3_600_000;
          const when = new Date(lastDm.created_at).toISOString().slice(0, 16).replace("T", " ");
          if (ageHours > 72) {
            add(
              "Входящие Direct",
              "fail",
              `последнее входящее ${Math.floor(ageHours / 24)} дн. назад (${when} UTC) — webhook, скорее всего, не доставляет события`,
            );
          } else if (ageHours > 24) {
            add(
              "Входящие Direct",
              "warn",
              `последнее входящее ${Math.floor(ageHours)} ч. назад (${when} UTC)`,
            );
          } else {
            add("Входящие Direct", "ok", `последнее входящее ${when} UTC`);
          }
        }
      } catch (e: unknown) {
        const { errorMessage } = await import("../error-message");
        add("Входящие Direct", "warn", `не удалось прочитать журнал: ${errorMessage(e)}`);
      }
    }
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
