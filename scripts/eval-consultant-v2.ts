/**
 * Прогон эталонного набора консультанта v2 (src/lib/consultant-v2/eval).
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run eval:v2 -- \
 *     [--bot <bot_id>] [--only id1,id2] [--concurrency 4] [--out <папка>] [--compare <прошлый.json>]
 *     [--repeat 2] — каждый сценарий несколько раз: ответы модели от раза к разу разные
 *     [--rescore <прогон.json> [--rate 4.45]] — перепроверить старый прогон новыми проверками
 *
 * Ход считает тестовый деплой (у него ключ модели) через внутренний API —
 * адрес и секрет берутся из bots. Состояние диалога держит скрипт, поэтому на
 * деплое прогон ничего не оставляет. Проверки — здесь, по прайсу, который
 * видит консультант.
 *
 * На выходе — таблица «сценарий → прошёл или нет» с замечаниями, JSON для
 * сравнения прогонов (--compare) и отчёт в Markdown.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ConsultantProduct } from "../src/lib/consultant/catalog";
import type { ConsultantState } from "../src/lib/consultant/state";
import { isResetIntent } from "../src/lib/consultant/intent";
import { estimateUsdFromTokens, type SmartSearchTokenUsage } from "../src/lib/smart-search-cost";
import {
  checkTurn,
  indexCatalog,
  type EvalScenario,
  type Flag,
} from "../src/lib/consultant-v2/eval/checks";
import { V2_EVAL_SCENARIOS } from "../src/lib/consultant-v2/eval/scenarios";

const DEFAULT_BOT = "809e8669-7ae0-4319-9c51-86656a2fc385"; // «Тест кондитерская» — v2 BOVI

type TurnResult = {
  customer: string;
  reply: string;
  historyText?: string;
  kind: string;
  handoff: { reason: string; summary: string } | null;
  tools: string[];
  flags: Flag[];
  usd: number;
  ms: number;
  rate?: number | null;
  skipped?: string;
};
type ScenarioResult = { id: string; title: string; pass: boolean; turns: TurnResult[] };
type RunFile = { at: string; bot: string; model: string | null; results: ScenarioResult[] };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

async function loadBot(botId: string): Promise<{ url: string; secret: string; vertical: string }> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/bots?select=app_url,internal_secret,vertical&id=eq.${botId}`,
    {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    },
  );
  const [row] = (await res.json()) as {
    app_url: string;
    internal_secret: string;
    vertical: string;
  }[];
  if (!row?.app_url || !row.internal_secret)
    throw new Error(`у бота ${botId} нет app_url или internal_secret`);
  return {
    url: row.app_url.replace(/\/+$/, ""),
    secret: row.internal_secret,
    vertical: row.vertical,
  };
}

async function probe<T>(bot: { url: string; secret: string }, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${bot.url}/api/internal/diagnostics`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": bot.secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(150_000),
      });
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      if (attempt >= 1) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

type TurnResponse =
  | {
      ok: true;
      text: string;
      historyText?: string;
      kind: string;
      toolsUsed: string[];
      handoff: { reason: string; summary: string } | null;
      nextState: ConsultantState;
      usage: SmartSearchTokenUsage | null;
      model: string | null;
      rate: number | null;
      ms: number;
    }
  | { ok: false; error: string };

let seenModel: string | null = null;

async function runScenario(
  bot: { url: string; secret: string },
  scenario: EvalScenario,
  catalog: ConsultantProduct[],
  index: ReturnType<typeof indexCatalog>,
): Promise<ScenarioResult> {
  const storyProductIds = scenario.storyProducts?.flatMap((part) =>
    catalog.filter((p) => p.name.toLowerCase().includes(part.toLowerCase())).map((p) => p.id),
  );
  let state: ConsultantState = {};
  let firstReply = true;
  const turns: TurnResult[] = [];
  for (const turn of scenario.turns) {
    const reset = isResetIntent(turn.text);
    if (state.automation_paused && !reset) {
      turns.push({
        customer: turn.text,
        reply: "",
        kind: "paused",
        handoff: null,
        tools: [],
        flags: [{ check: "пауза", detail: "диалог у менеджера — ход не выполнен" }],
        usd: 0,
        ms: 0,
        skipped: "пауза",
      });
      continue;
    }
    let res: TurnResponse;
    try {
      res = await probe<TurnResponse>(bot, {
        probe: "consultant-v2-turn",
        turn: { text: turn.text, state, ...(storyProductIds?.length ? { storyProductIds } : {}) },
      });
    } catch (err) {
      res = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (!res.ok) {
      turns.push({
        customer: turn.text,
        reply: "",
        kind: "error",
        handoff: null,
        tools: [],
        flags: [{ check: "сбой", detail: res.error }],
        usd: 0,
        ms: 0,
      });
      break;
    }
    if (res.model) seenModel = res.model;
    const flags = checkTurn(
      turn,
      {
        text: res.text,
        historyText: res.historyText,
        kind: res.kind,
        handoff: res.handoff,
        toolsUsed: res.toolsUsed,
        rate: res.rate,
      },
      index,
      firstReply,
    );
    turns.push({
      customer: turn.text,
      reply: res.text,
      ...(res.historyText ? { historyText: res.historyText } : {}),
      kind: res.kind,
      handoff: res.handoff,
      tools: res.toolsUsed,
      flags,
      usd: res.usage ? estimateUsdFromTokens(res.usage, undefined, res.model) : 0,
      ms: res.ms,
      rate: res.rate,
    });
    state = res.nextState;
    firstReply = reset;
  }
  return {
    id: scenario.id,
    title: scenario.title,
    pass: turns.every((t) => t.flags.length === 0),
    turns,
  };
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function oneLine(text: string, max = 400): string {
  const flat = text.replace(/\n+/g, " ⏎ ");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Прогоны сценария (при --repeat их несколько): сколько прошло из скольких. */
