/**
 * Storage-бакеты (product-files, payment-proofs, broadcast-images,
 * instagram-media) общие на все шесть деплоев — Supabase Storage не
 * проходит через RLS, изоляция там держится на разметке ключей, а не на
 * политике базы (см. client.server.ts). Начиная с этой правки новые ключи
 * этих бакетов пишутся с префиксом `${BOT_ID}/...` — эта функция сверяет
 * префикс с BOT_ID текущего деплоя.
 *
 * Ключи без префикса — файлы, залитые до этой правки, — пропускаются: иначе
 * разом отвалились бы все уже отправленные заказы, чеки и рассылки. Так
 * изоляция закрывается для всего нового, не ломая то, что уже выдано.
 */
const UUID_PREFIX = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

export function isOwnTenantStorageKey(key: string): boolean {
  const m = key.match(UUID_PREFIX);
  if (!m) return true;
  const botId = process.env.BOT_ID?.trim().toLowerCase();
  return Boolean(botId) && m[1].toLowerCase() === botId;
}
