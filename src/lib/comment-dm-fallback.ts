/**
 * Резервная (fallback) отправка DM по комментарию — второй путь на случай,
 * если родное Comment-to-DM автоматизации Zernio перестало срабатывать на
 * конкретном посте (см. историю инцидента: правило успешно отвечало сотни
 * раз, потом молча замолкало на одном посте, при этом остальные правила
 * того же аккаунта и сторонний инструмент клиента продолжали получать те же
 * комментарии — обрыв не в Instagram, а в самой доставке срабатывания у
 * Zernio для этого поста).
 *
 * Чистая логика без обращений к сети/БД — параллель analytics.ts/…functions.ts:
 * тестируется без моков, орестрация (Zernio API + comment_dm_fallback_sends)
 * живёт в comment-dm-fallback.server.ts.
 */

/**
 * Совпадает ли комментарий с ключевыми словами правила — повторяет семантику
 * Zernio (см. документацию create-автоматизации: "keywords: empty = any
 * comment triggers", "matchMode: exact, contains"). Точный алгоритм
 * сопоставления Zernio нигде не документирован детальнее этих двух слов —
 * это лучшее воспроизведение по названию режимов, а не подтверждённая копия.
 */
export function commentMatchesAutomation(
  text: string,
  keywords: string[] | undefined,
  matchMode: "exact" | "contains" | undefined,
): boolean {
  if (!keywords || keywords.length === 0) return true;
  const normalized = text.trim().toLowerCase();
  return keywords.some((kw) => {
    const k = kw.trim().toLowerCase();
    if (!k) return false;
    return matchMode === "exact" ? normalized === k : normalized.includes(k);
  });
}

/**
 * Не пытаемся раньше этого возраста — даём Zernio шанс сработать первым.
 * Без этой паузы каждый новый комментарий немедленно дублировался бы нашей
 * же резервной отправкой ещё до того, как штатный путь успел отработать.
 */
export const FALLBACK_MIN_AGE_MS = 20 * 60 * 1000;

/**
 * С запасом от документированного 7-дневного окна private-reply у Zernio —
 * дальше этого возраста попытка гарантированно вернёт PLATFORM_LIMITATION,
 * пробовать нет смысла.
 */
export const FALLBACK_MAX_AGE_MS = 6.5 * 24 * 60 * 60 * 1000;

export type CommentAgeVerdict = "too_new" | "too_old" | "eligible";

export function commentAgeVerdict(createdTimeIso: string, now: Date): CommentAgeVerdict {
  const created = new Date(createdTimeIso).getTime();
  if (Number.isNaN(created)) return "too_old"; // дате доверять нельзя — не отправляем вслепую
  const age = now.getTime() - created;
  if (age < FALLBACK_MIN_AGE_MS) return "too_new";
  if (age > FALLBACK_MAX_AGE_MS) return "too_old";
  return "eligible";
}