function passRate(
  results: ScenarioResult[],
): Map<string, { title: string; pass: number; runs: number }> {
  const out = new Map<string, { title: string; pass: number; runs: number }>();
  for (const r of results) {
    const cur = out.get(r.id) ?? { title: r.title, pass: 0, runs: 0 };
    cur.runs++;
    if (r.pass) cur.pass++;
    out.set(r.id, cur);
  }
  return out;
}

function report(run: RunFile, previous?: RunFile): string {
  const { results } = run;
  const rates = passRate(results);
  const stable = [...rates.values()].filter((r) => r.pass === r.runs).length;
  const passed = results.filter((r) => r.pass).length;
  const turns = results.flatMap((r) => r.turns);
  const cleanTurns = turns.filter((t) => t.flags.length === 0).length;
  const byCheck = new Map<string, number>();
  for (const t of turns)
    for (const f of t.flags) byCheck.set(f.check, (byCheck.get(f.check) ?? 0) + 1);
  const usd = turns.reduce((s, t) => s + t.usd, 0);
  const timed = turns.filter((t) => t.ms > 0);
  const avgMs = timed.length ? timed.reduce((s, t) => s + t.ms, 0) / timed.length : 0;
  const prevRates = previous
    ? passRate(previous.results)
    : new Map<string, { pass: number; runs: number }>();

  const lines: string[] = [];
  lines.push(`# Эталонный набор v2 — ${run.at.slice(0, 16).replace("T", " ")} UTC`);
  lines.push("");
  lines.push(
    `Модель: ${run.model ?? "—"}. Прогоны без замечаний: ${passed} из ${results.length}; сценарии, прошедшие каждый раз: ${stable} из ${rates.size}. Ходы без замечаний: ${cleanTurns} из ${turns.length}.`,
  );
  lines.push(`Стоимость прогона: $${usd.toFixed(3)}, средний ход ${(avgMs / 1000).toFixed(1)} с.`);
  if (previous) {
    const was = previous.results.filter((r) => r.pass).length;
    const wasStable = [...prevRates.values()].filter((r) => r.pass === r.runs).length;
    lines.push(
      `Прошлый прогон (${previous.at.slice(0, 16).replace("T", " ")}): ${was} из ${previous.results.length}; каждый раз — ${wasStable} из ${prevRates.size}.`,
    );
  }
  lines.push("");
  lines.push("| Замечание | Ходов |");
  lines.push("|---|---|");
  for (const [check, n] of [...byCheck].sort((a, b) => b[1] - a[1]))
    lines.push(`| ${check} | ${n} |`);
  lines.push("");
  lines.push("| Сценарий | Итог | Было |");
  lines.push("|---|---|---|");
  for (const [id, r] of rates) {
    const prev = prevRates.get(id);
    lines.push(
      `| ${r.title} | ${r.pass} из ${r.runs} | ${prev ? `${prev.pass} из ${prev.runs}` : "—"} |`,
    );
  }
  for (const r of results) {
    lines.push("");
    lines.push(`## ${r.pass ? "✓" : "✗"} ${r.title} (${r.id})`);
    for (const t of r.turns) {
      lines.push("");
      lines.push(`**Покупатель:** ${oneLine(t.customer)}`);
      lines.push(
        `**Бот** (${t.kind}${t.handoff ? `, менеджеру: ${t.handoff.reason}` : ""}${t.tools.length ? `; ${t.tools.join(", ")}` : ""}): ${oneLine(t.reply) || "—"}`,
      );
      for (const f of t.flags) lines.push(`- ${f.check}: ${f.detail}`);
    }
  }
  return lines.join("\n");
}

