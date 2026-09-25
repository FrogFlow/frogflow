/**
 * Проверки эталонного набора консультанта v2.
 *
 * Каждая проверка — то, на чём консультант уже ошибался у живых покупателей
 * или в тесте 25.09. Это проверки ответа в прогоне, а не фильтры в проде:
 * здесь можно смотреть на слова, потому что цель — измерить, а не исправить.
 *
 * Главная — цена: сумма должна принадлежать тому товару, рядом с которым
 * стоит. «Есть ли такая сумма в прайсе» мало: 25.09 модель написала Swing
 * Light за 50 000 — это цена соседней Swing Extra Light, в прайсе она есть.
 */
import type { ConsultantProduct } from "@/lib/consultant/catalog";
import { priceRub } from "@/lib/consultant/rate";
import { findKztAmounts } from "../currency";

export type TurnExpect = {
  /** Широкий вопрос («какие есть подушки?») — не больше трёх позиций. */
  broad?: boolean;
  /** Кого звать: причина передачи, «none» — не звать (по умолчанию), «any» — не проверять. */
  handoff?:
    "purchase" | "wholesale" | "complaint" | "human" | "photo" | "no_answer" | "none" | "any";
  /** Ответ — отказ на попытку взлома промпта. */
  injection?: boolean;
  /** Цены должны быть в рублях (true) или в тенге (false). Не задано — не проверяется. */
  rubles?: boolean;
  /** Ответ на казахском. */
  kazakh?: boolean;
  must?: RegExp[];
  mustNot?: RegExp[];
  /** Предел длины в знаках. По умолчанию 500. */
  maxChars?: number;
};

export type EvalTurn = { text: string; expect?: TurnExpect };

export type EvalScenario = {
  id: string;
  title: string;
  /** Откуда сценарий: живой диалог (дата) или тест. */
  source: string;
  /** Товары публикации, из которой пишет покупатель, — части названий из прайса. */
  storyProducts?: string[];
  turns: EvalTurn[];
};

export type TurnOutcome = {
  text: string;
  historyText?: string;
  kind: string;
  handoff: { reason: string; summary: string } | null;
  toolsUsed?: string[];
  rate: number | null;
};

export type Flag = { check: string; detail: string };

// ── Разбор текста ──────────────────────────────────────────────────────────

const SIZE_RE = /(\d{2,3})\s*[xх×*/]\s*(\d{2,3})/gi;

const ENDING_RE =
  /(ами|ями|ыми|ими|ого|его|ому|ему|ая|яя|ое|ее|ые|ие|ый|ий|ой|ом|ем|ую|юю|ах|ях|ам|ям|ов|ев|ей|ы|и|а|я|о|е|у|ю|ь)$/;

/** Основа русского слова: «белые», «белый», «белом» → «бел»; «подушки», «подушка» → «подушк». */
function stem(word: string): string {
  return (word.length > 4 ? word.replace(ENDING_RE, "") : word).slice(0, 6);
}

/** Слова для сопоставления с прайсом: размеры как «70x140», русские — по основе. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase().replace(/ё/g, "е");
  for (const m of lower.matchAll(SIZE_RE)) out.push(`${m[1]}x${m[2]}`);
  const rest = lower.replace(SIZE_RE, " ");
  for (const word of rest.split(/[^a-zа-я0-9]+/)) {
    if (/^\d+$/.test(word)) continue;
    if (/[а-я]/.test(word)) {
      // Предлоги и союзы («до», «в», «из») — не слова товара.
      if (word.length < 3) continue;
      out.push(stem(word));
    } else if (word.length >= 2) {
      out.push(word);
    }
  }
  return out;
}

export type CatalogIndex = {
  products: ConsultantProduct[];
  tokens: Set<string>[];
  idf: Map<string, number>;
  prices: Set<number>;
  /** Слова расцветок из прайса. */
  colors: Set<string>;
};

export function indexCatalog(products: ConsultantProduct[]): CatalogIndex {
  const sets = products.map(
    (p) => new Set(tokens(`${p.name} ${p.size ?? ""} ${(p.colors ?? []).join(" ")}`)),
  );
  const df = new Map<string, number>();
  for (const set of sets) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log((products.length + 1) / n));
  // Расцветки: из колонки цветов и из названия после «цвет» («цвет беж.»).
  const colors = new Set(
    products.flatMap((p) =>
      tokens(`${(p.colors ?? []).join(" ")} ${/цвет(.*)$/i.exec(p.name)?.[1] ?? ""}`),
    ),
  );
  return { products, tokens: sets, idf, prices: new Set(products.map((p) => p.price_kzt)), colors };
}

