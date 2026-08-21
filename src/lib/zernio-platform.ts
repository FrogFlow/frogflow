/**
 * Словарь каналов Zernio — отдельным модулем, а не внутри `zernio.server.ts`.
 *
 * Тип и предикат нужны и серверному слою, и разбору входящих сообщений
 * (`zernio-message.ts`), который намеренно сделан не-серверным: он чистый, без
 * побочных действий, и покрыт тестом на настоящей форме события. Если бы
 * предикат жил в `zernio.server.ts`, этот файл пришлось бы импортировать
 * оттуда значение, а не тип, — и серверный модуль поехал бы туда, где его быть
 * не должно.
 */

/**
 * Каналы, под которые в репозитории есть рантайм.
 *
 * У Zernio платформа — произвольная строка, и аккаунтов он поддерживает куда
 * больше (facebook, tiktok, x…). Здесь перечислено только то, что мы умеем
 * обслуживать: всё остальное отбивается на входе вебхука, а не доезжает до
 * магазина в виде «платформа есть, обработчика нет».
 */
export type ZernioPlatform = "instagram" | "whatsapp";

export const ZERNIO_PLATFORMS: ZernioPlatform[] = ["instagram", "whatsapp"];

export function isZernioPlatform(value: string | undefined | null): value is ZernioPlatform {
  return value === "instagram" || value === "whatsapp";
}

/** Префикс ключа покупателя в `bot_users` по каналу. */
export const USER_KEY_PREFIX: Record<ZernioPlatform, string> = {
  instagram: "ig_",
  whatsapp: "wa_",
};

/** Название канала для текстов, которые читает продавец. */
export const PLATFORM_LABEL: Record<ZernioPlatform, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};
