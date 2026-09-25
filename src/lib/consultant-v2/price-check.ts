/**
 * Сверка цен в ответе консультанта с прайсом: сумма должна принадлежать
 * тому товару, рядом с которым стоит. «Есть ли такая сумма в прайсе» мало:
 * 25.09 модель написала Swing Light за 50 000 — это цена соседней Swing Extra
 * Light, в прайсе она есть.
 *
 * Одна и та же сверка работает в двух местах: эталонный набор меряет ею
 * ответы (eval/checks.ts), а ядро v2 проверяет черновик перед отправкой
 * (draft-check.ts) — что меряем, то и держим.
 */
import type { ConsultantProduct } from "@/lib/consultant/catalog";
import { findKztAmounts } from "./currency";

export type Flag = { check: string; detail: string };

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

/**
 * Слово, по которому опознаётся позиция: латиница (марка, модель) или размер,
 * реже чем у каждой четвёртой позиции. Uchino — почти сотня позиций из 790, и
 * всё равно называет марку; «полотенце» или «система» — не называют ничего.
 */
function identifies(index: CatalogIndex, t: string): boolean {
  return /[a-z0-9]/.test(t) && (index.idf.get(t) ?? 0) >= Math.log(4);
}

/**
 * Слово названия, без которого товар — другой: «Extra» у Swing Extra Light,
 * «Soft» у пуховой подушки. Размер, цвет и фабричный код (WK1, WK2) модель
 * обычно опускает, и их отсутствие в тексте не говорит, что речь о другом.
 */
export function namesModel(index: CatalogIndex, t: string): boolean {
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
      // Позицию опознаёт марка, модель или размер. Одно русское слово
      // («система», «функциональное») — нет: 25.09 «система переведёт»
      // приводило к кровати Frankenstolz «с системой хранения».
      if (identifies(index, t)) rare = true;
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
    // Размер весит больше цвета; перечень цветов («белый, серый, бежевый»)
    // не должен выбирать позицию по самому редкому из них.
    const namedScore = (i: number) =>
      named.reduce(
        (sum, t) => sum + (index.tokens[i].has(t) ? (/^\d+x\d+$/.test(t) ? 2 : 1) : 0),
        0,
      );
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
  // Только если названа модель, а не одна марка: «Decoflux» или «Uchino»
  // без модели — любая их позиция, и выбирать «самую короткую» нельзя.
  const latinNamed = [...words].filter(
    (t) => /[a-z]/.test(t) && pool.some((i) => index.tokens[i].has(t)),
  );
  if (latinNamed.length >= 2 && pool.some((i) => extra(i) === 0)) {
    pool = pool.filter((i) => extra(i) === 0);
  }
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
      continue;
    }
    amounts.forEach((amount, i) => {
      const kzt = amount.kzt;
      const before = line.slice(0, amount.start);
      // Конец вилки «26 500–85 000 ₸», предел «до 200 000» и «от 7 900» по
      // разделу — не цена позиции: у раздела бывают аксессуары дешевле
      // (ремень для пледа за 4 000 у пледов «от 140 000»).
      if (
        /(?:^|[^\dxх×*])(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d{4,})\s*[–—-]\s*$/.test(before) ||
        /(?:^|[\s(])(?:до|от)\s*$/i.test(before.slice(-6))
      )
        return;
      const piece = pieceFor(line, amounts, i);
      if (/итого|вместе|за вс[её]|сумм|общ\S* стоимост|за оба|за обе|комплектом/i.test(piece))
        return;
      const narrowed = candidatesFor(index, piece, before, header);
      if (narrowed.length > 0) {
        if (!narrowed.some((p) => p.price_kzt === kzt)) {
          const p = narrowed[0];
          flags.push({
            check: "цена",
            detail: `${fmt(kzt)} у «${piece.trim().slice(0, 60)}» — в прайсе ${short(p)} за ${fmt(p.price_kzt)}`,
          });
        }
        return;
      }
      if (index.prices.has(kzt)) return;
      // Итог из названных сумм без слова «итого»: две цены ответа в сумме.
      if (allAmounts.some((a, x) => allAmounts.some((b, y) => x !== y && a + b === kzt))) return;
      flags.push({
        check: "цена",
        detail: `${fmt(kzt)} — такой цены в прайсе нет («${piece.trim().slice(0, 60)}»)`,
      });
    });
  }
  return flags;
}

const SEPARATOR_RE = /\s(?:или|и|а)\s|[,;]/g;

/**
 * Кусок строки, который описывает сумму: от прошлой суммы (после «или», «,»)
 * до следующей. «Quick Dry - 20 000 ₸ за 35х50 или 30 000 ₸ за 50х70» — у
 * первой суммы 35х50, у второй 50х70, хотя размер стоит после цены.
 */
function pieceFor(line: string, amounts: { start: number; end: number }[], i: number): string {
  const prevEnd = i > 0 ? amounts[i - 1].end : 0;
  const nextStart = i < amounts.length - 1 ? amounts[i + 1].start : line.length;
  let before = line.slice(prevEnd, amounts[i].start);
  if (i > 0) {
    const cuts = [...before.matchAll(SEPARATOR_RE)];
    if (cuts.length) {
      const last = cuts[cuts.length - 1];
      before = before.slice((last.index ?? 0) + last[0].length);
    }
  }
  // После суммы — только до конца предложения: «30 000 ₸. Система переведёт…»
  let after = line.slice(amounts[i].end, nextStart).split(/[.!?](?:\s|$)/)[0];
  const cut = new RegExp(SEPARATOR_RE.source).exec(after);
  if (cut && i < amounts.length - 1) after = after.slice(0, cut.index);
  return `${before}${line.slice(amounts[i].start, amounts[i].end)}${after}`;
}

/**
 * Позиции, о которых кусок. Не нашлось — к куску добавляются слова модели из
 * начала строки («Merveille 35х50 — 27 000, 50х80 — 52 000»), затем заголовок
 * списка. Заголовок лишь сужает найденное, но не перебивает саму строку.
 */
function candidatesFor(
  index: CatalogIndex,
  piece: string,
  before: string,
  header: string,
): ConsultantProduct[] {
  let own = productsForSnippet(index, piece);
  if (own.length === 0) {
    const models = tokens(before).filter((t) => namesModel(index, t));
    if (models.length) own = productsForSnippet(index, `${models.join(" ")} ${piece}`);
  }
  if (own.length === 0) return productsForSnippet(index, `${header} ${piece}`);
  if (own.length > 1 && header) {
    const ids = new Set(own.map((p) => p.id));
    const refined = productsForSnippet(index, `${header} ${piece}`).filter((p) => ids.has(p.id));
    if (refined.length) return refined;
  }
  return own;
}

export function fmt(kzt: number): string {
  return `${kzt.toLocaleString("ru-RU")} ₸`;
}

function short(p: ConsultantProduct): string {
  return `«${p.name.slice(0, 70)}»`;
}