/**
 * Перепроверка сохранённого прогона новыми проверками — без обращений к
 * модели: ответы те же, меняются только правила оценки.
 */
function rescore(
  run: RunFile,
  index: ReturnType<typeof indexCatalog>,
  fallbackRate: number | null,
): RunFile {
  const byId = new Map(V2_EVAL_SCENARIOS.map((s) => [s.id, s]));
  const results = run.results.map((r) => {
    const scenario = byId.get(r.id);
    if (!scenario) return r;
    let first = true;
    const turns = r.turns.map((t, i) => {
      if (t.skipped || t.kind === "error") return t;
      const flags = checkTurn(
        scenario.turns[i] ?? { text: t.customer },
        {
          text: t.reply,
          historyText: t.historyText,
          kind: t.kind,
          handoff: t.handoff,
          toolsUsed: t.tools,
          rate: t.rate ?? fallbackRate,
        },
        index,
        first,
      );
      first = isResetIntent(t.customer);
      return { ...t, flags };
    });
    return { ...r, turns, pass: turns.every((t) => t.flags.length === 0) };
  });
  return { ...run, results };
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY)
    throw new Error("нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
  const botId = arg("bot") ?? DEFAULT_BOT;
  const bot = await loadBot(botId);
  if (bot.vertical !== "consultant_bovi_v2")
    throw new Error(`бот ${botId} не на нише consultant_bovi_v2 (${bot.vertical})`);
  const only = arg("only")?.split(",");
  const scenarios = V2_EVAL_SCENARIOS.filter((s) => !only || only.includes(s.id));
  const catalogRes = await probe<{ ok: boolean; products?: ConsultantProduct[]; error?: string }>(
    bot,
    {
      probe: "consultant-v2-catalog",
    },
  );
  if (!catalogRes.ok || !catalogRes.products)
    throw new Error(`прайс не получен: ${catalogRes.error ?? "?"}`);
  const index = indexCatalog(catalogRes.products);
  console.log(`Прайс: ${catalogRes.products.length} позиций. Сценариев: ${scenarios.length}.`);

  const rescorePath = arg("rescore");
  if (rescorePath) {
    const old = JSON.parse(readFileSync(rescorePath, "utf8")) as RunFile;
    const fresh = rescore(old, index, Number(arg("rate") ?? "") || null);
    const out = rescorePath.replace(/\.json$/, "-rescored");
    writeFileSync(`${out}.json`, JSON.stringify(fresh, null, 2));
    writeFileSync(`${out}.md`, report(fresh));
    console.log(report(fresh).split("\n## ")[0]);
    console.log(`\nОтчёт: ${out}.md`);
    return;
  }

  const concurrency = Number(arg("concurrency") ?? 4);
  const repeat = Math.max(1, Number(arg("repeat") ?? 1));
  const queue = scenarios.flatMap((s) => Array.from({ length: repeat }, () => s));
  const results = await pool(queue, concurrency, async (s) => {
    const r = await runScenario(bot, s, catalogRes.products!, index);
    console.log(
      `${r.pass ? "✓" : "✗"} ${s.id}${r.pass ? "" : `: ${r.turns.flatMap((t) => t.flags.map((f) => f.check)).join(", ")}`}`,
    );
    return r;
  });

  const run: RunFile = { at: new Date().toISOString(), bot: botId, model: seenModel, results };
  const comparePath = arg("compare");
  const previous = comparePath
    ? (JSON.parse(readFileSync(comparePath, "utf8")) as RunFile)
    : undefined;
  const outDir = arg("out") ?? join(tmpdir(), "frogflow-eval");
  mkdirSync(outDir, { recursive: true });
  const stamp = run.at.slice(0, 16).replace(/[:T]/g, "-");
  const jsonPath = join(outDir, `v2-eval-${stamp}.json`);
  const mdPath = join(outDir, `v2-eval-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(run, null, 2));
  const md = report(run, previous);
  writeFileSync(mdPath, md);
  console.log(`\n${md.split("\n## ")[0]}`);
  console.log(`\nОтчёт: ${mdPath}\nJSON: ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
