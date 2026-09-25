/**
 * Копия консультанта BOVI во второй бот — для консультанта v2.
 *
 * v2 живёт рядом с первой версией: свой бот в базе, свой деплой на Vercel с
 * VERTICAL=consultant_bovi_v2, свой Instagram-аккаунт для тестов. Чтобы
 * сравнивать версии честно, у v2 те же прайс, база знаний, синонимы и
 * контакты магазина, что у BOVI. Этот скрипт их и переносит.
 *
 * Переносится только то, что описывает магазин. Всё, что описывает живую
 * работу BOVI, остаётся у BOVI: задачи менеджера, журнал, покупатели,
 * Telegram менеджера (иначе тестовые уведомления пришли бы менеджеру BOVI),
 * правила ответов на комментарии под постами BOVI.
 *
 * Отметки товаров к сторис и рилсам не переносятся: story_id уникален на всю
 * таблицу, а отметки BOVI привязаны к её публикациям. На тестовом аккаунте
 * свои публикации — их отмечают в админке v2.
 *
 * Повторный запуск безопасен: настройки перезаписываются значениями BOVI.
 * Так же v2 догоняет BOVI после новой загрузки прайса.
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/clone-consultant-tenant.ts \
 *     --from <bot_id BOVI> --to <bot_id v2>          показать, что будет скопировано
 *   … --apply                                         скопировать
 */

const URL_ = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!URL_ || !KEY) {
  console.error("Задайте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const from = arg("from");
const to = arg("to");
const apply = process.argv.includes("--apply");
if (!from || !to || from === to) {
  console.error("Нужны два разных бота: --from <bot_id> --to <bot_id>");
  process.exit(1);
}

/** Что описывает магазин — копируем. */
const COPY_KEYS = [
  "consultant_catalog_json",
  "consultant_catalog_meta",
  "consultant_knowledge_json",
  "consultant_synonyms",
  "consultant_accept_json",
  "consultant_store_address",
  "consultant_store_phone",
  "consultant_store_hours",
  "consultant_vtb_buy_rate",
  "consultant_ab_bucket",
  "consultant_bot_enabled",
  "instagram_direct_bot_enabled",
] as const;

/** Что описывает живую работу BOVI — не трогаем, и почему. */
const SKIP_REASONS: Record<string, string> = {
  consultant_tasks_json: "задачи менеджера BOVI",
  consultant_events_json: "журнал событий BOVI",
  consultant_reply_targets: "ответы менеджера BOVI через Telegram",
  consultant_lifetime_spend: "расходы BOVI на модель",
  consultant_reset_at: "сброс диалогов BOVI",
  consultant_bot_enabled_at: "ставится заново — бот не отвечает на сообщения до включения",
  consultant_vtb_last_error: "ошибка курса у BOVI",
  admin_chat_id: "Telegram менеджера BOVI — уведомления v2 ему не нужны",
  admin_contact_link: "контакт менеджера BOVI",
  comment_reply_rules: "правила под постами BOVI",
  comment_reply_answered: "отвеченные комментарии BOVI",
  zernio_disconnect_notified: "состояние подключения BOVI",
};

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

type Bot = { id: string; bot_name: string; owner_id: string; vertical: string; modules: unknown };

async function main() {
  const bots = await rest<Bot[]>(
    `bots?select=id,bot_name,owner_id,vertical,modules&id=in.(${from},${to})`,
  );
  const source = bots.find((b) => b.id === from);
  const target = bots.find((b) => b.id === to);
  if (!source) throw new Error(`Бот-источник ${from} не найден`);
  if (!target) {
    throw new Error(`Бот ${to} не найден — сначала заведите его в панели оператора`);
  }
  console.log(`Откуда: ${source.bot_name} (${source.owner_id}), ниша ${source.vertical}`);
  console.log(`Куда:   ${target.bot_name} (${target.owner_id}), ниша ${target.vertical}`);
  if (target.vertical !== "consultant_bovi_v2") {
    console.warn(`⚠ У бота-приёмника ниша «${target.vertical}», а не consultant_bovi_v2.`);
  }

  const rows = await rest<{ key: string; value: string }[]>(
    `app_settings?select=key,value&bot_id=eq.${from}`,
  );
  const copy = rows.filter((r) => (COPY_KEYS as readonly string[]).includes(r.key));
  console.log("\nКопируем:");
  for (const r of copy) console.log(`  ${r.key} (${String(r.value ?? "").length} знаков)`);
  const missing = COPY_KEYS.filter((k) => !copy.some((r) => r.key === k));
  if (missing.length) console.log(`  нет у источника: ${missing.join(", ")}`);
  console.log("  модули бота — как у источника");
  console.log("\nНе копируем:");
  for (const r of rows) {
    if (copy.includes(r)) continue;
    console.log(`  ${r.key} — ${SKIP_REASONS[r.key] ?? "не относится к описанию магазина"}`);
  }
  console.log("  story_product_tags — отметки к публикациям BOVI, у v2 свои");

  if (!apply) {
    console.log("\nЭто просмотр. Чтобы скопировать, добавьте --apply.");
    return;
  }

  const payload = [
    ...copy.map((r) => ({ bot_id: to, key: r.key, value: r.value })),
    { bot_id: to, key: "consultant_bot_enabled_at", value: new Date().toISOString() },
  ];
  await rest(`app_settings?on_conflict=bot_id,key`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(payload),
  });
  await rest(`bots?id=eq.${to}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ modules: source.modules }),
  });
  console.log(`\nГотово: ${payload.length} настроек и модули перенесены в ${target.bot_name}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
