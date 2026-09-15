import type { UniversalNiche } from "./profile";

export type KnowledgeDocument = {
  id: string;
  title: string;
  category?: string;
  content: string;
  tags?: string[];
  source_file?: string;
};

export const ALMATY_SUPPLEMENTS_DOCS: KnowledgeDocument[] = [
  {
    id: "supp_d3_k2",
    title: "Витамин D3 5000 МЕ + K2 (Капли / Капсулы)",
    category: "Витамины и иммунитет",
    tags: ["д3", "d3", "k2", "иммунитет", "витамин", "дозировка", "цена"],
    content: `Состав: Высокоусвояемый холекальциферол (D3 5000 IU) с натуральным менахиноном (K2-MK7 100 мкг).
Показания: Поддержка иммунитета, укрепление костной ткани и зубов, повышение уровня энергии при хронической усталости.
Способ применения и дозировка: Взрослым по 1 капсуле в день во время первого приема пищи, содержащей полезные жиры.
Курс приема: 2–3 месяца.
Противопоказания: Индивидуальная непереносимость компонентов, гиперкальциемия.
Стоимость: 7 500 ₸ за упаковку (60 капсул, курс на 2 месяца). В наличии в Алматы.`,
  },
  {
    id: "supp_marine_collagen",
    title: "Морской пептидный коллаген 1 и 3 типа + Hyaluronic Acid + Vitamin C",
    category: "Красота и суставы",
    tags: ["коллаген", "кожа", "волосы", "суставы", "морской", "пептиды"],
    content: `Состав: Низкомолекулярный гидролизованный пептидный морской коллаген (Франция), гиалуроновая кислота, витамин C для 100% усвоения.
Показания: Упругость кожи, уменьшение морщин, укрепление волос и ногтей, подвижность и восстановление суставов и связок.
Способ применения: 1 мерную ложку (5 г) порошка растворить в стакане теплой воды или сока. Принимать утром натощак за 30 минут до завтрака.
Курс приема: 3 месяца.
Стоимость: 14 900 ₸ (банка 300 г, 60 порций). В наличии в Алматы.`,
  },
  {
    id: "supp_omega3_triple",
    title: "Омега-3 Тройная Сила (Triple Strength EPA 600 / DHA 400)",
    category: "Сердце и мозг",
    tags: ["омега", "omega", "рыбий жир", "сосуды", "мозг", "холестерин"],
    content: `Состав: Сверхчистый концентрат дикой морской рыбы северных морей (Норвегия). Триглицеридная форма. Без запаха и рыбного послевкусия.
Показания: Защита сосудов и сердца, снижение уровня плохого холестерина, улучшение концентрации памяти, увлажнение сухой кожи.
Способ применения: По 1 капсуле 1–2 раза в день во время еды.
Курс приема: 2–3 месяца, подходит для постоянного приема.
Стоимость: 11 200 ₸ (банка 90 капсул). В наличии в Алматы.`,
  },
  {
    id: "supp_delivery_payment",
    title: "Условия доставки и оплаты по Алматы и Казахстану",
    category: "Доставка и сервис",
    tags: ["доставка", "оплата", "алматы", "kaspi", "яндекс", "сдэк", "казпочта"],
    content: `Доставка по Алматы:
• Экспресс-доставка Яндекс Курьером в день заказа (обычно 1–2 часа). Тариф от 1 500 ₸ по тарифам Яндекса. При заказе от 30 000 ₸ — бесплатная доставка.
• Самовывоз: г. Алматы, офис/шоурум на пр. Достык (ежедневно с 10:00 до 19:00).
Доставка по Казахстану:
• СДЭК до двери или в пункт выдачи (1–3 дня, от 2 000 ₸).
• Казпочта в любой населенный пункт РК (3–5 дней).
Способы оплаты:
• Kaspi Pay: Kaspi QR или удаленный счет в приложении Kaspi (для физлиц и юрлиц).
• Наличными курьеру при получении в Алматы.`,
  },
  {
    id: "supp_medical_disclaimer",
    title: "Стандарт консультаций и официальный регламент",
    category: "Безопасность",
    tags: ["дисклеймер", "безопасность", "сертификат", "сгр", "врач"],
    content: `Вся продукция официально импортирована, сертифицирована в соответствии с техрегламентами Таможенного союза / ЕАЭС и имеет свидетельства о государственной регистрации (СГР).
Официальный дисклеймер: Вся представленная продукция является биологически активными добавками к пище (БАД) и не является лекарственными средствами.
Регламент консультанта: Бот не ставит медицинских диагнозов, не отменяет назначения лечащего врача. При беременности, грудном вскармливании или приеме рецептурных препаратов клиенту рекомендуется согласовать прием со своим врачом.`,
  },
];

