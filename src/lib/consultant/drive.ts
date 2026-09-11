import { parseCatalogCsv } from "./catalog-import";
import { parseCatalogXlsx } from "./xlsx-import";
import type { CatalogImportResult } from "./catalog-import";

export function googleDriveFileId(raw: string): string | null {
  const url = raw.trim();
  const file = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (file) return file[1];
  const idParam = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return idParam[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) return url;
  return null;
}

export function googleDriveFolderId(raw: string): string | null {
  const m = raw.trim().match(/\/drive\/folders\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? null;
}

export function googleDriveDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export async function importFromGoogleDriveUrl(url: string): Promise<CatalogImportResult> {
  const folderId = googleDriveFolderId(url);
  if (folderId) {
    const listed = await listPublicFolderFileIds(folderId);
    const latest = listed[0];
    if (!latest) {
      return { products: [], errors: [{ row: 0, message: "в папке нет публичных csv/xlsx" }] };
    }
    return importDriveFile(latest);
  }
  const fileId = googleDriveFileId(url);
  if (!fileId) {
    return {
      products: [],
      errors: [{ row: 0, message: "нужна ссылка Google Drive на файл или папку" }],
    };
  }
  return importDriveFile(fileId);
}

async function importDriveFile(fileId: string): Promise<CatalogImportResult> {
  const res = await fetch(googleDriveDownloadUrl(fileId), {
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "FrogFlowConsultant/1.0" },
  });
  if (!res.ok) {
    return { products: [], errors: [{ row: 0, message: `Drive ответил ${res.status}` }] };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x50 && buf[1] === 0x4b) return parseCatalogXlsx(buf);
  const text = new TextDecoder("utf-8").decode(buf);
  return parseCatalogCsv(text);
}

/** Публичная папка: вытаскиваем id файлов из HTML. */
async function listPublicFolderFileIds(folderId: string): Promise<string[]> {
  const res = await fetch(`https://drive.google.com/drive/folders/${folderId}`, {
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "FrogFlowConsultant/1.0", accept: "text/html" },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const ids = [...html.matchAll(/\/file\/d\/([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
  return [...new Set(ids)];
}
