/**
 * Текст ошибки для показа человеку — из `catch (e: unknown)`.
 *
 * `e instanceof Error ? e.message : String(e)` до этого повторялось почти
 * дословно в полусотне мест по всей админке и серверным хендлерам, каждый
 * раз с типом catch-переменной `any` вместо `unknown`. Ни клиентских, ни
 * серверных зависимостей — можно звать из любого файла.
 *
 * Ветки под instanceof Error добавлены по живой жалобе: вызов createServerFn
 * иногда отклоняется не настоящим Error, а обычным объектом (форма зависит от
 * того, где именно порвалась RPC-цепочка TanStack Start — сериализация
 * ошибки сервера, сетевой сбой на самом fetch и т.п.), и `String(e)` на
 * таком объекте даёт бесполезное "[object Object]" вместо текста ошибки.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const withFields = e as { message?: unknown; error?: unknown };
    if (typeof withFields.message === "string" && withFields.message) return withFields.message;
    if (typeof withFields.error === "string" && withFields.error) return withFields.error;
    try {
      return JSON.stringify(e);
    } catch {
      // JSON.stringify падает на циклических структурах — просто идём дальше к String(e).
    }
  }
  return String(e);
}
