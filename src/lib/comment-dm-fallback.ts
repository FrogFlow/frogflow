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
 * Штатный ответ у Zernio уходит в пределах минуты, так что 5 минут — уже
 * щедрый запас, а не гонка со штатным путём: без паузы вовсе каждый новый
 * комментарий немедленно дублировался бы нашей же резервной отправкой ещё
 * до того, как штатный путь успел отработать.
 */
export const FALLBACK_MIN_AGE_MS = 5 * 60 * 1000;

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

/**
 * Статус комментария относительно правила Comment-to-DM — общий для
 * автоматического крона (comment-dm-fallback.server.ts) и ручной догоняющей
 * рассылки в панели (instagram.functions.ts: listPostCommentsFn). Раньше
 * панель просто выгружала ВСЕ комментарии поста без разбора — оператор видел
 * 25 комментариев без единой подсказки, кому из них правило уже ответило,
 * кому не должно было (не то ключевое слово), а кому должно было, но
 * почему-то не ответило. Эта функция и есть та подсказка.
 */
export type CommentReplyStatus =
  | "owner" // комментарий самого аккаунта (наш же публичный ответ) — не адресат
  | "sent" // Zernio отправил DM, есть запись в логах правила
  | "failed" // Zernio пытался отправить DM и не смог (см. логи правила)
  | "no_match" // под пост есть активное правило, но ключевые слова не совпали
  | "no_automation" // под этим постом вообще нет активного per-post правила
  | "missing"; // подходит под правило, но ни sent, ни failed в логах — похоже, пропущено

export function annotateCommentStatus(
  comment: { id?: string; message?: string; from?: { isOwner?: boolean } },
  automation: { keywords: string[]; matchMode?: "exact" | "contains" } | null,
  sentCommentIds: Set<string>,
  failedCommentIds: Set<string>,
): CommentReplyStatus {
  if (comment.from?.isOwner) return "owner";
  const id = comment.id ?? "";
  if (id && sentCommentIds.has(id)) return "sent";
  if (!automation) return "no_automation";
  if (!commentMatchesAutomation(comment.message ?? "", automation.keywords, automation.matchMode)) {
    return "no_match";
  }
  if (id && failedCommentIds.has(id)) return "failed";
  return "missing";
}

/**
 * Почему Instagram отклонит private-reply ещё до вызова.
 *
 * 2534066 от Meta звучит как «проверьте права токена», но на живом аккаунте
 * (другие посты продолжают получать штатный Comment-to-DM) это почти всегда
 * невалидный для private-reply комментарий: ответ в ветке, старше 7 дней,
 * или Instagram сам помечает canReply=false. Не тратим на них ни ручную
 * рассылку, ни слоты fallback-крона.
 */
export type PrivateReplyBlockReason = "nested" | "too_old" | "cannot_reply";

export function commentPrivateReplyBlockReason(
  comment: { parentId?: string | null; createdTime?: string; canReply?: boolean },
  now: Date,
): PrivateReplyBlockReason | null {
  if (comment.parentId) return "nested";
  if (comment.canReply === false) return "cannot_reply";
  if (commentAgeVerdict(comment.createdTime ?? "", now) === "too_old") return "too_old";
  return null;
}

/**
 * Переводит сырой отказ Zernio/Meta по private-reply в текст, который можно
 * показать оператору. По доке Zernio публичный ответ и private reply — разные
 * вызовы и разные скоупы Instagram Login. Живой тест Educational (сент. 2026):
 * публичный ответ на тот же comment ID ушёл, DM поймал 2534066.
 */
export function explainInstagramPrivateReplyError(raw: string): string {
  const text = raw.toLowerCase();
  if (
    text.includes("2534066") ||
    text.includes("granular scopes") ||
    text.includes("comment id is valid")
  ) {
    return (
      "Instagram отклонил именно private reply / первый DM (код 2534066). " +
      "По доке Zernio это другой вызов, чем ответ в комментариях: " +
      "POST /inbox/comments/{postId}/{commentId}/private-reply и скоуп " +
      "instagram_business_manage_messages. Публичный ответ идёт через " +
      "POST /inbox/comments/{postId} и скоуп instagram_business_manage_comments — " +
      "если он уже ушёл, comment ID живой, дело не в «не том посте» и не в возрасте. " +
      "Холодный DM этим методом Instagram не принимает. Напишите в уже открытый чат " +
      "или переподключите Instagram в Zernio, не снимая галку про сообщения. " +
      "Живые правила Comment-to-DM идут своим путём — поэтому на других постах DM ещё приходят."
    );
  }
  if (text.includes("2534025") || text.includes("older than") || /\b7\s*day/.test(text)) {
    return "Instagram не принимает приватный ответ: комментарию больше 7 дней.";
  }
  if (
    text.includes("2534023") ||
    text.includes("privatereplyconsumed") ||
    text.includes("already sent a private reply")
  ) {
    return "На этот комментарий приватный ответ уже уходил — Instagram даёт только один.";
  }
  if (text.includes("1545133")) {
    return (
      "Instagram с конца августа 2026 не принимает кнопки и вложения в первом DM тем, " +
      "кто не подписан. Отправьте голый текст без кнопки."
    );
  }
  return raw;
}
