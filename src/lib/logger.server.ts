/**
 * Структурированный логгер вместо голого console.*. Формат — плоский JSON в
 * одну строку на запись: Vercel Log Drains и встроенный Log Explorer
 * разбирают такие записи как поля (level/event/…), а не как текст — можно
 * фильтровать и искать, а не grep'ать по подстроке через шесть деплоев.
 *
 * Политика PII — соблюдать при каждом вызове, а не полагаться на то, что
 * логи Vercel "и так приватные":
 *   - e-mail и телефон покупателя — только через maskEmail()/maskPhone()
 *     ниже, никогда как есть;
 *   - свободный текст (сообщение покупателя, комментарий, payload вебхука) —
 *     через truncate() с разумным пределом: это подсказка для диагностики,
 *     а не архив переписки;
 *   - telegram_id, bot_id, order_id, event_id — можно и нужно передавать как
 *     есть: это не PII, а как раз то, по чему потом ищут инцидент.
 *
 * Не подменяет собой все 150+ существующих console.* по проекту разом —
 * это отдельная механическая миграция, которую стоит делать постепенно, по
 * файлу за раз, с проверкой, что формат логов не потерял то, на что уже
 * настроены глаза при разборе инцидентов. Использовать в новом коде и там,
 * где логируется что-то похожее на PII (см. использование в
 * zernio-bot.server.ts).
 */

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown> & { err?: unknown };

function normalizeErr(err: unknown): { message: string; stack?: string } | undefined {
  if (err === undefined) return undefined;
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return { message: String(err) };
}

function emit(level: Level, event: string, fields?: Fields) {
  const { err, ...rest } = fields ?? {};
  const line = {
    level,
    event,
    time: new Date().toISOString(),
    ...rest,
    ...(err !== undefined ? { err: normalizeErr(err) } : {}),
  };
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  debug: (event: string, fields?: Fields) => emit("debug", event, fields),
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};

/** Обрезает свободный текст (сообщение покупателя, комментарий и т.п.) до предела для диагностики. */
export function truncate(value: string | null | undefined, max = 80): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Маскирует e-mail, оставляя домен — годится для диагностики, не для восстановления адреса. */
export function maskEmail(value: string | null | undefined): string {
  if (!value) return "";
  const at = value.indexOf("@");
  if (at <= 0) return "***";
  return `${value.slice(0, 1)}***@${value.slice(at + 1)}`;
}

/** Маскирует телефон, оставляя последние 4 цифры. */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}
