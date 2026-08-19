import { timingSafeEqual } from "node:crypto";

/**
 * Общая проверка CRON_SECRET для всех /api/cron/*, /api/operator-cron/* и
 * VIP-крона. Раньше эта функция была скопирована в шесть мест почти
 * дословно (`isAuthorized`/`isVipCronAuthorized`) — при следующем
 * исправлении (например, этом самом переходе на timingSafeEqual) правку
 * почти наверняка внесли бы не везде.
 *
 * Секрет принимается и в заголовке (Vercel-native cron всегда шлёт
 * `Authorization: Bearer …`), и в query-параметре `secret` — второй путь
 * сохранён ради внешнего cron-job.org на Hobby-плане (см. DEPLOYMENT.md);
 * он оседает в логах доступа, поэтому это осознанный компромисс, а не то,
 * что стоит расширять на новые эндпоинты.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  const expectedHeader = `Bearer ${secret}`;
  if (auth && auth.length === expectedHeader.length) {
    if (timingSafeEqual(Buffer.from(auth), Buffer.from(expectedHeader))) return true;
  }

  const provided = new URL(request.url).searchParams.get("secret");
  if (provided && provided.length === secret.length) {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  }
  return false;
}
