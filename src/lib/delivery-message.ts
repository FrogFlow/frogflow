/**
 * Сообщение покупателю в Direct после подтверждения оплаты.
 *
 * Первые строки — факты нашей выдачи: номер заказа, адрес, срок жизни ссылок.
 * Их продавец не правит: ссылки действительно умирают через EMAIL_LINK_DAYS
 * дней, и обещание «тридцать дней» в тексте их не продлит.
 *
 * Приписка — дело продавца. Анастасия попросила добавить, что повторная
 * отправка платная; у остальных четырёх цифровых магазинов на том же коде
 * правила свои, и навязывать им чужую политику нельзя. Поэтому текст живёт в
 * app_settings (delivery_email_note) и редактируется в админке.
 */

export const DELIVERY_NOTE_KEY = "delivery_email_note";

export const DEFAULT_DELIVERY_NOTE = "Если письма нет — проверьте папку «Спам» и напишите сюда, поможем.";

export type DeliveryMessageInput = {
  displayNo: number | string;
  email: string;
  linkDays: number;
  /** Пусто — берётся текст по умолчанию. */
  note?: string | null;
  /** Есть — покупателю открывается страница файлов, письмо идёт дубликатом. */
  filesPageUrl?: string | null;
};

export function buildInstagramDeliveryText(input: DeliveryMessageInput): string {
  const note = (input.note ?? "").trim() || DEFAULT_DELIVERY_NOTE;
  const parts = input.filesPageUrl
    ? [
        `Оплата подтверждена — заказ №${input.displayNo}.`,
        "Нажмите кнопку: откроется страница с вашими файлами. Они не скачиваются сами — выберите, когда будете готовы.",
        `Дубликат отправили на ${input.email}. Ссылки в письме действуют ${input.linkDays} ДНЕЙ, поэтому лучше скачать файлы сразу.`,
        note,
      ]
    : [
        `Оплата подтверждена — материалы по заказу №${input.displayNo} отправлены на ${input.email}.`,
        `Ссылки в письме действуют ${input.linkDays} ДНЕЙ, поэтому лучше скачать файлы сразу.`,
        note,
      ];
  return parts.join("\n\n");
}
