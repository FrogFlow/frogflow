/**
 * Текст ошибки для показа человеку — из `catch (e: unknown)`.
 *
 * `e instanceof Error ? e.message : String(e)` до этого повторялось почти
 * дословно в полусотне мест по всей админке и серверным хендлерам, каждый
 * раз с типом catch-переменной `any` вместо `unknown`. Ни клиентских, ни
 * серверных зависимостей — можно звать из любого файла.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
