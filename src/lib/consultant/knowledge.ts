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

export function formatKnowledgeForPrompt(articles: ConsultantKnowledgeArticle[]): string {
  if (!articles || articles.length === 0) return "";
  const lines: string[] = ["БАЗА ЗНАНИЙ О ТОВАРАХ, ПРОИЗВОДИТЕЛЯХ И МАТЕРИАЛАХ BOVI:"];
  for (const a of articles) {
    const tagStr = a.tags.length > 0 ? ` [Теги: ${a.tags.join(", ")}]` : "";
    lines.push(`• ${a.title}${tagStr}:\n  ${a.content}`);
  }
  return lines.join("\n\n");
}
