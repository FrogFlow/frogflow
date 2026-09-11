import type { ConsultantProduct } from "./catalog";

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
  ],
  stock: ["stock", "наличие", "in_stock", "вналичии"],
  stock_qty: ["stock_qty", "qty", "количество", "кол-во", "остаток", "остатоксклад", "колво"],
  skip: [],
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

function detectDelimiter(headerLine: string): string {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semis = (headerLine.match(/;/g) ?? []).length;
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  if (tabs > commas && tabs > semis) return "\t";
  return semis > commas ? ";" : ",";
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

function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseColors(raw: string): string[] {
  return raw
    .split(/[,/;|]/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function slugId(name: string, index: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base ? `${base}-${index}` : `row-${index}`;
}

/** Разбор ежедневной выгрузки Excel/CSV. Цена и наличие живут здесь, не в prompt. */
export function parseCatalogCsv(text: string): CatalogImportResult {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { products: [], errors: [{ row: 0, message: "пустой файл" }] };

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map(resolveHeader);
  if (!headers.includes("name") && !headers.includes("id")) {
    return {
      products: [],
      errors: [{ row: 1, message: "нет колонки названия или артикула" }],
    };
  }

  const products: ConsultantProduct[] = [];
  const errors: CatalogImportError[] = [];
  const usedIds = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
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
        const n = Number(String(value).replace(",", "."));
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
      errors.push({ row: i + 1, message: "пустая строка без названия" });
      continue;
    }
    if (row.price_kzt == null) {
      errors.push({ row: i + 1, message: `нет цены: ${name || row.id}` });
      continue;
    }

    let id = String(row.id ?? "").trim() || slugId(name || "item", i);
    if (usedIds.has(id)) id = `${id}-${i}`;
    usedIds.add(id);

    const qty = row.stock_qty;
    const stock = row.stock ?? (qty == null ? true : qty > 0);

    products.push({
      id,
      name: name || id,
      category: String(row.category ?? "").trim(),
      size: String(row.size ?? "").trim(),
      colors: row.colors ?? [],
      price_kzt: row.price_kzt,
      stock,
      ...(qty != null ? { stock_qty: qty } : {}),
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
