#!/usr/bin/env node
/**
 * Срез состояния консультанта из боевой базы — только чтение.
 *
 * Нужен, когда база недоступна из сессии агента (сетевая политика окружения
 * закрывает *.supabase.co), а понять надо: что реально лежит в базе знаний,
 * сколько позиций в каталоге и во что это обходится в промпте.
 *
 * Ничего не пишет и не печатает ключи. Значения статей и товаров тоже не
 * печатает целиком — только заголовки, размеры и итоги.
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/dump-consultant-state.mjs
 *   # с --json — машинный вывод, чтобы приложить в переписку целиком
 */
const URL_ = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!URL_ || !KEY) {
  console.error("Задайте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const asJson = process.argv.includes("--json");

const KEYS = {
  knowledge: "consultant_knowledge_json",
  catalog: "consultant_catalog_json",
  catalogMeta: "consultant_catalog_meta",
  rate: "consultant_vtb_buy_rate",
  tasks: "consultant_tasks_json",
  address: "consultant_store_address",
  phone: "consultant_store_phone",
  hours: "consultant_store_hours",
  shopUrl: "consultant_shop_url",
};

async function readSettings() {
  const wanted = Object.values(KEYS).map(encodeURIComponent).join(",");
  const res = await fetch(
    `${URL_}/rest/v1/app_settings?select=bot_id,key,value,updated_at&key=in.(${wanted})`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  );
  if (!res.ok) {
    console.error("Не удалось прочитать app_settings:", res.status, (await res.text()).slice(0, 300));
    process.exit(1);
  }
  return res.json();
}

const json = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Оценка токенов по символам. Точную цифру даёт messages.count_tokens, но для
 * решения «влезает / сколько стоит» этого достаточно: кириллица с цифрами и
 * латинскими брендами укладывается примерно в 3 символа на токен.
 */
const CHARS_PER_TOKEN = 3;
const tokens = (chars) => Math.round(chars / CHARS_PER_TOKEN);

const rows = await readSettings();
const byBot = new Map();
for (const r of rows) {
  const bot = r.bot_id || "(без bot_id)";
  if (!byBot.has(bot)) byBot.set(bot, new Map());
  byBot.get(bot).set(r.key, r);
}

const report = [];
for (const [botId, settings] of byBot) {
  const get = (k) => settings.get(KEYS[k]);
  const knowledge = json(get("knowledge")?.value ?? "") ?? [];
  const catalog = json(get("catalog")?.value ?? "") ?? [];
  const rate = json(get("rate")?.value ?? "");
  const tasks = json(get("tasks")?.value ?? "") ?? [];

  const kbChars = knowledge.reduce((s, a) => s + (a?.content?.length ?? 0) + (a?.title?.length ?? 0), 0);
  // Строка каталога в промпте (formatCatalogForPrompt) — примерно столько же,
  // сколько имя + категория + размер + цвета плюс постоянная обвязка.
  const catChars = catalog
    .filter((p) => p?.stock)
    .reduce(
      (s, p) =>
        s + 95 + (p.name?.length ?? 0) + (p.category?.length ?? 0) + (p.size?.length ?? 0) +
        (p.colors?.join(", ").length ?? 0) + (p.material?.length ?? 0),
      0,
    );
  const STATIC_PROMPT_CHARS = 12_007;
  const totalChars = STATIC_PROMPT_CHARS + kbChars + catChars;

  report.push({
    bot_id: botId,
    knowledge: {
      articles: knowledge.length,
      chars: kbChars,
      updated_at: get("knowledge")?.updated_at ?? null,
      items: knowledge.map((a) => ({
        title: a?.title ?? "(без заголовка)",
        chars: a?.content?.length ?? 0,
        tags: a?.tags?.length ?? 0,
        updatedAt: a?.updatedAt ?? null,
      })),
    },
    catalog: {
      sku: catalog.length,
      in_stock: catalog.filter((p) => p?.stock).length,
      with_size: catalog.filter((p) => p?.size).length,
      with_colors: catalog.filter((p) => p?.colors?.length).length,
      with_description: catalog.filter((p) => p?.description).length,
      with_material: catalog.filter((p) => p?.material).length,
      categories: new Set(catalog.map((p) => p?.category ?? "")).size,
      meta: json(get("catalogMeta")?.value ?? ""),
      chars_in_prompt: catChars,
    },
    rate: rate ? { buy: rate.rate, sell: rate.sell ?? null, source: rate.source, updatedAt: rate.updatedAt } : null,
    store: {
      address: get("address")?.value ?? "(по умолчанию)",
      phone: get("phone")?.value ?? "(по умолчанию)",
      hours: get("hours")?.value ?? "(по умолчанию)",
      shopUrl: get("shopUrl")?.value ?? "(по умолчанию)",
    },
    manager_tasks_pending: tasks.filter((t) => t && !t.done).length,
    prompt: {
      static_chars: STATIC_PROMPT_CHARS,
      knowledge_chars: kbChars,
      catalog_chars: catChars,
      total_chars: totalChars,
      approx_tokens: tokens(totalChars),
      haiku_window: 200_000,
      fits: tokens(totalChars) < 200_000,
    },
  });
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const r of report) {
    console.log(`\n=== bot_id: ${r.bot_id} ===`);
    console.log(`База знаний: ${r.knowledge.articles} статей, ${r.knowledge.chars} символов`);
    for (const a of r.knowledge.items) {
      console.log(`  • ${a.title} — ${a.chars} симв., тегов ${a.tags}`);
    }
    console.log(
      `Каталог: ${r.catalog.sku} SKU (в наличии ${r.catalog.in_stock}), категорий ${r.catalog.categories},` +
        ` с размером ${r.catalog.with_size}, с цветом ${r.catalog.with_colors},` +
        ` с описанием ${r.catalog.with_description}, с составом ${r.catalog.with_material}`,
    );
    console.log(`Импорт каталога: ${JSON.stringify(r.catalog.meta)}`);
    console.log(`Курс: ${r.rate ? `покупка ${r.rate.buy}, продажа ${r.rate.sell ?? "—"}, ${r.rate.updatedAt}` : "нет"}`);
    console.log(`Магазин: ${r.store.address} | ${r.store.phone} | ${r.store.hours} | ${r.store.shopUrl}`);
    console.log(`Задач менеджеру в работе: ${r.manager_tasks_pending}`);
    console.log(
      `ПРОМПТ: ${r.prompt.total_chars} символов ≈ ${r.prompt.approx_tokens} токенов` +
        ` из ${r.prompt.haiku_window} окна Haiku — ${r.prompt.fits ? "влезает" : "НЕ ВЛЕЗАЕТ"}`,
    );
  }
}
