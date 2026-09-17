/**
 * Текст из файла базы знаний. Продавец присылает описания коллекций так, как
 * их даёт фабрика — PDF и Word, — а форму принимал только .txt/.md, и файлы
 * приходилось перенабирать руками.
 *
 * Разбор идёт на сервере: unpdf и mammoth — серверные библиотеки, тянуть их
 * в браузерный бандл ради загрузки одного файла незачем.
 */

/**
 * Предел на файл. Тело запроса serverless-функции ограничено ~4.5 МБ, а
 * base64 раздувает файл примерно на треть — 3 МБ проходят с запасом.
 */
export const KNOWLEDGE_FILE_MAX_MB = 3;

/**
 * Предел на статью. Вся база знаний уходит в системный промпт при КАЖДОМ
 * сообщении (formatKnowledgeForPrompt), поэтому каталог на сотню страниц,
 * загруженный целиком, платно и медленно перечитывался бы в каждом ответе.
 */
export const KNOWLEDGE_ARTICLE_MAX_CHARS = 20_000;

export function decodeBase64(b64: string): Uint8Array {
  const raw = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  return Uint8Array.from(Buffer.from(raw, "base64"));
}

function isPdf(bytes: Uint8Array, fileName: string): boolean {
  if (/\.pdf$/i.test(fileName)) return true;
  // %PDF
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function isDocx(bytes: Uint8Array, fileName: string): boolean {
  if (/\.docx$/i.test(fileName)) return true;
  // PK.. — zip-контейнер, в котором лежит docx
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export type DocumentTextResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function extractDocumentText(
  bytes: Uint8Array,
  fileName: string,
): Promise<DocumentTextResult> {
  if (bytes.length === 0) return { ok: false, error: "Файл пустой." };

  if (isPdf(bytes, fileName)) {
    try {
      const { extractText } = await import("unpdf");
      const { text } = await extractText(bytes, { mergePages: true });
      const trimmed = text.trim();
      if (!trimmed) {
        return {
          ok: false,
          error:
            "В этом PDF нет текстового слоя — похоже, это скан. Пришлите PDF, из которого текст можно выделить мышью, или вставьте текст через «Импорт текстом».",
        };
      }
      return { ok: true, text: trimmed };
    } catch (err: unknown) {
      console.warn("[consultant] не удалось разобрать PDF базы знаний", err);
      return { ok: false, error: "Не удалось прочитать PDF." };
    }
  }

  if (isDocx(bytes, fileName)) {
    try {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({
        arrayBuffer: bytes.slice().buffer as ArrayBuffer,
      });
      const trimmed = value.trim();
      if (!trimmed) return { ok: false, error: "В документе Word не нашлось текста." };
      return { ok: true, text: trimmed };
    } catch (err: unknown) {
      console.warn("[consultant] не удалось разобрать DOCX базы знаний", err);
      return { ok: false, error: "Не удалось прочитать документ Word." };
    }
  }

  const text = new TextDecoder("utf-8").decode(bytes).trim();
  if (!text) return { ok: false, error: "Файл пустой." };
  return { ok: true, text };
}

/** Есть ли в тексте разделители статей — от этого зависит, чем назвать статью. */
export function hasSectionMarkers(text: string): boolean {
  return /(?:^|\n)\s*(?:---+|###+|##+)/.test(text);
}

/** Имя файла без расширения — заголовок статьи, когда разделителей в файле нет. */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  return base || "Документ";
}
