import * as XLSX from "xlsx";
import { parseCatalogCsv, type CatalogImportResult } from "./catalog-import";

export function parseCatalogXlsx(bytes: Uint8Array): CatalogImportResult {
  const wb = XLSX.read(bytes, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { products: [], errors: [{ row: 0, message: "пустая книга Excel" }] };
  const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName], { FS: ";" });
  return parseCatalogCsv(csv);
}

export function decodeBase64Xlsx(b64: string): Uint8Array {
  const raw = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  return Uint8Array.from(Buffer.from(raw, "base64"));
}
