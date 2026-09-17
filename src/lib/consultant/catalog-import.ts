import { extractHardness, type ConsultantProduct } from "./catalog";

export type CatalogImportError = { row: number; message: string };

export type CatalogImportResult = {
  products: ConsultantProduct[];
  errors: CatalogImportError[];
};

const HEADER_ALIASES: Record<keyof ConsultantProduct | "skip", string[]> = {
  id: ["id", "артикул", "sku", "код", "code", "номенклатуракод", "кодтовара"],
  name: [
    "name",
    "название",
    "товар",
    "наименование",
    "product",
    "номенклатура",
    "наименованиетовара",
  ],
  category: ["category", "категория", "раздел", "группа", "вид", "видтовара"],
  size: ["size", "размер", "разм", "габарит", "характеристика"],
  colors: ["color", "colors", "цвет", "цвета", "цветткани", "расцветка", "окрас"],
  price_kzt: [
    "price_kzt",
    "price",
    "цена",
    "цена_тг",
    "цена тг",
    "kzt",
    "ценарозничная",
    "розничнаяцена",
    "ценатенге",
    "розничная",
    "стоимость",
    "розничнаяценатенге",
  ],
  stock: ["stock", "наличие", "in_stock", "вналичии"],
  stock_qty: [
    "stock_qty",
    "qty",
    "количество",
    "кол-во",
    "остаток",
    "остатоксклад",
    "колво",
    "остатоктовара",
    "конечныйостаток",
  ],
  material: [
    "material",
    "ткань",
    "состав",
    "материал",
    "качество",
    "плотность",
    "fabric",
    "composition",
  ],
  description: ["description", "описание", "характеристики", "описаниетовара"],
  hardness: ["hardness", "жесткость", "жёсткость", "жесткостьматраса", "firmness"],
  skip: ["итого", "всего"],
};

function normHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[.]/g, "");
}

function resolveHeader(raw: string): keyof ConsultantProduct | null {
  const h = normHeader(raw);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (field === "skip") continue;
    if (aliases.includes(h)) return field as keyof ConsultantProduct;
  }
  return null;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function detectDelimiter(lines: string[]): string {
  let totalCommas = 0;
  let totalSemis = 0;
  let totalTabs = 0;
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    totalCommas += (lines[i].match(/,/g) ?? []).length;
    totalSemis += (lines[i].match(/;/g) ?? []).length;
    totalTabs += (lines[i].match(/\t/g) ?? []).length;
  }
  if (totalTabs > totalCommas && totalTabs > totalSemis) return "\t";
  return totalSemis > totalCommas ? ";" : ",";
}

function parseBoolStock(raw: string, qty: number | undefined): boolean {
  const v = raw.trim().toLowerCase();
  if (!v) return qty == null ? true : qty > 0;
  if (["0", "нет", "no", "false", "н", "out"].includes(v)) return false;
  if (["1", "да", "yes", "true", "y", "in"].includes(v)) return true;
  const n = Number(v.replace(",", "."));
  if (Number.isFinite(n)) return n > 0;
  return true;
}

/**
 * Цена из выгрузки 1С.
 *
 * Боевой отчёт «Остатки товара по складам с ценами» пишет цену как
 * «47,000   KZT», и запятая в нём — разделитель ТЫСЯЧ, а не дробной части:
 * во всех 879 строках после неё ровно три цифры, а позиции вида
 * «1,200,000   KZT» не оставляют других толкований. Прежний разбор снимал
 * пробелы и менял запятую на точку, получая «47.000KZT» → NaN, то есть не
 * читал ни одной строки; а «починка» одной только валюты дала бы 47 ₸
 * вместо 47 000 — ошибку в тысячу раз, которую бот отдал бы покупателю.
 */
function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const lastSep = Math.max(lastDot, lastComma);

  let normalized = cleaned;
  if (lastSep >= 0) {
    const tail = cleaned.slice(lastSep + 1);
    // Последний разделитель дробный, только если после него 1–2 цифры либо
    // в числе присутствуют оба вида разделителей («1,234.56»). Три цифры
    // после разделителя — это группировка тысяч.
    const bothKinds = lastDot >= 0 && lastComma >= 0;
    const isDecimal = bothKinds || (tail.length > 0 && tail.length <= 2);
    normalized = isDecimal
      ? `${cleaned.slice(0, lastSep).replace(/[.,]/g, "")}.${tail}`
      : cleaned.replace(/[.,]/g, "");
  }

  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseColors(raw: string): string[] {
  return raw
    .split(/[,/;|]/)
    .map((c) => c.trim())
    .filter(Boolean);
}

