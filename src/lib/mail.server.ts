import nodemailer from "nodemailer";
import { logger, maskEmail } from "./logger.server";

/**
 * Отправка писем покупателям через SMTP обычного почтового ящика продавца
 * (Яндекс 360, Mail.ru для бизнеса и подобные).
 *
 * Почему это вообще понадобилось. Instagram Direct не принимает вложениями
 * документы — только картинки, видео и аудио. А продают тут PDF и ZIP.
 * Плюс окно в 24 часа: написать покупателю позже суток с его последнего
 * сообщения Instagram не даст, а подтверждение оплаты продавцом сплошь и
 * рядом приходится на следующее утро. Оба ограничения платформенные, кодом
 * не обходятся, и почта снимает их разом.
 *
 * Почему SMTP, а не сервис вроде Resend: ящик у продавца уже есть, письмо
 * приходит с адреса, который покупатель знает, и не нужны ни подтверждение
 * домена, ни зарубежная карта.
 *
 * Материалы уходят подписанными ссылками, а не вложениями: файлы бывают до
 * 100 МБ, и почта столько не примет — письмо просто отобьётся, причём уже
 * после того, как продавец нажал «Подтвердить».
 */

export type MailAttachmentLink = {
  name: string;
  url: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Не задана переменная окружения ${name} — без неё бот не сможет отправить материалы на почту.`,
    );
  }
  return value;
}

/** Настроена ли отправка. Позволяет заранее сказать оператору, что письма не уйдут. */
export function isMailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
    process.env.SMTP_USER?.trim() &&
    process.env.SMTP_PASSWORD?.trim(),
  );
}

function createTransport() {
  const host = requiredEnv("SMTP_HOST");
  const user = requiredEnv("SMTP_USER");
  const pass = requiredEnv("SMTP_PASSWORD");
  // 465 — SMTP поверх TLS сразу (Яндекс, Mail.ru); 587 — STARTTLS.
  const port = Number(process.env.SMTP_PORT) || 465;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/** Адрес отправителя: SMTP_FROM, иначе сам ящик — многие провайдеры чужой From отвергают. */
function fromAddress(): string {
  const from = process.env.SMTP_FROM?.trim();
  return from || requiredEnv("SMTP_USER");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Письмо с материалами заказа.
 *
 * Отправляется и текстом, и HTML: часть почтовых клиентов у покупателей —
 * мобильные приложения со своими причудами, и голый текст там надёжнее
 * всего, а ссылки всё равно останутся кликабельными.
 */
export async function sendOrderMaterialsEmail(params: {
  to: string;
  orderNo: number | string;
  shopName: string;
  files: MailAttachmentLink[];
  /** Сколько дней живут ссылки — чтобы сказать это покупателю честно. */
  linkDays: number;
}): Promise<{ ok: boolean; error?: string }> {
  const { to, orderNo, shopName, files, linkDays } = params;

  if (files.length === 0) {
    return { ok: false, error: "В заказе нет файлов для отправки." };
  }

  const subject = `Ваш заказ №${orderNo} — материалы внутри`;

  const textLines = [
    `Здравствуйте!`,
    ``,
    `Спасибо за покупку. Ваш заказ №${orderNo} подтверждён.`,
    ``,
    files.length === 1 ? `Материал доступен по ссылке:` : `Материалы доступны по ссылкам:`,
    ...files.map((file) => `• ${file.name}\n  ${file.url}`),
    ``,
    `Ссылки действуют ${linkDays} дней — пожалуйста, скачайте файлы на своё устройство.`,
    ``,
    `Если что-то не открывается, просто ответьте на это письмо.`,
    ``,
    shopName,
  ];

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a;">
      <p>Здравствуйте!</p>
      <p>Спасибо за покупку. Ваш заказ <strong>№${escapeHtml(String(orderNo))}</strong> подтверждён.</p>
      <p>${files.length === 1 ? "Материал доступен по ссылке:" : "Материалы доступны по ссылкам:"}</p>
      <ul style="padding-left: 18px;">
        ${files
          .map(
            (file) =>
              `<li style="margin-bottom: 8px;"><a href="${escapeHtml(file.url)}" style="color: #0b57d0;">${escapeHtml(file.name)}</a></li>`,
          )
          .join("")}
      </ul>
      <p style="color: #5f6368;">Ссылки действуют ${linkDays} дней — пожалуйста, скачайте файлы на своё устройство.</p>
      <p>Если что-то не открывается, просто ответьте на это письмо.</p>
      <p style="margin-top: 24px;">${escapeHtml(shopName)}</p>
    </div>
  `;

  try {
    const transport = createTransport();
    await transport.sendMail({
      from: fromAddress(),
      to,
      subject,
      text: textLines.join("\n"),
      html,
    });
    return { ok: true };
  } catch (e) {
    logger.error("mail.send_order_materials_failed", {
      to: maskEmail(to),
      order_no: orderNo,
      err: e,
    });
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось отправить письмо." };
  }
}