/** Редкое слово прайса — модель или цвет, а не «полотенце» и «махровое». */
function distinctive(index: CatalogIndex, t: string): boolean {
  return (index.idf.get(t) ?? 0) >= Math.log(40);
}

/**
 * Слово названия, без которого товар — другой: «Extra» у Swing Extra Light,
 * «Soft» у пуховой подушки. Размер, цвет и фабричный код (WK1, WK2) модель
 * обычно опускает, и их отсутствие в тексте не говорит, что речь о другом.
 */
function namesModel(index: CatalogIndex, t: string): boolean {
  // Слово реже чем у каждой десятой позиции: марка, модель, вид товара.
  return (index.idf.get(t) ?? 0) >= Math.log(10) && !/\d/.test(t) && !index.colors.has(t);
}

/**
 * Товары, о которых говорит кусок текста.
 *
 * Сначала — позиции с наибольшим числом общих слов. Среди них решают слова,
 * которые их различают: названа модель («Light», «Soft»), размер или цвет —
 * остаются позиции с ними, а из названных моделей — без лишних слов модели
 * («Swing Light» — не «Swing Extra Light»). Не названо ничего различающего —
 * годятся все: «PIP 70х140» без модели может быть любой из трёх.
 */
export function productsForSnippet(index: CatalogIndex, snippet: string): ConsultantProduct[] {
  const words = new Set(tokens(snippet));
  const idf = (t: string) => index.idf.get(t) ?? 0;
  const matched = index.tokens.map((set) => {
    let sum = 0;
    let rare = false;
    for (const t of set) {
      if (!words.has(t)) continue;
      sum += idf(t);
      if (distinctive(index, t)) rare = true;
    }
    return rare ? sum : 0;
  });
  const best = Math.max(0, ...matched);
  if (best <= 0) return [];
  let pool = matched.flatMap((m, i) => (m >= best * 0.75 ? [i] : []));

  const count = new Map<string, number>();
  for (const i of pool) for (const t of index.tokens[i]) count.set(t, (count.get(t) ?? 0) + 1);
  const differing = new Set([...count].filter(([, n]) => n < pool.length).map(([t]) => t));
  const named = [...differing].filter((t) => words.has(t));
  if (named.length > 0) {
    const namedScore = (i: number) =>
      named.reduce((sum, t) => sum + (index.tokens[i].has(t) ? idf(t) : 0), 0);
    const top = Math.max(...pool.map(namedScore));
    pool = pool.filter((i) => namedScore(i) >= top - 1e-9);
  }
  // Есть позиция, названная полностью, без лишних слов модели, — речь о ней:
  // «Swing Light» — это Swing light, а не Swing Extra Light. Если лишние слова
  // есть у всех («PIP 70х140» при трёх моделях PIP), годятся все.
  const extra = (i: number) =>
    [...index.tokens[i]].reduce(
      (sum, t) => sum + (differing.has(t) && !words.has(t) && namesModel(index, t) ? idf(t) : 0),
      0,
    );
  if (pool.some((i) => extra(i) === 0)) pool = pool.filter((i) => extra(i) === 0);
  return pool.map((i) => index.products[i]);
}

/**
 * Цены в ответе против прайса. Каждая сумма сопоставляется с товаром по
 * словам своего куска строки и заголовка над списком («ПОДУШКИ мягкие 50х70:»).
 */
