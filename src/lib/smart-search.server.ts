/**
 * Умный поиск по каталогу (Кейс 3, №9).
 *
 * Включается отдельным переключателем в настройках (app_settings
 * smart_search_enabled), а не автоматически при наличии ключа: в отличие от
 * остальных задач этого кейса, у смарт-поиска есть реальная стоимость за
 * каждый вызов (обращение к Anthropic API), и продавец должен решить это
 * сознательно, а не получить платный трафик тихо включённым по умолчанию.
 *
 * Срабатывает только когда обычный ILIKE-поиск (bot.server.ts showSearch)
 * ничего не нашёл — это фолбэк для запросов вроде «что-то на день рождения
 * пятилетке», которые не совпадают по словам ни с одним товаром, а не
 * замена быстрому точному поиску.
 */
import { parseSmartSearchIds } from "./smart-search";
import { hasModule } from "./modules/modules.server";

const MODEL = "claude-haiku-4-5-20251001";
/**
 * Верхняя граница каталога, которую видит умный поиск. Должна с запасом
 * покрывать реальный размер каталога клиента — иначе часть товаров для
 * LLM просто не существует, и это никак не проявляется (не ошибка, а
 * тихо урезанный список кандидатов). Экспортируется, чтобы bot.server.ts
 * лимитировал запрос к БД тем же числом.
 *
 * Не «без границы» намеренно: это общий код для всех арендаторов платформы,
 * не только для этого клиента с ~400 товарами — у следующего может быть
 * каталог на порядок больше, и совсем без потолка один такой клиент разово
 * отправлял бы в LLM запрос, который либо не влезает в контекст модели
 * (200K токенов у Haiku 4.5), либо стоит неадекватно дорого за один поиск.
 * 600 — с кратным запасом под рост конкретно этого каталога, но не
 * бесконечность.
 */
export const MAX_CANDIDATES = 600;
const MAX_QUERY_LEN = 200;
/**
 * Раньше стояло 25с — но настоящий потолок здесь не наш AbortSignal, а два
 * чужих таймаута сверху: лимит времени выполнения serverless-функции на
 * Vercel (см. DEPLOYMENT.md про тот же класс проблемы у вебхука Zernio) и
 * собственный таймаут доставки вебхука у Telegram. Если один из них
 * срабатывает раньше нашего — Telegram не получает ответа, повторяет
 * доставку апдейта, а повтор попадает в кулдаун (сработавший ещё на первой
 * попытке) и тихо уходит в «ничего не найдено», хотя запрос к Anthropic
 * реально ушёл и потратил токены. 40с — заметно больше прежних 25, но с
 * запасом ниже обоих чужих потолков, а не впритык к ним. Vercel Dashboard →
 * Settings → Functions → Function Max Duration должен быть не меньше этого
 * значения, иначе поднятие тут ничего не даст.
 */
const TIMEOUT_MS = 40_000;
// Каждый вызов — реальные деньги на счету Anthropic, а бот открыт всем в
// Telegram (не только покупателям). Без предохранителя один скучающий
// человек, слающий несовпадающие запросы подряд, накручивает продавцу
// счёт без всякого ограничения.
const COOLDOWN_SECONDS = 45;
const DAILY_LIMIT = 200;

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export type SmartSearchCandidate = {
  id: string;
  name: string;
  description: string | null;
  keywords: string | null;
};

export async function isSmartSearchEnabled(): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return false;
  if (!(await hasModule("smart_search"))) return false;
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", "smart_search_enabled")
    .maybeSingle();
  return data?.value === "true";
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Личный кулдаун покупателя — не чаще раза в COOLDOWN_SECONDS, независимо
 * от того, сколько несовпадающих запросов он пришлёт подряд. Метка времени
 * живёт в bot_users.state рядом с остальными полями состояния — отдельная
 * таблица тут не нужна, это не история, а один таймстемп на пользователя.
 */
async function checkAndTouchCooldown(telegramId: number): Promise<boolean> {
  const s = await db();
  const { data: user } = await s
    .from("bot_users")
    .select("state")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  const state =
    user?.state && typeof user.state === "object" && !Array.isArray(user.state)
      ? (user.state as Record<string, unknown>)
      : {};
  const last = typeof state.last_smart_search_at === "string" ? state.last_smart_search_at : null;
  const now = Date.now();
  if (last && now - new Date(last).getTime() < COOLDOWN_SECONDS * 1000) return false;

  await s
    .from("bot_users")
    .update({ state: { ...state, last_smart_search_at: new Date(now).toISOString() } })
    .eq("telegram_id", telegramId);
  return true;
}

/**
 * Общий дневной потолок вызовов на бота целиком — грубый предохранитель,
 * не точный счётчик (обычное чтение-затем-запись, без CAS: гонка двух
 * одновременных запросов у разных покупателей максимум даст +1 к лимиту в
 * очень редком случае, а не пробьёт его многократно). Дата в самом
 * значении — новый день сбрасывает счётчик сам, без отдельного крона.
 */
