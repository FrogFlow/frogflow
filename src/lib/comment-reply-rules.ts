/**
 * Автоответы на комментарии БЕЗ отправки в Direct.
 *
 * Автоматизации Zernio устроены как Comment-to-DM: публичный ответ там —
 * добавка к сообщению в личку, а само сообщение обязательно (dmMessage в типе
 * не необязательный, и наша проверка отказывает при пустом). Клиенту нужен
 * урезанный режим: на комментарий отвечаем публично и в Direct не пишем
 * вообще — ни разрешения не спрашиваем, ни лимиты Meta на переписку не тратим.
 *
 * Поэтому такие правила живут у нас, а не в Zernio, и срабатывают на событие
 * comment.received, а не по опросу: комментарий, на который ответили через
 * пятнадцать минут, отвечать уже поздно.
 *
 * Здесь только чистая логика — сопоставление и выбор текста. Работа с сетью и
 * базой лежит в comment-reply-rules.server.ts, как и в comment-dm-fallback.
 */
export type CommentReplyRule = {
  id: string;
  name: string;
  /** Пусто — правило срабатывает на любой комментарий. */
  keywords: string[];
  matchMode: "exact" | "contains";
  /** Пусто — правило на все посты аккаунта. */
  platformPostId?: string | null;
  /** Варианты ответа: чередуются, чтобы Instagram не счёл это спамом. */
  replies: string[];
  isActive: boolean;
  createdAt: string;
};

/** Предел длины публичного ответа в Instagram. */
export const COMMENT_REPLY_MAX_CHARS = 2200;

/**
 * Совпадение по ключевым словам — та же семантика, что у автоматизаций
 * Zernio: пустой список означает «любой комментарий», exact сверяет строку
 * целиком, contains ищет вхождение.
 */
export function ruleMatchesComment(rule: CommentReplyRule, text: string): boolean {
  if (!rule.isActive) return false;
  const normalized = (text ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (rule.keywords.length === 0) return true;
  return rule.keywords.some((kw) => {
    const k = kw.trim().toLowerCase();
    if (!k) return false;
    return rule.matchMode === "exact" ? normalized === k : normalized.includes(k);
  });
}

/** Правило поста важнее правила «на все посты»: частное бьёт общее. */
export function pickRuleForComment(
  rules: CommentReplyRule[],
  text: string,
  platformPostId?: string | null,
): CommentReplyRule | null {
  const matching = rules.filter((r) => ruleMatchesComment(r, text));
  if (matching.length === 0) return null;
  const post = (platformPostId ?? "").trim();
  const forThisPost = post
    ? matching.filter((r) => (r.platformPostId ?? "").trim() === post)
    : [];
  const forAllPosts = matching.filter((r) => !(r.platformPostId ?? "").trim());
  return forThisPost[0] ?? forAllPosts[0] ?? null;
}

/**
 * Какой из вариантов ответа взять. Instagram давит одинаковые ответы подряд,
 * поэтому варианты перебираются по кругу — счётчик считаем от числа уже
 * отправленных ответов этого правила.
 */
export function pickReplyText(rule: CommentReplyRule, sentCount: number): string | null {
  const texts = rule.replies.map((t) => t.trim()).filter(Boolean);
  if (texts.length === 0) return null;
  const index = Math.abs(Math.floor(sentCount)) % texts.length;
  return texts[index];
}

/** Что мешает сохранить правило — на языке продавца, а не валидатора. */
export function validateRule(rule: Partial<CommentReplyRule>): string | null {
  if (!rule.name?.trim()) return "Дайте правилу название — по нему его будет видно в списке.";
  const texts = (rule.replies ?? []).map((t) => t.trim()).filter(Boolean);
  if (texts.length === 0) return "Нужен хотя бы один текст ответа.";
  const tooLong = texts.find((t) => t.length > COMMENT_REPLY_MAX_CHARS);
  if (tooLong) return `Ответ длиннее ${COMMENT_REPLY_MAX_CHARS} символов — Instagram его не примет.`;
  return null;
}