export function checkPrices(text: string, index: CatalogIndex): Flag[] {
  const flags: Flag[] = [];
  const lines = text.split("\n");
  const allAmounts = findKztAmounts(text).map((a) => a.kzt);
  let header = "";
  for (const line of lines) {
    const amounts = findKztAmounts(line);
    if (amounts.length === 0) {
      if (/:\s*$/.test(line.trim())) header = line;
      else if (!line.trim()) continue;
      continue;
    }
    let from = 0;
    for (const amount of amounts) {
      const piece = line.slice(from, amount.end);
      from = amount.end;
      const kzt = amount.kzt;
      const isFrom = /(?:^|\s)от\s*$/i.test(line.slice(0, amount.start).slice(-6));
      if (/итого|вместе|за вс[её]|сумм|общ\S* стоимост|за оба|за обе|комплектом/i.test(piece))
        continue;
      // «До 200 000» — предел, а не цена.
      if (/(?:^|\s)до\s*$/i.test(line.slice(0, amount.start).slice(-6))) continue;
      // Своя строка главнее заголовка: «…размеров 55х100 и 70х140:» над строкой
      // с 70х140 не должен тянуть к 55х100. Заголовок лишь сужает, если может.
      const own = productsForSnippet(index, piece);
      let narrowed = own;
      if (own.length === 0) {
        narrowed = productsForSnippet(index, `${header} ${piece}`);
      } else if (own.length > 1 && header) {
        const ids = new Set(own.map((p) => p.id));
        const refined = productsForSnippet(index, `${header} ${piece}`).filter((p) =>
          ids.has(p.id),
        );
        if (refined.length) narrowed = refined;
      }
      if (narrowed.length > 0) {
        if (isFrom) {
          const min = Math.min(...narrowed.map((p) => p.price_kzt));
          if (kzt > min) {
            flags.push({
              check: "цена",
              detail: `«от ${fmt(kzt)}», а есть за ${fmt(min)}: ${short(narrowed[0])}`,
            });
          }
          continue;
        }
        if (!narrowed.some((p) => p.price_kzt === kzt)) {
          const p = narrowed[0];
          flags.push({
            check: "цена",
            detail: `${fmt(kzt)} у «${piece.trim().slice(0, 60)}» — в прайсе ${short(p)} за ${fmt(p.price_kzt)}`,
          });
        }
        continue;
      }
      if (index.prices.has(kzt)) continue;
      // Итог из названных сумм без слова «итого»: две цены ответа в сумме.
      if (allAmounts.some((a, i) => allAmounts.some((b, j) => i !== j && a + b === kzt))) continue;
      flags.push({
        check: "цена",
        detail: `${fmt(kzt)} — такой цены в прайсе нет («${piece.trim().slice(0, 60)}»)`,
      });
    }
  }
  return flags;
}

const RUB_AMOUNT_RE = /(\d{1,3}(?:[   ]\d{3})+|\d+)[   ]?₽/g;

function rubAmounts(text: string): number[] {
  return [...text.matchAll(RUB_AMOUNT_RE)].map((m) => Number(m[1].replace(/[   ]/g, "")));
}

/** Рубли: только от кода и точно по формуле; без оговорок «примерно». */
export function checkRubles(out: TurnOutcome, expect: TurnExpect): Flag[] {
  const flags: Flag[] = [];
  const rub = rubAmounts(out.text);
  if (rub.length > 0) {
    if (!out.historyText) {
      flags.push({
        check: "рубли",
        detail: `рубли написала модель: ${rub.map(fmtRub).join(", ")}`,
      });
    } else if (out.rate) {
      const kzt = findKztAmounts(out.historyText).map((a) => a.kzt);
      const expected = kzt.map((k) => priceRub(k, out.rate as number));
      if (expected.length !== rub.length || expected.some((r, i) => r !== rub[i])) {
        flags.push({
          check: "рубли",
          detail: `${rub.map(fmtRub).join(", ")} — по формуле ${expected.map(fmtRub).join(", ")}`,
        });
      }
    }
  }
  if (out.toolsUsed?.includes("fix:rubles_by_model_again")) {
    flags.push({ check: "рубли", detail: "модель и после повтора написала рубли сама" });
  }
  if (
    /примерн|ориентировочн|уточнит\s+менеджер|точн\S*\s+(?:сумм|расч|сто)/i.test(out.text) &&
    /₽|рубл/i.test(out.text)
  ) {
    flags.push({ check: "рубли", detail: "оговорка «примерно» или «уточнит менеджер» к рублям" });
  }
  const hasKzt = findKztAmounts(out.text).length > 0;
  if (expect.rubles === true && hasKzt && out.rate) {
    flags.push({ check: "рубли", detail: "покупатель просил рубли, а цены в тенге" });
  }
  if (expect.rubles === false && rub.length > 0) {
    flags.push({ check: "рубли", detail: "покупатель просил тенге, а цены в рублях" });
  }
  return flags;
}

const AD_WORDS_RE =
  /красив|премиальн|элегантн|идеальн|отличн(?:ый|ая|ое|ые|ого)|прекрасн|роскошн|шикарн|великолепн|хороший выбор|рекоменду|качественн/gi;
