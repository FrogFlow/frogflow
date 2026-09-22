/**
 * Разбор всех диалогов, прошедших через консультанта. Только чтение.
 *
 * Журнал consultant_message_runs держит по строке на каждое входящее
 * сообщение: что написал покупатель, что ответил бот, каким путём ответ
 * собрался, был ли на тот момент курс и во что обошлись токены. Этого хватает,
 * чтобы разобрать переписку целиком, не открывая Instagram.
 *
 * Проверки тут не свои: скрипт зовёт те же функции, которыми прод чистит
 * ответы. Поэтому отчёт не разъезжается с кодом — починили в validate.ts,
 * и разбор перестал это находить. Если находит до сих пор, значит правка не
 * доехала до прода.
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/audit-dialogs.ts
 *   … --days 14        только последние две недели (по умолчанию всё)
 *   … --bot <uuid>     один бот из общей базы (по умолчанию все)
 *   … --examples 5     сколько примеров печатать на находку (по умолчанию 3)
 *   … --json           машинный вывод
 */
import {
  apologizesForNotUnderstanding,
  collapseManagerPromises,
  isCatalogExcuse,
  isEmptyPraise,
  mentionsRateOutage,
  promisesManagerFollowUp,
} from "../src/lib/consultant/validate";
import { containsForbiddenPhrase } from "../src/lib/consultant/intent";

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
const asJson = process.argv.includes("--json");
const days = Number(arg("days") || 0);
const botFilter = arg("bot");
const exampleLimit = Number(arg("examples") || 3);

type Run = {
  id: string;
  bot_id: string;
  conversation_id: string;
  user_key: string;
  source: string;
  status: string;
  incoming_text: string | null;
  reply_text: string | null;
  reply_kind: string | null;
  rate_value: number | null;
  error_code: string | null;
  tool_trace: unknown;
  token_usage: { usd?: number; cache_read?: number; input?: number } | null;
  received_at: string;
};

const COLUMNS =
  "id,bot_id,conversation_id,user_key,source,status,incoming_text,reply_text,reply_kind," +
  "rate_value,error_code,tool_trace,token_usage,received_at";

