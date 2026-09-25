/**
 * Фото от покупателя — модели v2, которая их видит (Haiku 4.5 понимает
 * картинки).
 *
 * В v1 любое фото сразу уходило менеджеру: бот его не видел и ответить было
 * нечем. Теперь снимок скачивается здесь и идёт модели вместе с текстом:
 * она понимает, что на нём (полотенце, подушка, цвет, узор), ищет похожее в
 * прайсе и отвечает сама. Скачиваем сами, а не отдаём ссылку: ссылки на фото
 * из директа подписанные и живут недолго, а ссылка Telegram содержит токен
 * бота — её нельзя отдавать наружу.
 */

export type V2Image = {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
};

/** Предел API на картинку — 5 МБ; фото из директа обычно меньше мегабайта. */
const MAX_IMAGE_BYTES = 4_500_000;
const FETCH_TIMEOUT_MS = 8_000;
export const MAX_IMAGES_PER_TURN = 3;

/** Тип по первым байтам файла: заголовку ответа верить нельзя. */
function sniffMediaType(bytes: Uint8Array): V2Image["mediaType"] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function imageFromBytes(bytes: Uint8Array): V2Image | null {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  const mediaType = sniffMediaType(bytes);
  if (!mediaType) return null;
  return { mediaType, data: Buffer.from(bytes).toString("base64") };
}

export async function fetchImage(url: string): Promise<V2Image | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_IMAGE_BYTES) return null;
    return imageFromBytes(new Uint8Array(await res.arrayBuffer()));
  } catch (err) {
    console.warn(
      "[consultant-v2] фото покупателя не скачалось",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

type IncomingAttachment = { type?: string; url?: string; payload?: unknown };

/**
 * Ссылки на фото покупателя в сообщении из директа. Публикация (сторис, рилс,
 * пост) — не фото покупателя: её товары приходят отметкой. Гифка из стикеров —
 * реакция, а не снимок.
 */
export function incomingImageUrls(
  attachments: IncomingAttachment[] | undefined,
  isPublication: (
    type: string,
    url: string | null | undefined,
    payload: Record<string, unknown>,
  ) => boolean,
): string[] {
  const urls: string[] = [];
  for (const a of attachments ?? []) {
    const type = String(a.type ?? "").toLowerCase();
    const payload = (a.payload && typeof a.payload === "object" ? a.payload : {}) as Record<
      string,
      unknown
    >;
    const url =
      typeof a.url === "string" && a.url
        ? a.url
        : typeof payload.url === "string"
          ? payload.url
          : "";
    if (type !== "image" || !url || /giphy\.com/i.test(url)) continue;
    if (isPublication(type, url, payload)) continue;
    urls.push(url);
  }
  return urls.slice(0, MAX_IMAGES_PER_TURN);
}
