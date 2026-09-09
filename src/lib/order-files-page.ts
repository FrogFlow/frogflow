import { createHmac, timingSafeEqual } from "node:crypto";

/** Сколько дней живёт страница выдачи (как ссылки в письме). */
export const ORDER_FILES_LINK_DAYS = 7;

/** Instagram режет title кнопки до 20 символов. */
export function instagramFilesButtonTitle(fileCount: number): string {
  return fileCount === 1 ? "Получить файл" : "Получить файлы";
}

export function mintOrderFilesToken(
  orderId: number,
  secret: string,
  nowMs = Date.now(),
  days = ORDER_FILES_LINK_DAYS,
): string {
  const exp = Math.floor(nowMs / 1000) + days * 24 * 60 * 60;
  const payload = `${orderId}-${exp}`;
  return `${payload}-${signOrderFilesPayload(payload, secret)}`;
}

export function parseOrderFilesToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): { ok: true; orderId: number } | { ok: false; reason: "invalid" | "expired" } {
  const match = String(token || "")
    .trim()
    .match(/^(\d+)-(\d+)-([0-9a-f]{64})$/);
  if (!match) return { ok: false, reason: "invalid" };
  const orderId = Number(match[1]);
  const exp = Number(match[2]);
  const sig = match[3];
  if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isInteger(exp) || exp <= 0) {
    return { ok: false, reason: "invalid" };
  }
  const expected = signOrderFilesPayload(`${orderId}-${exp}`, secret);
  if (!hexEqual(sig, expected)) return { ok: false, reason: "invalid" };
  if (Math.floor(nowMs / 1000) >= exp) return { ok: false, reason: "expired" };
  return { ok: true, orderId };
}

function signOrderFilesPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`order-files:v1:${payload}`).digest("hex");
}

function hexEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function escapeOrderFilesHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderOrderFilesPageHtml(params: {
  shopName: string;
  orderNo: number | string;
  files: Array<{ name: string; url: string }>;
  linkDays: number;
}): string {
  const { shopName, orderNo, files, linkDays } = params;
  const esc = escapeOrderFilesHtml;
  const heading = files.length === 1 ? "Ваш файл" : "Ваши файлы";
  const items = files
    .map(
      (file) =>
        `<li><a class="file" href="${esc(file.url)}" rel="noopener noreferrer">${esc(file.name)}</a></li>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${esc(heading)} — заказ №${esc(String(orderNo))}</title>
  <style>
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 28rem; margin: 1.5rem auto; padding: 0 1.25rem 3rem; line-height: 1.55; color: #1a1a1a; background: #f6f7f8; }
    h1 { font-size: 1.25rem; margin: 0 0 .35rem; }
    .sub { color: #5f6368; margin: 0 0 1.25rem; }
    ul { list-style: none; padding: 0; margin: 0; }
    .file { display: block; background: #fff; border: 1px solid #dadce0; border-radius: 12px; padding: .9rem 1rem; margin-bottom: .6rem; color: #0b57d0; text-decoration: none; font-weight: 600; }
    .hint { color: #5f6368; font-size: .92rem; margin-top: 1.25rem; }
  </style>
</head>
<body>
  <h1>${esc(heading)}</h1>
  <p class="sub">Заказ №${esc(String(orderNo))} · ${esc(shopName)}</p>
  <ul>${items}</ul>
  <p class="hint">Файлы не открываются сами — нажмите, когда будете готовы скачать. Ссылки действуют ${linkDays} дн.</p>
</body>
</html>`;
}

export function renderOrderFilesErrorHtml(title: string, message: string): string {
  const esc = escapeOrderFilesHtml;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${esc(title)}</title>
  <style>
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 28rem; margin: 1.5rem auto; padding: 0 1.25rem; line-height: 1.55; color: #1a1a1a; }
  </style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <p>${esc(message)}</p>
</body>
</html>`;
}