export function extractSizeFromName(name: string): string {
  const dimMatch = name.match(
    /(\d{2,3}\s*[xхXХ*×]\s*\d{2,3}(?:\s*[-–/]\s*\d{2,3}\s*[xхXХ*×]\s*\d{2,3})?(?:\s*[xхXХ*×]\s*\d{1,3})?)/,
  );
  if (dimMatch) return dimMatch[1].replace(/\s+/g, "");
  const sizeNamedMatch =
    name.match(/размер[.\s]+([A-Za-z0-9/+-]+)/i) || name.match(/разм[.\s]+([A-Za-z0-9/+-]+)/i);
  if (sizeNamedMatch) return sizeNamedMatch[1].trim();
  return "";
}

function cleanRussianColor(raw: string): string {
  let c = raw.trim().toLowerCase().replace(/[.]+$/, "");
  if (c === "слонов.кость" || c === "слон.кость") return "слоновая кость";
  if (c === "светло-корич" || c === "светло-корич.") return "светло-коричневый";
  if (c === "серебр" || c === "серебр.") return "серебристый";
  if (c === "голуб" || c === "голуб.") return "голубой";
  if (c === "роз" || c === "роз.") return "розовый";
  if (c === "беж" || c === "беж.") return "бежевый";
  return c;
}

export function extractColorsFromName(name: string): string[] {
  const match = name.match(
    /цв(?:ет|[.])\s*([A-Za-zА-Яа-яЁё0-9\s/+_.-]+?)(?=[,;()]|\s*(?:высота|размер|\d+\s*см|\d+\s*[lLлЛ])|$)/i,
  );
  if (!match) return [];
  let rawColor = match[1].trim().replace(/[.]+$/, "");
  rawColor = rawColor.replace(/^\d+\s+/, "");
  if (!rawColor) return [];
  if (rawColor.includes("/")) {
    const parts = rawColor.split("/").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      const hasCyr1 = /[а-яА-ЯёЁ]/.test(parts[0]);
      const hasLat1 = /[a-zA-Z]/.test(parts[0]);
      const hasCyr2 = /[а-яА-ЯёЁ]/.test(parts[1]);
      const hasLat2 = /[a-zA-Z]/.test(parts[1]);

      if (hasLat1 && hasCyr2 && !hasLat2) {
        const lat = parts[0];
        const ru = cleanRussianColor(parts[1]);
        return [`${ru} (${lat})`];
      } else if (hasCyr1 && hasLat2 && !hasLat1) {
        const ru = cleanRussianColor(parts[0]);
        const lat = parts[1];
        return [`${ru} (${lat})`];
      }
    }
    return parts.map((c) => cleanRussianColor(c));
  }
  return [cleanRussianColor(rawColor)];
}

function slugId(name: string, index: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base ? `${base}-${index}` : `row-${index}`;
}

