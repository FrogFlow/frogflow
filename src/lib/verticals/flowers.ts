/**
 * Специфика ниши «Цветы и флористика» (flowers) — WhatsApp-First.
 */

export type FlowerDeliveryType = "urgent" | "scheduled";

export type FlowerTimeSlot =
  | "09:00 - 12:00"
  | "12:00 - 15:00"
  | "15:00 - 18:00"
  | "18:00 - 21:00"
  | "urgent_60_90";

export const DEFAULT_FLOWER_TIME_SLOTS: { id: FlowerTimeSlot; label: string }[] = [
  { id: "urgent_60_90", label: "⚡ Срочная доставка (60–90 минут)" },
  { id: "09:00 - 12:00", label: "Утро: 09:00 – 12:00" },
  { id: "12:00 - 15:00", label: "День: 12:00 – 15:00" },
  { id: "15:00 - 18:00", label: "Вечер: 15:00 – 18:00" },
  { id: "18:00 - 21:00", label: "Поздний вечер: 18:00 – 21:00" },
];

export type FlowerRecipientInfo = {
  isThirdParty: boolean;
  name?: string;
  phone?: string;
  callBeforeDelivery: boolean;
  isSurprise: boolean;
  address?: string;
};

export type FlowerScheduling = {
  type: FlowerDeliveryType;
  date?: string; // YYYY-MM-DD
  timeSlot?: string;
};

export type FlowerPostcard = {
  included: boolean;
  text?: string;
  senderName?: string;
};

export type FlowerPhotoApproval = {
  requested: boolean;
  photoUrl?: string;
  approvedAt?: string;
};

export type FlowerOrderMetadata = {
  recipient: FlowerRecipientInfo;
  scheduling: FlowerScheduling;
  postcard?: FlowerPostcard;
  photoApproval?: FlowerPhotoApproval;
};

export type FlowerOccasion =
  | "birthday"
  | "romance"
  | "anniversary"
  | "maternity"
  | "wedding"
  | "apology"
  | "sympathy"
  | "just_because";

const OCCASION_PATTERNS: Record<FlowerOccasion, RegExp> = {
  birthday: /рождени[яеи]|юбиле[йя]|др\b|лет\b/i,
  romance: /свидани[ея]|девушк[еиу]|люб[лю|им]|романтик/i,
  anniversary: /годовщин[аеы]|свадьб[аеы]|лет\s+вместе/i,
  maternity: /выписк[аеуы]|роддом|рождение\s+ребенка|малыш/i,
  wedding: /свадебн|невест|венчани/i,
  apology: /извини|прости|виноват/i,
  sympathy: /соболезнован|памят|похорон/i,
  just_because: /просто\s+так|порадовать|настроени/i,
};

export function matchFlowerOccasion(text: string): FlowerOccasion | null {
  const t = text.trim().toLowerCase();
  for (const [occasion, regex] of Object.entries(OCCASION_PATTERNS)) {
    if (regex.test(t)) return occasion as FlowerOccasion;
  }
  return null;
}

export type FlowerSpecies =
  | "roses"
  | "peonies"
  | "hydrangeas"
  | "tulips"
  | "gypsophila"
  | "eustoma"
  | "lilies"
  | "chrysanthemums"
  | "daisies";

const SPECIES_PATTERNS: Record<FlowerSpecies, RegExp> = {
  roses: /роз[аыеу]|розочк/i,
  peonies: /пион[ыова]/i,
  hydrangeas: /гортензи/i,
  tulips: /тюльпан/i,
  gypsophila: /гипсофил/i,
  eustoma: /эустом/i,
  lilies: /лили[яи]/i,
  chrysanthemums: /хризантем/i,
  daisies: /ромашк/i,
};

export function matchFlowerSpecies(text: string): FlowerSpecies[] {
  const t = text.trim().toLowerCase();
  const matched: FlowerSpecies[] = [];
  for (const [species, regex] of Object.entries(SPECIES_PATTERNS)) {
    if (regex.test(t)) matched.push(species as FlowerSpecies);
  }
  return matched;
}

export function matchFlowerBudget(text: string): { maxPrice?: number; raw: string } | null {
  const t = text.replace(/\s+/g, " ");
  // Match "до 25 000", "до 25000", "до 25к", "бюджет 30 тыс", "около 20000"
  const m = t.match(
    /(?:до|бюджет|в\s+районе|около|примерно)\s*(\d+[\s\d]*)\s*(?:тыс|к|k|тг|тенге|руб|т)?/i,
  );
  if (!m) return null;
  const numStr = m[1].replace(/\s+/g, "");
  let num = parseInt(numStr, 10);
  if (isNaN(num)) return null;
  const isK = /(тыс|к|k)/i.test(m[0]);
  if (isK && num < 1000) num *= 1000;
  return { maxPrice: num, raw: m[0].trim() };
}
