/**
 * Сборка CSV и постраничное чтение — вынесено из export.functions.ts, чтобы
 * это можно было проверить тестами: там всё было заперто внутри серверных
 * функций, которые тянут за собой сессию админа и клиент Supabase.
 *
 * Формат — CSV, а не настоящий .xlsx: файл открывается двойным щелчком в Excel
 * и в Google Таблицах, а собирать OOXML ради того же результата смысла нет.
 * Две детали, без которых Excel открывает такой файл криво:
 *   • BOM в начале — иначе кириллица превращается в кракозябры;
 *   • разделитель «;» — в русской локали Excel запятая считается десятичным
 *     знаком, и строка не разбивается на столбцы.
 */

export const BOM = "﻿";
export const SEP = ";";

/**
 * Экранирование по RFC 4180 плюс защита от формул: Excel исполняет значение,
 * начинающееся с =, +, - или @. Поля вроде имени покупателя и заметки вводит
 * человек, поэтому проверка нужна именно здесь. Собственный «@» к username мы
 * не подставляем — иначе апостроф вылезал бы в каждой строке.
 */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (s.includes(SEP) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.join(SEP), ...rows.map((r) => r.map(cell).join(SEP))];
  // \r\n — Excel так надёжнее переносит строки внутри ячеек.
  return BOM + lines.join("\r\n");
}

/**
 * PostgREST отдаёт максимум 1000 строк за запрос и делает это молча: выгрузка
 * просто обрывается на тысяче, и заметить это можно лишь сверив с базой.
 * Читаем страницами, пока страница приходит полной.
 */
export const PAGE = 1000;

export type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAll<T>(
  page: (from: number, to: number) => Page<T>,
  what: string,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Не удалось выгрузить ${what}: ${error.message}`);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}

export function isoDate(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 19).replace("T", " ");
}