/** Разбор ежедневной выгрузки Excel/CSV (включая иерархические отчеты 1C). */
export function parseCatalogCsv(text: string): CatalogImportResult {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { products: [], errors: [{ row: 0, message: "пустой файл" }] };

  const delimiter = detectDelimiter(lines);

  // Scan up to 30 lines to locate the header row (supporting metadata prefixes in 1C exports)
  let headerRowIndex = -1;
  let headers: Array<keyof ConsultantProduct | null> = [];
  let dataStartRow = -1;

  for (let r = 0; r < Math.min(30, lines.length); r++) {
    const rowCells = parseCsvLine(lines[r], delimiter);
    const resolved = rowCells.map(resolveHeader);

    if (resolved.includes("name") || resolved.includes("id")) {
      headerRowIndex = r;
      headers = resolved;
      dataStartRow = r + 1;

      // Check if next row can be merged (e.g. 1C multi-line header: Row 1 'Розничная', Row 2 'Цена / Остаток')
      if (r + 1 < lines.length) {
        const nextRowCells = parseCsvLine(lines[r + 1], delimiter);
        const mergedHeaders: Array<keyof ConsultantProduct | null> = [];
        let mergedHelped = false;
        const maxLen = Math.max(rowCells.length, nextRowCells.length);
        for (let c = 0; c < maxLen; c++) {
          const c1 = rowCells[c] || "";
          const c2 = nextRowCells[c] || "";
          const combined = (c1 + " " + c2).trim();
          const res = resolveHeader(combined) || resolveHeader(c1) || resolveHeader(c2);
          mergedHeaders.push(res);
          if (res && !resolved[c]) mergedHelped = true;
        }
        if (
          mergedHelped &&
          (mergedHeaders.includes("price_kzt") || mergedHeaders.includes("stock_qty"))
        ) {
          headers = mergedHeaders;
          dataStartRow = r + 2;
        }
      }
      break;
    }
  }

  if (headerRowIndex === -1 || (!headers.includes("name") && !headers.includes("id"))) {
    return {
      products: [],
      errors: [{ row: 1, message: "нет колонки названия или артикула" }],
    };
  }

  const products: ConsultantProduct[] = [];
  const errors: CatalogImportError[] = [];
  const usedIds = new Set<string>();
  const hasExplicitCategory = headers.includes("category");
  const hasExplicitSize = headers.includes("size");
  const hasExplicitColor = headers.includes("colors");

  let currentCategory = "";

  for (let i = dataStartRow; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i], delimiter);
    const row: Partial<ConsultantProduct> & { stock_qty?: number } = {};

    headers.forEach((field, idx) => {
      if (!field) return;
      const value = cells[idx] ?? "";
      if (field === "price_kzt") {
        const price = parsePrice(value);
        if (price != null) row.price_kzt = price;
        return;
      }
      if (field === "stock_qty") {
        // Пустая ячейка — это «остатка нет в отчёте», а не «остаток ноль».
        // Number("") === 0, и из-за этого строки-папки иерархического отчёта
        // 1С выглядели товаром с нулевым остатком, а товар без колонки
        // количества уезжал в «нет в наличии».
        const v = String(value).trim();
        if (!v) return;
        const n = Number(v.replace(",", "."));
        if (Number.isFinite(n)) row.stock_qty = n;
        return;
      }
      if (field === "stock") {
        row.stock = parseBoolStock(value, row.stock_qty);
        return;
      }
      if (field === "colors") {
        row.colors = parseColors(value);
        return;
      }
      (row as Record<string, unknown>)[field] = value;
    });

    const name = String(row.name ?? "").trim();
    if (!name && !row.id) {
      continue;
    }

    if (/^(итого|всего)\b/i.test(name)) {
      continue;
    }

    if (row.price_kzt == null) {
      // Строка-папка в иерархическом отчёте 1С: только название, ни цены, ни
      // остатка. Если остаток есть, это товар с непрочитанной ценой — и
      // молчать об этом нельзя, иначе прайс «импортируется» наполовину.
      if (!hasExplicitCategory && row.stock_qty == null) {
        currentCategory = name;
      } else {
        errors.push({ row: i + 1, message: `нет цены: ${name || row.id}` });
      }
      continue;
    }

    let id = String(row.id ?? "").trim() || slugId(name || "item", i);
    if (usedIds.has(id)) id = `${id}-${i}`;
    usedIds.add(id);

    const qty = row.stock_qty;
    const stock = row.stock ?? (qty == null ? true : qty > 0);

    const category = String(row.category ?? "").trim() || currentCategory;
    const size =
      hasExplicitSize && row.size ? String(row.size).trim() : extractSizeFromName(name);
    const colors =
      hasExplicitColor && row.colors?.length ? row.colors : extractColorsFromName(name);
    // Колонки жёсткости в выгрузках 1С обычно нет — фабрика пишет её в
    // названии («LEVANT R4 SOFT»), поэтому берём колонку, если она есть,
    // иначе разбираем название.
    const hardness = extractHardness(String(row.hardness ?? "")) ?? extractHardness(name);

    products.push({
      id,
      name: name || id,
      category,
      size,
      colors,
      price_kzt: row.price_kzt,
      stock,
      ...(qty != null ? { stock_qty: qty } : {}),
      ...(row.material ? { material: String(row.material).trim() } : {}),
      ...(row.description ? { description: String(row.description).trim() } : {}),
      ...(hardness ? { hardness } : {}),
    });
  }

  // Разобрали ноль позиций и при этом ни на что не пожаловались — так уже
  // было: формат цены сменился, каждая строка выглядела «папкой», и импорт
  // молча заканчивался пустым каталогом. Пустой результат обязан быть ошибкой.
  if (products.length === 0 && errors.length === 0 && lines.length > dataStartRow) {
    errors.push({
      row: dataStartRow + 1,
      message:
        "ни одной позиции с ценой — проверьте колонку цены и разделители в выгрузке",
    });
  }

  return { products, errors };
}

export function googleSheetsCsvUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (url.includes("output=csv") || url.includes("export?format=csv")) return url;
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const gidMatch = url.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gid}`;
}
