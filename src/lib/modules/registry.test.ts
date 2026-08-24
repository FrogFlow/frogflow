import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MODULE_KEYS, moduleDef } from "./registry";

/**
 * Долговременный предохранитель против ровно того, что случилось с
 * `wa_broadcasts`: модуль объявлен в прайсе как "available" и продаётся, а
 * тумблер в панели не проверяется ни в одном серверном пути — выключить его
 * клиенту не получится технически, даже если он перестал платить.
 *
 * Не заменяет продуктовую проверку — тест доказывает только «ключ где-то
 * встречается в вызове гейта», а не «гейт стоит именно там, где нужно».
 */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts") || entry.name === "routeTree.gen.ts") continue;
    // Excluded, not just uninteresting: registry.ts is where every key is
    // *declared* (including in `requires: [...]` dependency arrays) — if it
    // counted as "gated", a module could pass this test by existing.
    if (full === path.resolve(__dirname, "registry.ts")) continue;
    out.push(full);
  }
  return out;
}

const srcRoot = path.resolve(__dirname, "../../");
const sourceText = collectSourceFiles(srcRoot)
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

/**
 * Deliberately loose: not anchored to `requireModule(`/`hasModule(` at the
 * call site, because real call sites in this codebase aren't always that
 * literal — some go through a locally-renamed wrapper (`check("blocked")`),
 * some build the key in a variable first (`platform === "whatsapp" ?
 * "wa_shop" : "dm_shop"`, then `hasModule(shopModule)`). Anchoring on the
 * function name would silently stop catching real gates the moment either
 * pattern is used, which defeats the point. What every real gate *does*
 * share is that the key appears as a quoted string literal somewhere outside
 * registry.ts — which is also exactly what was missing for `wa_broadcasts`
 * before it got one.
 */
function isGatedSomewhere(key: string): boolean {
  const pattern = new RegExp(`["']${key}["']`);
  return pattern.test(sourceText);
}

/**
 * Known, tracked gaps — not oversights. Both need a product decision (what a
 * shop looks like with the module off: fall back to base currency? force
 * `ru`?), not just a code change, so they're excluded here rather than left
 * to fail CI on every commit until someone picks that up. Remove a key from
 * this list the moment it gets a real gate.
 */
const KNOWN_UNGATED: string[] = ["multi_currency", "multi_language"];

describe("module registry — every sold module has a server-side gate", () => {
  const paidAvailable = MODULE_KEYS.filter((key) => {
    const def = moduleDef(key);
    return def.status === "available" && def.price !== null && !KNOWN_UNGATED.includes(key);
  });

  it("нашёл хотя бы один платный доступный модуль для проверки", () => {
    // Если это когда-нибудь станет 0 — тест ниже промолчит, ничего не
    // проверив, и это не заметят. Проверяем явно.
    expect(paidAvailable.length).toBeGreaterThan(0);
  });

  it.each(paidAvailable)("%s встречается хотя бы в одном requireModule/hasModule", (key) => {
    expect(isGatedSomewhere(key)).toBe(true);
  });
});