async function fetchRuns(): Promise<Run[]> {
  const out: Run[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const filters = [`select=${COLUMNS}`, "order=received_at.asc"];
    if (botFilter) filters.push(`bot_id=eq.${botFilter}`);
    if (days > 0) {
      const since = new Date(Date.now() - days * 864e5).toISOString();
      filters.push(`received_at=gte.${since}`);
    }
    const res = await fetch(`${URL_}/rest/v1/consultant_message_runs?${filters.join("&")}`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${from + page - 1}`,
      },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const rows = (await res.json()) as Run[];
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

/** Предложения ответа — так же, как их режет прод. */
const sentences = (text: string): string[] =>
  text
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.!?…])\s+/))
    .filter((s) => s.trim());

const normalize = (text: string): string =>
  text.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, " ").trim();

const usedTool = (trace: unknown, name: string): boolean =>
  JSON.stringify(trace ?? "").includes(name);

type Finding = { check: string; title: string; hint: string; run: Run; note?: string };

const CHECKS: {
  id: string;
  title: string;
  hint: string;
  test: (r: Run) => boolean | string;
}[] = [
  {
    id: "no_reply",
    title: "Покупатель написал — ответа не ушло",
    hint: "status не replied: ошибка, пауза или обрыв. Самая дорогая находка: человек ждёт.",
    test: (r) => r.status !== "replied" && (r.status || "—"),
  },
  {
    id: "internal_leak",
    title: "Внутренняя кухня в ответе покупателю",
    hint: "«курс недоступен», «не вижу изображение», «в каталоге не указано», «не совсем понял».",
    test: (r) => {
      const t = r.reply_text ?? "";
      if (!t) return false;
      if (/не\s+виж[уy]\s+(изображени|фото|картинк)/i.test(t)) return "не вижу изображение";
      const bad = sentences(t).find(
        (s) => mentionsRateOutage(s) || isCatalogExcuse(s) || apologizesForNotUnderstanding(s),
      );
      return bad ? bad.slice(0, 90) : false;
    },
  },
  {
    id: "promise_without_task",
    title: "Пообещал менеджера, задачу не завёл",
    hint: "Покупатель ждёт ответа, которого никто не отправит.",
    test: (r) => {
      const t = r.reply_text ?? "";
      if (!t || !promisesManagerFollowUp(t)) return false;
      if (["handoff", "purchase", "injection"].includes(r.reply_kind ?? "")) return false;
      return usedTool(r.tool_trace, "ask_manager") ? false : "ask_manager не вызван";
    },
  },
  {
    id: "double_manager",
    title: "Две фразы про менеджера подряд",
    hint: "Читается как сбой.",
    test: (r) => {
      const t = r.reply_text ?? "";
      return Boolean(t) && collapseManagerPromises(t) !== t;
    },
  },
  {
    id: "empty_praise",
    title: "Пустая похвала и дежурное «обращайтесь»",
    hint: "Продавец: «вопрос — ответ, без лишних слов и информации».",
    test: (r) => {
      const bad = sentences(r.reply_text ?? "").find(isEmptyPraise);
      return bad ? bad.slice(0, 90) : false;
    },
  },
  {
    id: "ruble_without_rate",
    title: "Речь про рубли, а курса в этот момент не было",
    hint: "Либо назвали сумму из воздуха, либо отправили к менеджеру за тем, что умеем сами.",
    test: (r) => /₽|рубл/i.test(r.reply_text ?? "") && r.rate_value == null,
  },
  {
    id: "style",
    title: "Нарушен стиль: восклицания, эмодзи, markdown, запрещённые клише",
    hint: "Требование продавца: ровный деловой тон без «!» и эмодзи.",
    test: (r) => {
      const t = r.reply_text ?? "";
      if (!t) return false;
      const flags: string[] = [];
      if (t.includes("!")) flags.push("«!»");
      if (/\p{Extended_Pictographic}/u.test(t)) flags.push("эмодзи");
      if (/\*{1,2}[^*]+\*{1,2}/.test(t)) flags.push("markdown");
      if (containsForbiddenPhrase(t)) flags.push("клише");
      return flags.length ? flags.join(", ") : false;
    },
  },
  {
    id: "too_long",
    title: "Ответ длиннее 700 знаков",
    hint: "Перечень позиций — законное исключение, остальное стоит сократить.",
    test: (r) => {
      const n = (r.reply_text ?? "").length;
      // Перечень с ценами — это ответ, а не многословие.
      const isList = (r.reply_text ?? "").split(/\n|•/).length > 4;
      return n > 700 && !isList ? `${n} знаков` : false;
    },
  },
];

function auditDialogue(runs: Run[]): Finding[] {
  const found: Finding[] = [];
  let prevReply = "";
  let contactAsks = 0;
  for (const r of runs) {
    for (const check of CHECKS) {
      const hit = check.test(r);
      if (hit) {
        found.push({
          check: check.id,
          title: check.title,
          hint: check.hint,
          run: r,
          note: typeof hit === "string" ? hit : undefined,
        });
      }
    }
    const reply = normalize(r.reply_text ?? "");
    if (reply && reply === prevReply) {
      found.push({
        check: "repeat_reply",
        title: "Бот повторил ровно тот же ответ",
        hint: "Покупатель уже ответил на этот вопрос — повтор его теряет.",
        run: r,
      });
    }
    if (reply) prevReply = reply;
    if (/номер телефона|город доставки/i.test(r.reply_text ?? "")) contactAsks += 1;
  }
  if (contactAsks > 2) {
    found.push({
      check: "contact_loop",
      title: "Анкета по кругу: телефон и город спрошены больше двух раз",
      hint: "Оформление заказа зациклилось.",
      run: runs[runs.length - 1],
      note: `${contactAsks} раза`,
    });
  }
  return found;
}

function money(runs: Run[]): { usd: number; cacheShare: number } {
  let usd = 0;
  let cacheRead = 0;
  let input = 0;
  for (const r of runs) {
    usd += Number(r.token_usage?.usd ?? 0);
    cacheRead += Number(r.token_usage?.cache_read ?? 0);
    input += Number(r.token_usage?.input ?? 0);
  }
  const total = cacheRead + input;
  return { usd, cacheShare: total > 0 ? cacheRead / total : 0 };
}

async function main() {
  const runs = await fetchRuns();
  if (runs.length === 0) {
    console.log("Журнал пуст: ни одного сообщения не записано.");
    return;
  }

  const byDialogue = new Map<string, Run[]>();
  for (const r of runs) {
    const key = r.conversation_id || r.user_key;
    const list = byDialogue.get(key) ?? [];
    list.push(r);
    byDialogue.set(key, list);
  }

  const findings: Finding[] = [];
  for (const list of byDialogue.values()) findings.push(...auditDialogue(list));

  const byCheck = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byCheck.get(f.check) ?? [];
    list.push(f);
    byCheck.set(f.check, list);
  }

  const handedOff = [...byDialogue.values()].filter((l) =>
    l.some((r) => ["handoff", "purchase"].includes(r.reply_kind ?? "")),
  ).length;
  const { usd, cacheShare } = money(runs);
  const summary = {
    messages: runs.length,
    dialogues: byDialogue.size,
    firstAt: runs[0].received_at,
    lastAt: runs[runs.length - 1].received_at,
    handedOff,
    handedOffShare: byDialogue.size ? handedOff / byDialogue.size : 0,
    usd: Number(usd.toFixed(4)),
    usdPerMessage: runs.length ? Number((usd / runs.length).toFixed(5)) : 0,
    cacheShare: Number(cacheShare.toFixed(3)),
    findings: Object.fromEntries([...byCheck].map(([k, v]) => [k, v.length])),
  };

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          summary,
          findings: findings.map((f) => ({
            check: f.check,
            note: f.note,
            at: f.run.received_at,
            dialogue: f.run.conversation_id || f.run.user_key,
            incoming: f.run.incoming_text,
            reply: f.run.reply_text,
            kind: f.run.reply_kind,
            status: f.run.status,
          })),
        },
        null,
        1,
      ),
    );
    return;
  }

  console.log("РАЗБОР ДИАЛОГОВ КОНСУЛЬТАНТА");
  console.log("─".repeat(72));
  console.log(`Период:    ${summary.firstAt.slice(0, 16)} — ${summary.lastAt.slice(0, 16)}`);
  console.log(`Сообщений: ${summary.messages} в ${summary.dialogues} диалогах`);
  console.log(
    `На менеджера ушло: ${handedOff} диалогов (${(summary.handedOffShare * 100).toFixed(0)}%)`,
  );
  console.log(
    `Токены:    $${summary.usd} всего, $${summary.usdPerMessage} за сообщение, кеш ${(
      cacheShare * 100
    ).toFixed(0)}%`,
  );
  console.log("");

  const ordered = [...byCheck.entries()].sort((a, b) => b[1].length - a[1].length);
  if (ordered.length === 0) {
    console.log("Ни одна проверка не сработала.");
    return;
  }
  for (const [id, list] of ordered) {
    const first = list[0];
    console.log("═".repeat(72));
    console.log(`[${list.length}] ${first.title}  (${id})`);
    console.log(first.hint);
    console.log("");
    for (const f of list.slice(0, exampleLimit)) {
      console.log(`  ${f.run.received_at.slice(0, 16)}  ${f.run.conversation_id || f.run.user_key}`);
      if (f.note) console.log(`  ↳ ${f.note}`);
      if (f.run.incoming_text) console.log(`  Клиент: ${f.run.incoming_text.slice(0, 200)}`);
      if (f.run.reply_text) console.log(`  Бот:    ${f.run.reply_text.slice(0, 400)}`);
      console.log("");
    }
    if (list.length > exampleLimit) console.log(`  …и ещё ${list.length - exampleLimit}\n`);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
