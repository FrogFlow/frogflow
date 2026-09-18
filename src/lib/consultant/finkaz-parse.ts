/**
 * Разбор курса рубля со страницы банка на finkaz.kz.
 *
 * Зачем вообще сторонний сайт. ВТБ Казахстан отвечает только на запросы из
 * Казахстана, а деплой стоит за границей: прямой запрос оттуда не проходит
 * никогда. Сайты самих банков (Kaspi, Halyk, Freedom) курс в ответе сервера
 * не отдают — числа подставляет скрипт уже в браузере. finkaz отдаёт их
 * обычным текстом и открывается снаружи, поэтому источник здесь.
 *
 * Разметка чужая и может измениться в любой день, поэтому разбор нарочно
 * недоверчивый: коридор правдоподобия, покупка строго дешевле продажи и
 * отметка времени самого сайта. Не сошлось — лучше не обновить курс и
 * показать это в панели, чем посчитать покупателю цену по чужому числу.
 */

export type BankRateQuote = {
  /** Курс покупки рубля банком — от него считается цена в рублях. */
  buy: number;
  /** Курс продажи. В расчёте не участвует, нужен для проверки и для панели. */
  sell?: number;
  /** Время обновления, объявленное самим finkaz (время Алматы), в ISO. */
  sourceUpdatedAt?: string;
};

/** RUB/KZT вне этого коридора — не курс, а что-то другое со страницы. */
const RATE_MIN = 1;
const RATE_MAX = 20;

/** Алматы — UTC+5 круглый год, перевода часов в Казахстане нет. */
const ALMATY_UTC_OFFSET_HOURS = 5;

function plausible(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n > RATE_MIN && n < RATE_MAX ? n : null;
}

/** Текст страницы без скриптов, стилей и разметки. */
export function stripMarkup(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** «Обновлено: 18.09.2026 21:30» — время Алматы, возвращаем в ISO. */
export function parseFinkazUpdatedAt(text: string): string | undefined {
  const m = text.match(/Обновлено:?\s*(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const [, dd, mm, yyyy, hh, min] = m;
  const ms = Date.UTC(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh) - ALMATY_UTC_OFFSET_HOURS,
    Number(min),
  );
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/**
 * Строка «RUB / KZT 4.45 5.45» из таблицы «Текущие курсы» страницы банка.
 * Первое число — сколько банк платит за рубль, второе — за сколько продаёт.
 */
export function parseFinkazRubQuote(html: string): BankRateQuote | null {
  const text = stripMarkup(html);
  const m = text.match(/RUB\s*\/\s*KZT\s+([\d.,]+)\s+([\d.,]+)/);
  if (!m) return null;
  const buy = plausible(m[1]);
  const sell = plausible(m[2]);
  if (buy == null) return null;
  // Банк всегда покупает дешевле, чем продаёт. Пришло наоборот — столбцы
  // поменялись местами, и «покупка» на самом деле продажа.
  if (sell != null && buy >= sell) return null;
  const sourceUpdatedAt = parseFinkazUpdatedAt(text);
  return { buy, ...(sell != null ? { sell } : {}), ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}) };
}

/** Название банка из адреса страницы: «kaspi-bank» → «Kaspi». */
export function bankNameFromFinkazUrl(url: string): string | null {
  const m = url.match(/finkaz\.kz\/([a-z0-9-]+)\/exchange-rates/i);
  if (!m) return null;
  return m[1]
    .replace(/-bank$/i, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
