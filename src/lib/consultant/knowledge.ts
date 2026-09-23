import { haystackOf } from "./synonyms";
import { searchTokens, type ConsultantProduct } from "./catalog";
import { brandVocabulary, fixBrandSpelling } from "./style";
export const KNOWLEDGE_KEY = "consultant_knowledge_json";

export type ConsultantKnowledgeArticle = {
  id: string;
  title: string;
  tags: string[];
  content: string;
  updatedAt: string;
};

export const DEFAULT_KNOWLEDGE_ARTICLES: ConsultantKnowledgeArticle[] = [
  {
    id: "kb-factories",
    title: "Фабрики и производители BOVI",
    tags: ["производитель", "фабрика", "бренд", "португалия", "турция", "европа", "сертификаты"],
    content: "BOVI — бренд домашнего текстиля премиум-класса. Продукция производится на ведущих текстильных фабриках Европы (Португалия) и Турции с многовековыми традициями качества. Все материалы проходят строгий контроль и имеют международный сертификат экологической безопасности OEKO-TEX Standard 100 (гипоаллергенно, без токсичных красителей).",
    updatedAt: "2026-09-17T00:00:00.000Z",
  },
  {
    id: "kb-towels",
    title: "Махровые полотенца (Качество и плотность)",
    tags: ["полотенца", "махра", "хлопок", "плотность", "размеры", "гребенной хлопок", "впитываемость"],
    content: "Полотенца BOVI изготовлены из 100% гребенного длинноволокнистого хлопка (Combed Cotton) высшего сорта. Плотность 550–600 г/м² (премиальный отельный стандарт люкс). Двойная крученая петля обеспечивает моментальное впитывание влаги и невероятную мягкость. Не грубеют и не теряют цвет даже после сотен стирок.",
    updatedAt: "2026-09-17T00:00:00.000Z",
  },
  {
    id: "kb-bedding",
    title: "Постельное белье (Премиальный сатин 300 TC)",
    tags: ["постельное белье", "сатин", "ткань", "хлопок", "мерсеризация", "300tc", "комплекты"],
    content: "Комплекты постельного белья BOVI шьются из 100% длинноволокнистого мерсеризованного хлопка плотностью 300 нитей на квадратный дюйм (300 TC) сатинового переплетения. Имеет благородный матовый шелковистый блеск, шелковистую гладкость и высокую прочность. Ткань «дышит», комфортна в любой сезон, не линяет и обладает эффектом антипиллинга (не образует катышков).",
    updatedAt: "2026-09-17T00:00:00.000Z",
  },
  {
    id: "kb-pillows-duvets",
    title: "Одеяла и подушки (Наполнители и чехлы)",
    tags: ["одеяла", "подушки", "наполнитель", "лебяжий пух", "тенсель", "эвкалипт", "гипоаллергенно"],
    content: "В подушках и одеялах BOVI используются современные премиальные гипоаллергенные наполнители: ультратонкое шелковистое микроволокно swan down («лебяжий пух») и натуральное эвкалиптовое волокно (тенсель). Чехлы выполнены из 100% хлопкового тика высокой плотности, который надёжно удерживает наполнитель и обеспечивает отличную терморегуляцию.",
    updatedAt: "2026-09-17T00:00:00.000Z",
  },
  {
    id: "kb-care",
    title: "Рекомендации по уходу и стирке",
    tags: ["уход", "стирка", "инструкция", "температура", "сушка", "отбеливатель"],
    content: "Рекомендуется деликатная стирка при температуре до 40°C жидкими гелями для стирки. Не использовать агрессивные хлорсодержащие отбеливатели. Для полотенец рекомендуется сушка в расправленном виде либо в сушильной машине на умеренном режиме для вспушивания махровых петель. Гладить сатиновое бельё лучше слегка влажным с изнаночной стороны.",
    updatedAt: "2026-09-17T00:00:00.000Z",
  },
  {
    id: "kb-dorelan",
    title: "Dorelan (Италия) — матрасы, анатомические подушки и топперы",
    tags: ["dorelan", "матрасы", "подушки", "топперы", "ортопедические", "латекс", "италия"],
    content: "Dorelan — ведущий итальянский производитель систем здорового сна премиум-класса. Подушки Dorelan SENSE (SENSE LOW высота 10 см, SENSE MEDIUM высота 12 см) — это ортопедические/анатомические подушки из латекса и пены Myform с эффектом памяти, обеспечивающие идеальную анатомическую поддержку шейного отдела позвоночника. Матрасы Dorelan (линейки FORMER, LEVANT, TRESOR, SFERA, EPIC) — элитные пружинно-пенные и беспружинные ортопедические матрасы. Топперы Dorelan (MOUSSE, GREEM, RE:ACTIVE) — анатомические наматрасники для комфорта сна.",
    updatedAt: "2026-09-17T00:00:00.000Z",
  },
  {
    id: "kb-traumina",
    title: "Traumina (Германия) — подушки, одеяла и наматрасники",
    tags: ["traumina", "подушки", "одеяла", "германия", "пуховые", "гипоаллергенные", "ортопедические"],
    content: "Traumina — премиальный немецкий производитель спальных принадлежностей. Подушки Traumina: ортопедические с пластинами (Ergonom Faser, Exclusive Faser), элитные пуховые (Plume BIO, Elegance, Luxury №1, Trame Daune), гипоаллергенные из функционального волокна (Swing, Nature & Fresh, kuschelmich). Подушка Swing — базовая мягкая комфортная гипоаллергенная подушка.",
    updatedAt: "2026-09-17T00:00:00.000Z",
  },
];

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function loadConsultantKnowledge(): Promise<ConsultantKnowledgeArticle[]> {
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", KNOWLEDGE_KEY)
    .maybeSingle();

  if (!data?.value?.trim()) return DEFAULT_KNOWLEDGE_ARTICLES;

  try {
    const parsed = JSON.parse(data.value);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as ConsultantKnowledgeArticle[];
    }
  } catch {
    // fallback to defaults
  }
  return DEFAULT_KNOWLEDGE_ARTICLES;
}

