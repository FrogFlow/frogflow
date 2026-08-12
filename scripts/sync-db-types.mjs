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

/**
 * NOT NULL columns filled by a BEFORE INSERT trigger rather than a column
 * DEFAULT. PostgREST reports no default for these, so without this list they
 * would be typed as required and correct inserts would fail typecheck.
 */
const TRIGGER_POPULATED = new Set(["orders.order_no"]);

/**
 * Is the column safe to omit on insert?
 *
 * Nullable, or the database fills it in. PostgREST does not report defaults it
 * cannot express in OpenAPI — notably `'[]'::jsonb` — so a NOT NULL jsonb with
 * no stated default is treated as optional too, otherwise correct inserts that
 * rely on that default would fail typecheck.
 */
function optionalOnInsert(prop, isRequired, table, col) {
  if (!isRequired) return true;
  if (prop.default !== undefined) return true;
  if (TRIGGER_POPULATED.has(`${table}.${col}`)) return true;
  return (prop.format ?? "").includes("json");
}

/** Renders a whole table block for a table types.ts has never seen. */
function renderTable(table, def) {
  const required = new Set(def.required ?? []);
  const props = def.properties ?? {};
  const cols = Object.keys(props);

  const line = (col, kind) => {
    const t = tsType(props[col]);
    const nullable = !required.has(col);
    const optional =
      kind === "update" ? true : kind === "insert" ? optionalOnInsert(props[col], required.has(col), table, col) : false;
    return `          ${col}${optional ? "?" : ""}: ${t}${nullable ? " | null" : ""}`;
  };

  // PostgREST notes foreign keys in the column description, e.g.
  //   <fk table='bots' column='id'/>
  const rels = cols.flatMap((col) => {
    const m = /<fk table='([^']+)' column='([^']+)'\/>/.exec(props[col].description ?? "");
    if (!m) return [];
    return [
      `          {
            foreignKeyName: "${table}_${col}_fkey"
            columns: ["${col}"]
            isOneToOne: false
            referencedRelation: "${m[1]}"
            referencedColumns: ["${m[2]}"]
          },`,
    ];
  });

  return (
    `      ${table}: {\n` +
    `        Row: {\n${cols.map((c) => line(c, "row")).join("\n")}\n        }\n` +
    `        Insert: {\n${cols.map((c) => line(c, "insert")).join("\n")}\n        }\n` +
    `        Update: {\n${cols.map((c) => line(c, "update")).join("\n")}\n        }\n` +
    `        Relationships: [${rels.length ? "\n" + rels.join("\n") + "\n        " : ""}]\n` +
    `      }\n`
  );
}

let src = fs.readFileSync(TYPES_PATH, "utf8");
const report = [];

for (const [table, def] of Object.entries(defs)) {
  // Locate this table's block: "      <table>: {" up to the matching "      }"
  const blockRe = new RegExp(`(^ {6}${table}: \\{\\n)([\\s\\S]*?)(\\n {6}\\}\\n)`, "m");
  const block = src.match(blockRe);
  if (!block) {
    src = src.replace(/( {4}Tables: \{\n)/, `$1${renderTable(table, def)}`);
    report.push(`  + ${table}: таблица добавлена целиком`);
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

    const rowLine = `          ${col}: ${t}${nullable ? " | null" : ""}`;
    const insLine = `          ${col}${optionalOnInsert(props[col], required.has(col), table, col) ? "?" : ""}: ${t}${nullable ? " | null" : ""}`;
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