async function checkAndConsumeDailyLimit(): Promise<boolean> {
  const s = await db();
  const key = "smart_search_daily_count";
  const { data } = await s.from("app_settings").select("value").eq("key", key).maybeSingle();
  const [storedDate, storedCountRaw] = (data?.value ?? "").split(":");
  const count = storedDate === todayKey() ? Number(storedCountRaw) || 0 : 0;
  if (count >= DAILY_LIMIT) return false;

  await s.from("app_settings").upsert({ key, value: `${todayKey()}:${count + 1}` });
  return true;
}

/** Оба предохранителя разом — если хоть один не пройден, вызов LLM не делаем вовсе. */
export async function consumeSmartSearchQuota(telegramId: number): Promise<boolean> {
  if (!(await checkAndTouchCooldown(telegramId))) return false;
  return checkAndConsumeDailyLimit();
}

/**
 * Единственная видимость сбоя умного поиска сейчас — console.error, который
 * уходит в лог Vercel и никак не всплывает продавцу: он видит только «ничего
 * не найдено» и не может отличить реальный промах модели от 429/сетевой
 * ошибки. Пишем последнюю причину в app_settings — тот же ключ читает
 * /admin/settings, чтобы продавец видел её прямо рядом с переключателем.
 */
async function recordSmartSearchError(detail: string) {
  try {
    const s = await db();
    await s.from("app_settings").upsert({
      key: "smart_search_last_error",
      value: `${new Date().toISOString()} — ${detail}`.slice(0, 500),
    });
  } catch (e) {
    console.error("[smart-search] failed to record diagnostic", e);
  }
}

async function clearSmartSearchError() {
  try {
    const s = await db();
    await s.from("app_settings").upsert({ key: "smart_search_last_error", value: "" });
  } catch (e) {
    console.error("[smart-search] failed to clear diagnostic", e);
  }
}

/**
 * Возвращает id кандидатов, реально подходящих запросу по смыслу, в порядке
 * убывания релевантности — или null при любом сбое (нет ключа, сеть,
 * невалидный ответ), чтобы вызывающий код просто показал «ничего не
 * найдено», как и раньше, а не упал.
 */
export async function smartSearchProductIds(
  query: string,
  candidates: SmartSearchCandidate[],
): Promise<string[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const trimmedQuery = query.trim().slice(0, MAX_QUERY_LEN);
  if (!trimmedQuery || candidates.length === 0) return null;

  // Не «без ограничения»: поле description в товаре разрешено до 4000
  // символов (products.functions.ts), и 600 кандидатов по 4000 символов —
  // это реальный риск не влезть в контекст модели (200K токенов у Haiku
  // 4.5) или выйти за разумную стоимость одного поиска. 300/100 — заметно
  // длиннее прежних 150/60 (обычное описание товара — одно-два предложения,
  // укладывается целиком), но с запасом даже на каталог, где у каждого
  // товара из 600 забито максимально длинное описание.
  const list = candidates.slice(0, MAX_CANDIDATES).map((c) => ({
    id: c.id,
    name: c.name,
    description: (c.description ?? "").slice(0, 300),
    keywords: (c.keywords ?? "").slice(0, 100),
  }));

  const prompt =
    `Покупатель ищет товар в интернет-магазине. Запрос: "${trimmedQuery}"\n\n` +
    `Список товаров (JSON):\n${JSON.stringify(list)}\n\n` +
    `Выбери id товаров, которые реально подходят под запрос по смыслу — не только по точному ` +
    `совпадению слов. Если ничего не подходит, верни пустой список. Отвечай СТРОГО одним JSON-` +
    `объектом без пояснений, в формате {"ids": ["id1", "id2"]}, id упорядочены по убыванию ` +
    `релевантности.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        // MAX_CANDIDATES (600) полными UUID в худшем случае — с запасом,
        // чтобы модель не обрезала валидный JSON на середине массива id
        // (обрезанный ответ раньше молча читался как «ничего не подходит»,
        // а не как ошибка). Меняется вместе с MAX_CANDIDATES, не отдельно.
        // Само число ничего не стоит сверху — биллится по факту сгенерированного.
        max_tokens: 12_000,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[smart-search] Anthropic API error", res.status, body);
      await recordSmartSearchError(`HTTP ${res.status}: ${body.slice(0, 300)}`);
      return null;
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.find((b) => b.type === "text")?.text ?? "";
    const ids = parseSmartSearchIds(
      text,
      list.map((c) => c.id),
    );
    // Успешный ответ, даже пустой список (модель реально не нашла
    // совпадений) — не ошибка, снимаем предыдущую тревогу, если она была.
    await clearSmartSearchError();
    return ids;
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("[smart-search] request failed", e);
    await recordSmartSearchError(detail);
    return null;
  }
}