export async function saveConsultantKnowledge(
  articles: ConsultantKnowledgeArticle[],
): Promise<void> {
  const s = await db();
  // Без onConflict. Первичный ключ app_settings — (bot_id, key) начиная с
  // MIGRATION-02, и явное ON CONFLICT (key) Postgres отвергает целиком
  // («no unique or exclusion constraint matching the ON CONFLICT
  // specification»). Об этом предупреждает шапка самой миграции; остальные
  // места пишут в app_settings обычным upsert и работают.
  const { error } = await s.from("app_settings").upsert({
    key: KNOWLEDGE_KEY,
    value: JSON.stringify(articles),
  });
  // Ошибку глотать нельзя: вызывающий рапортует «добавлено N статей», и
  // молчаливый отказ выглядит как успех, после которого ничего не появилось.
  if (error) {
    throw new Error(`Не удалось сохранить базу знаний: ${error.message}`);
  }
}

/**
 * Парсинг текста или загруженного файла базы знаний с тегами.
 * Поддерживает форматы:
 * # Заголовок
 * Теги: полотенца, турция
 * Текст...
 * ---
 */
export function parseKnowledgeArticlesFromText(text: string): ConsultantKnowledgeArticle[] {
  const sections = text
    .split(/(?:^|\r?\n)(?:---+|###+|##+)\s*/g)
    .filter((s) => s.trim().length > 0);
  if (sections.length === 0) return [];

  const articles: ConsultantKnowledgeArticle[] = [];
  let index = 1;

  for (const sec of sections) {
    const lines = sec.trim().split("\n");
    if (lines.length === 0) continue;

    let title = lines[0].replace(/^[#\s*•-]+/, "").trim();
    if (!title) title = `Статья ${index}`;

    const remainingLines: string[] = [];
    const tags: string[] = [];

    const bracketMatch = title.match(/\[(.*?)\]/);
    if (bracketMatch) {
      const bTags = bracketMatch[1]
        .split(/[,;#]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      tags.push(...bTags);
      title = title.replace(/\[(.*?)\]/, "").trim();
    }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const matchTags = line.match(/^(?:теги|tags|метки|категории):\s*(.+)$/i);
      if (matchTags) {
        const parsed = matchTags[1]
          .split(/[,;#]+/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        tags.push(...parsed);
      } else {
        const inlineHashtags = line.match(/#([a-zA-Zа-яА-ЯёЁ0-9_-]+)/g);
        if (inlineHashtags) {
          for (const ht of inlineHashtags) {
            tags.push(ht.replace(/^#/, "").trim().toLowerCase());
          }
        }
        remainingLines.push(line);
      }
    }

    const content = remainingLines.join("\n").trim();
    if (content.length > 0 || title.length > 0) {
      articles.push({
        id: `kb-${Date.now()}-${index}`,
        title,
        tags: Array.from(new Set(tags)),
        content: content || title,
        updatedAt: new Date().toISOString(),
      });
      index++;
    }
  }

  return articles;
}

/**
 * Сколько символов базы знаний ещё дешевле держать в промпте, чем ходить за
 * ними инструментом. Маленькая база (несколько абзацев) стоит копейки и
 * экономит раунд обращения к модели; большая — три четверти счёта за ввод.
 */
export const KNOWLEDGE_INLINE_MAX_CHARS = 6000;

export function knowledgeSize(articles: ConsultantKnowledgeArticle[]): number {
  return articles.reduce((sum, a) => sum + a.content.length + a.title.length, 0);
}

export function knowledgeFitsInPrompt(articles: ConsultantKnowledgeArticle[]): boolean {
  return knowledgeSize(articles) <= KNOWLEDGE_INLINE_MAX_CHARS;
}

/**
 * Оглавление вместо самой базы: названия статей и теги, без содержимого.
 * Модель видит, что в базе есть, и забирает нужную статью инструментом
 * search_knowledge. У BOVI полная база — это около двадцати процентов
 * промпта, а нужна она в одном разговоре из нескольких.
 */
export function formatKnowledgeIndexForPrompt(articles: ConsultantKnowledgeArticle[]): string {
  if (!articles || articles.length === 0) return "";
  const lines: string[] = [
    "БАЗА ЗНАНИЙ О ТОВАРАХ, ПРОИЗВОДИТЕЛЯХ И МАТЕРИАЛАХ BOVI — ОГЛАВЛЕНИЕ.",
    "Сами тексты статей здесь не приводятся: нужную забирайте инструментом search_knowledge и цитируйте её формулировками.",
  ];
  for (const a of articles) {
    const tagStr = a.tags.length > 0 ? ` [${a.tags.slice(0, 8).join(", ")}]` : "";
    lines.push(`• ${a.title}${tagStr}`);
  }
  return lines.join("\n");
}

/**
 * Поиск по базе знаний: статьи, чьи название, теги или текст пересекаются с
 * запросом. Ранжирование простое — сколько слов запроса нашлось; название и
 * теги весят больше текста, потому что именно они описывают тему статьи.
 */
export function searchKnowledge(
  query: string,
  articles: ConsultantKnowledgeArticle[],
  limit = 3,
): ConsultantKnowledgeArticle[] {
  // Сравниваем по началу слова, а не по целому: стеммер каталога оставляет
  // «стирать» как есть, а в статье написано «стирка», и точное совпадение
  // такую пару не ловит. Слова короче четырёх букв («как», «что») выкидываем.
  const keys = searchTokens(query)
    .filter((t) => t.length >= 4)
    .map((t) => t.slice(0, 4));
  if (keys.length === 0) return [];
  const scored = articles
    .map((a) => {
      const head = haystackOf([a.title, a.tags.join(" ")]);
      const body = haystackOf([a.content]);
      let score = 0;
      for (const key of keys) {
        if (head.includes(key)) score += 3;
        else if (body.includes(key)) score += 1;
      }
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map((x) => x.a);
}

/**
 * То же, что searchKnowledge, но с оценкой совпадения.
 *
 * Нужна, чтобы отличить «вопрос ровно про эту статью» от «в статье случайно
 * встретилось то же слово». Три очка даёт попадание в название или теги, одно
 * — в текст. Запрос «какая плотность у полотенец Uchino» набирает по
 * названию «Справочник по плотности полотенец» шесть и выше, а просто «есть
 * полотенца?» — три: одного слова для подстановки статьи мало.
 */
export function searchKnowledgeScored(
  query: string,
  articles: ConsultantKnowledgeArticle[],
  limit = 3,
  /**
   * Слова, которые в счёт не идут. Сюда передаётся словарь каталога: названия
   * товаров и категорий. Без него «есть полотенца?» и «какая плотность?»
   * набирают поровну — оба один раз попадают в название «Справочник по
   * плотности полотенец», — а это принципиально разные вопросы. Слово из
   * каталога описывает товар, слово не из каталога описывает свойство,
   * которого в прайсе нет, и вот за ним и надо идти в базу знаний.
   */
  ignore?: ReadonlySet<string>,
): { article: ConsultantKnowledgeArticle; score: number }[] {
  const keys = searchTokens(query)
    .filter((t) => t.length >= 4)
    .map((t) => t.slice(0, 4))
    .filter((k) => !ignore?.has(k));
  if (keys.length === 0) return [];
  return articles
    .map((a) => {
      const head = haystackOf([a.title, a.tags.join(" ")]);
      const body = haystackOf([a.content]);
      let score = 0;
      for (const key of keys) {
        if (head.includes(key)) score += 3;
        else if (body.includes(key)) score += 1;
      }
      return { article: a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

/**
 * Статья о марке, про которую спрашивают.
 *
 * Подстановка по словам намеренно не считает слова каталога, а название
 * марки — слово каталога. Поэтому на «Риволта это бренд какой страны? И
 * расскажите о качестве» (живой тест 23.09) статья не подкладывалась, хотя в
 * справочнике прямо написано: «Rivolta Carmignani (Италия) — знаменитый
 * итальянский производитель премиального текстиля, поставляющий продукцию в
 * лучшие отели класса люкс». Модель в оглавление не полезла и позвала
 * менеджера.
 *
 * Здесь свой отбор: вопрос о свойствах марки (качество, страна, материал,
 * технология, уход) и сама марка в тексте — тогда берём статью, где эта
 * марка встречается чаще всего; название статьи весит больше текста.
 * Кириллическое написание марки («Риволта») к этому моменту уже приведено к
 * фабричному — см. fixBrandSpelling.
 */
const BRAND_ATTRIBUTE_RE =
  /качеств|стран|производ|произвед|материал|состав|технолог|плотност|уход|стирк|гарант|откуда|ч[её]й\b|чья|бренд|марк[аиуе]|фабрик/i;

/** Марки из списка, названные в тексте (в нижнем регистре). */
export function brandsInText(text: string, brands: string[]): string[] {
  const q = (text ?? "").toLowerCase();
  return brands
    .map((b) => b.toLowerCase())
    .filter((b) => b.length >= 4 && new RegExp(`(^|[^a-z])${b}([^a-z]|$)`).test(q));
}

/** Говорит ли статья хоть об одной из марок. */
export function articleMentions(article: ConsultantKnowledgeArticle, brands: string[]): boolean {
  const hay = `${article.title}\n${article.content}`.toLowerCase();
  return brands.some((b) => hay.includes(b.toLowerCase()));
}

export function articleAboutBrand(
  query: string,
  articles: ConsultantKnowledgeArticle[],
  brands: string[],
): ConsultantKnowledgeArticle | null {
  const q = (query ?? "").toLowerCase();
  if (!q || !BRAND_ATTRIBUTE_RE.test(q)) return null;
  const asked = brandsInText(q, brands);
  if (asked.length === 0) return null;
  let best: { article: ConsultantKnowledgeArticle; score: number } | null = null;
  for (const a of articles) {
    const title = a.title.toLowerCase();
    const body = a.content.toLowerCase();
    let score = 0;
    for (const b of asked) {
      if (title.includes(b)) score += 3;
      score += body.split(b).length - 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { article: a, score };
  }
  return best?.article ?? null;
}

/**
 * Какую статью подложить к вопросу покупателя — или никакую.
 *
 * Два отбора. По словам: слово вопроса, которого нет в каталоге, попадает в
 * название статьи (плотность, уход, стирка). По марке: вопрос о свойствах
 * марки, названной в тексте, в том числе кириллицей. Статья, найденная по
 * словам, побеждает только если говорит о названной марке — иначе на вопрос
 * о Rivolta приезжала статья о бренде BOVI с Португалией и Турцией.
 */
export function pickArticleForQuestion(
  query: string,
  articles: ConsultantKnowledgeArticle[],
  catalog: ConsultantProduct[],
  minScore = 3,
): ConsultantKnowledgeArticle | null {
  const [best] = searchKnowledgeScored(query, articles, 1, catalogKeySet(catalog));
  let article = best && best.score >= minScore ? best.article : null;
  const brands = brandVocabulary(catalog);
  const fixed = fixBrandSpelling(query, brands);
  const asked = brandsInText(fixed, brands);
  if (asked.length > 0 && (!article || !articleMentions(article, asked))) {
    article = articleAboutBrand(fixed, articles, brands);
  }
  return article;
}

/** Словарь каталога: по четыре первых буквы слов из названий и категорий. */
export function catalogKeySet(
  catalog: { name: string; category: string }[],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const p of catalog) {
    for (const t of searchTokens(`${p.name} ${p.category}`)) {
      if (t.length >= 4) out.add(t.slice(0, 4));
    }
  }
  return out;
}

export function formatKnowledgeForPrompt(articles: ConsultantKnowledgeArticle[]): string {
  if (!articles || articles.length === 0) return "";
  const lines: string[] = ["БАЗА ЗНАНИЙ О ТОВАРАХ, ПРОИЗВОДИТЕЛЯХ И МАТЕРИАЛАХ BOVI:"];
  for (const a of articles) {
    const tagStr = a.tags.length > 0 ? ` [Теги: ${a.tags.join(", ")}]` : "";
    lines.push(`• ${a.title}${tagStr}:\n  ${a.content}`);
  }
  return lines.join("\n\n");
}
