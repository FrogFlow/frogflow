#!/usr/bin/env node
/**
 * Syncs src/integrations-supabase/types.ts with the live database.
 *
 * The checked-in types were generated long ago and have drifted: columns added
 * since (bot_id, category_ids, file_path_kz, …) are missing, so any query
 * touching them fails typecheck even though it is correct at runtime.
 *
 * Rather than regenerate the whole file — which would drop the hand-verified
 * Relationships blocks that typed embeds rely on — this adds only the columns
 * the database has and the types file lacks, leaving everything else intact.
 *
 * Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/sync-db-types.mjs
 */
import fs from "node:fs";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Задайте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const TYPES_PATH = "src/integrations-supabase/types.ts";

const res = await fetch(`${URL_}/rest/v1/`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
if (!res.ok) {
  console.error("Не удалось прочитать схему:", res.status, await res.text());
  process.exit(1);
}
const spec = await res.json();
const defs = spec.definitions ?? {};

/** PostgREST's OpenAPI type → TypeScript type. */
function tsType(prop) {
  const fmt = prop.format ?? "";
  if (fmt.includes("json")) return "Json";
  if (prop.type === "array") return fmt.startsWith("uuid") || fmt.startsWith("text") ? "string[]" : "Json";
  if (prop.type === "integer" || prop.type === "number") return "number";
  if (prop.type === "boolean") return "boolean";
  return "string";
}

let src = fs.readFileSync(TYPES_PATH, "utf8");
const report = [];

for (const [table, def] of Object.entries(defs)) {
  // Locate this table's block: "      <table>: {" up to the matching "      }"
  const blockRe = new RegExp(`(^ {6}${table}: \\{\\n)([\\s\\S]*?)(\\n {6}\\}\\n)`, "m");
  const block = src.match(blockRe);
  if (!block) {
    report.push(`  ⚠ ${table}: нет в types.ts (новая таблица — нужна полная регенерация)`);
    continue;
  }

  const required = new Set(def.required ?? []);
  const props = def.properties ?? {};

  // Which columns does the Row block already list?
  const rowMatch = block[2].match(/ {8}Row: \{\n([\s\S]*?)\n {8}\}/);
  if (!rowMatch) continue;
  const present = new Set(
    [...rowMatch[1].matchAll(/^ {10}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]),
  );

  const missing = Object.keys(props).filter((c) => !present.has(c));
  if (missing.length === 0) continue;

  let updated = block[0];
  for (const col of missing) {
    const t = tsType(props[col]);
    const nullable = !required.has(col);
    const hasDefault = props[col].default !== undefined;

    const rowLine = `          ${col}: ${t}${nullable ? " | null" : ""}`;
    // Optional on insert when the database can fill it in itself.
    const insLine = `          ${col}${nullable || hasDefault ? "?" : ""}: ${t}${nullable ? " | null" : ""}`;
    const updLine = `          ${col}?: ${t}${nullable ? " | null" : ""}`;

    updated = updated
      .replace(/( {8}Row: \{\n)/, `$1${rowLine}\n`)
      .replace(/( {8}Insert: \{\n)/, `$1${insLine}\n`)
      .replace(/( {8}Update: \{\n)/, `$1${updLine}\n`);
  }

  src = src.replace(block[0], updated);
  report.push(`  ✓ ${table}: +${missing.length} (${missing.join(", ")})`);
}

fs.writeFileSync(TYPES_PATH, src);
console.log(report.length ? report.join("\n") : "  всё уже совпадает");