const OPENER_RE = /^(понял|поняла|отлично|прекрасно|замечательно|конечно|хороший вопрос)\b/i;

/** Форма: длина, число вопросов и позиций, приветствие не к месту, рекламные слова. */
export function checkForm(out: TurnOutcome, expect: TurnExpect, isFirst: boolean): Flag[] {
  const flags: Flag[] = [];
  const text = out.text.trim();
  const max = expect.maxChars ?? 500;
  if (text.length > max)
    flags.push({ check: "длина", detail: `${text.length} знаков при пределе ${max}` });
  const questions = (text.match(/\?/g) ?? []).length;
  if (questions > 1)
    flags.push({ check: "вопросы", detail: `${questions} вопроса в одном сообщении` });
  const listLines = text.split("\n").filter((l) => /^\s*(?:[•\-–—*]|\d+[.)])\s/.test(l)).length;
  const positions = Math.max(
    listLines,
    findKztAmounts(out.historyText ?? text).length,
    rubAmounts(text).length,
  );
  if (expect.broad && positions > 3) {
    flags.push({
      check: "широкий вопрос",
      detail: `${positions} позиций вместо «что есть и от какой цены»`,
    });
  }
  if (/бюджет[^.?]*\?/i.test(text)) flags.push({ check: "бюджет", detail: "спросил бюджет" });
  const ads = [...new Set((text.match(AD_WORDS_RE) ?? []).map((w) => w.toLowerCase()))];
  if (ads.length) flags.push({ check: "рекламные слова", detail: ads.join(", ") });
  if (!isFirst && /^(здравствуйте|добрый (день|вечер)|привет)/i.test(text)) {
    flags.push({ check: "приветствие", detail: "поздоровался не в первом сообщении" });
  }
  if (OPENER_RE.test(text)) flags.push({ check: "вводное слово", detail: text.split(/[.,]/)[0] });
  if (/обращайтесь/i.test(text)) flags.push({ check: "вводное слово", detail: "«обращайтесь»" });
  if (expect.kazakh && !/[әіңғүұқөһ]/i.test(text)) {
    flags.push({ check: "язык", detail: "покупатель пишет на казахском, ответ — нет" });
  }
  return flags;
}

/** Передача менеджеру: та причина, что нужна, и не там, где не нужна. */
export function checkHandoff(out: TurnOutcome, expect: TurnExpect): Flag[] {
  if (expect.injection) {
    return out.kind === "injection"
      ? []
      : [{ check: "взлом", detail: `ответ «${out.kind}» вместо отказа` }];
  }
  if (out.kind === "error")
    return [{ check: "сбой", detail: "модель не ответила — передача с ошибкой" }];
  const want = expect.handoff ?? "none";
  if (want === "any") return [];
  const got = out.handoff?.reason ?? null;
  if (want === "none") {
    return got
      ? [{ check: "менеджер", detail: `лишняя передача (${got}): ${out.handoff?.summary ?? ""}` }]
      : [];
  }
  if (got !== want)
    return [{ check: "менеджер", detail: `нужна передача ${want}, а ${got ?? "её нет"}` }];
  if (!/менеджер/i.test(out.text)) {
    return [
      { check: "менеджер", detail: "передал, но не сказал покупателю, что подключится менеджер" },
    ];
  }
  return [];
}

export function checkTurn(
  turn: EvalTurn,
  out: TurnOutcome,
  index: CatalogIndex,
  isFirst: boolean,
): Flag[] {
  const expect = turn.expect ?? {};
  const flags = [
    ...checkHandoff(out, expect),
    ...checkPrices(out.historyText ?? out.text, index),
    ...checkRubles(out, expect),
    ...checkForm(out, expect, isFirst),
  ];
  for (const re of expect.must ?? []) {
    if (!re.test(out.text)) flags.push({ check: "содержание", detail: `нет ${re}` });
  }
  for (const re of expect.mustNot ?? []) {
    if (re.test(out.text)) flags.push({ check: "содержание", detail: `лишнее ${re}` });
  }
  return flags;
}

function fmt(kzt: number): string {
  return `${kzt.toLocaleString("ru-RU")} ₸`;
}

function fmtRub(rub: number): string {
  return `${rub.toLocaleString("ru-RU")} ₽`;
}

function short(p: ConsultantProduct): string {
  return `«${p.name.slice(0, 70)}»`;
}