export const WESTERN_FLOWERS_DOCS: KnowledgeDocument[] = [
  {
    id: "flower_occasions",
    title: "Floral Collections & Occasion Styling",
    category: "Collections",
    tags: ["flowers", "roses", "peonies", "anniversary", "birthday", "sympathy", "occasions"],
    content: `Every bouquet is an original floral creation handcrafted using freshly cut premium blooms.
Occasion Guide:
• Romance & Anniversary: Lush garden roses, Sarah Bernhardt peonies, ranunculus, and silver dollar eucalyptus in blush, crimson, and champagne tones.
• Birthday & Celebrations: Cheerful, vibrant mixes featuring hydrangeas, lisianthus, spray roses, and seasonal foliage.
• Sympathy & Condolences: Serene, understated compositions in pure white, ivory, and soft greens (calla lilies, white avalanche roses, cascading greenery). Designed with utmost discretion and respect.
• Thank You & Congratulations: Fresh pastel garden bouquets, bright sunflowers, or delicate tulips.`,
  },
  {
    id: "flower_pricing_tiers",
    title: "Pricing Tiers & Bouquet Sizes",
    category: "Pricing",
    tags: ["price", "cost", "budget", "standard", "deluxe", "premium", "vase"],
    content: `Bouquet Pricing Options:
• Standard Petite ($75): Charming, elegant compact bouquet (approx. 10–12 stems). Ideal for coffee tables and everyday smiles.
• Deluxe Statement ($115) [Most Popular]: Generous, full arrangement (approx. 18–22 stems) with focal garden roses, premium fillers, and lush textures.
• Premium Grand Luxe ($165+): High-impact architectural arrangement (approx. 30+ luxury stems) in our signature oversized packaging.
• Optional Keepsake Glass Vase: +$18 (curated modern clear glass vase pre-filled with floral water food).`,
  },
  {
    id: "flower_delivery_bloomsnap",
    title: "Delivery Timeslots & BloomSnap Quality Guarantee",
    category: "Delivery",
    tags: ["delivery", "same day", "bloomsnap", "photo", "hours", "tracking"],
    content: `Delivery Schedule:
• Same-Day Delivery: Available for all orders placed before 1:00 PM local time.
• Delivery Windows: Morning slot (9:00 AM – 1:00 PM) or Afternoon slot (1:00 PM – 6:00 PM).
• Safe Transport: Delivered in a specialized temperature-controlled water pack so blooms arrive dewy and fresh.
BloomSnap Promise:
Before dispatching the bouquet with our delivery team, the master florist snaps a high-resolution photo ("BloomSnap") of the exact finished arrangement and shares it right here in this Direct chat for your reassurance.`,
  },
  {
    id: "flower_card_messages",
    title: "Complimentary Handwritten Stationery Card",
    category: "Gift Services",
    tags: ["card", "message", "postcard", "note", "gift"],
    content: `Every floral order includes a complimentary, thick matte letterpress gift card.
Customers can specify their personal message (up to 250 characters) and signature name.
Our florists transcribe the message with neat calligraphy and seal it in an envelope attached to the bouquet wrap.`,
  },
  {
    id: "flower_payment_stripe",
    title: "Payment & Online Checkout Link",
    category: "Payment",
    tags: ["payment", "stripe", "apple pay", "credit card", "usd"],
    content: `Payment Process:
Once the order details (bouquet tier, recipient name, address, delivery date, card note) are confirmed, we generate a secure Stripe checkout link.
Supported Payment Methods: Apple Pay, Google Pay, Visa, MasterCard, American Express.
Once payment is completed, the florist immediately begins preparation.`,
  },
];

export function getPresetKnowledgeDocs(niche: UniversalNiche): KnowledgeDocument[] {
  switch (niche) {
    case "supplements":
      return ALMATY_SUPPLEMENTS_DOCS;
    case "flowers":
      return WESTERN_FLOWERS_DOCS;
    default:
      return [];
  }
}

const KNOWLEDGE_STOP_WORDS = new Set([
  "для", "как", "что", "или", "при", "под", "над", "это", "все", "всё", "про", "без", "ваш", "вас", "вам", "мне", "нам",
  "the", "and", "for", "with", "from", "that", "this", "have", "you", "your",
]);

export function tokenizeKnowledgeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !KNOWLEDGE_STOP_WORDS.has(w));
}

function scoreDocument(doc: KnowledgeDocument, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const hay = `${doc.title} ${doc.category || ""} ${(doc.tags || []).join(" ")} ${doc.content}`.toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (doc.title.toLowerCase().includes(token)) {
      score += 5;
    }
    if ((doc.tags || []).some((t) => t.toLowerCase().includes(token))) {
      score += 3;
    }
    if (hay.includes(token)) {
      score += 1;
    }
  }
  return score;
}

export function retrieveKnowledge(
  query: string,
  documents: KnowledgeDocument[],
  topK = 3,
): KnowledgeDocument[] {
  if (!query.trim() || documents.length === 0) return [];
  const tokens = tokenizeKnowledgeQuery(query);
  if (tokens.length === 0) return documents.slice(0, topK);

  const scored = documents
    .map((doc) => ({ doc, score: scoreDocument(doc, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return documents.slice(0, topK);
  }

  return scored.slice(0, topK).map((item) => item.doc);
}

export function formatKnowledgeForPrompt(documents: KnowledgeDocument[]): string {
  if (documents.length === 0) return "";

  const lines = ["БАЗА ЗНАНИЙ И ДОКУМЕНТЫ КОМПАНИИ:"];
  for (const doc of documents) {
    lines.push(`\n[ДОКУМЕНТ: ${doc.title}${doc.category ? ` | Категория: ${doc.category}` : ""}]`);
    lines.push(doc.content.trim());
  }
  return lines.join("\n");
}
