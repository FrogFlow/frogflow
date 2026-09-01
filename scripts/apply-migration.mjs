/**
 * Применяет SQL-миграцию на боевой Supabase через Management API.
 *
 * Переменные (из .env / окружения агента):
 *   SUPABASE_ACCESS_TOKEN  — Personal Access Token (sbp_…)
 *   SUPABASE_PROJECT_REF   — ref проекта (fnwksbasxakktscdjlfp)
 *     или SUPABASE_URL (ref вытаскивается из hostname)
 *
 * Использование:
 *   node scripts/apply-migration.mjs MIGRATION-56-web-cart-handoff.sql
 *   node scripts/apply-migration.mjs --check web_cart_handoffs
 *
 * DDL через Data API (service_role) не выполняется — только Management API
 * или SQL Editor. См. MIGRATION-README.md.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";

const API = "https://api.supabase.com/v1";

function projectRef() {
  const ref = (process.env.SUPABASE_PROJECT_REF || "").trim();
  if (ref) return ref;
  const url = (process.env.SUPABASE_URL || "").trim();
  const m = url.match(/https?:\/\/([^.]+)\.supabase\.co/);
  if (m) return m[1];
  throw new Error("Задайте SUPABASE_PROJECT_REF или SUPABASE_URL");
}

function accessToken() {
  const t = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();
  if (!t) throw new Error("Задайте SUPABASE_ACCESS_TOKEN");
  return t;
}

async function runQuery(query, { readOnly = false } = {}) {
  const ref = projectRef();
  const res = await fetch(`${API}/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, read_only: readOnly }),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body?.message
        ? body.message
        : typeof body === "string"
          ? body
          : JSON.stringify(body);
    throw new Error(`Management API ${res.status}: ${msg}`);
  }
  return body;
}

function loadSqlFile(path) {
  const full = resolve(process.cwd(), path);
  if (!existsSync(full)) throw new Error(`Файл не найден: ${full}`);
  let sql = readFileSync(full, "utf8");
  // Убираем блок «Проверка после применения» — он для ручного SQL Editor.
  const cut = sql.search(/^--\s*─+\s*Проверка/m);
  if (cut !== -1) sql = sql.slice(0, cut);
  return sql.trim();
}

async function checkTable(tableName) {
  const rows = await runQuery(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = '${tableName.replace(/'/g, "''")}'
     ORDER BY ordinal_position`,
    { readOnly: true },
  );
  return rows;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Укажите файл: node scripts/apply-migration.mjs MIGRATION-NN-….sql");
    console.error("Или: node scripts/apply-migration.mjs --check <table_name>");
    process.exit(1);
  }

  if (arg === "--check") {
    const table = process.argv[3];
    if (!table) {
      console.error("Укажите имя таблицы для --check");
      process.exit(1);
    }
    const cols = await checkTable(table);
    if (!cols?.length) {
      console.log(`Таблица public.${table} не найдена или пустая схема.`);
      process.exit(2);
    }
    console.log(`public.${table}: ${cols.length} колонок`);
    for (const c of cols) console.log(`  ${c.column_name}: ${c.data_type}`);
    return;
  }

  const sql = loadSqlFile(arg);
  if (!sql) throw new Error("Пустой SQL после обработки файла");

  console.log(`Применяю ${basename(arg)} на проект ${projectRef()}…`);
  await runQuery(sql);
  console.log("OK — миграция выполнена.");

  const name = basename(arg, ".sql");
  if (name.includes("web-cart-handoff")) {
    const cols = await checkTable("web_cart_handoffs");
    console.log(`Проверка: web_cart_handoffs — ${cols?.length ?? 0} колонок`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
