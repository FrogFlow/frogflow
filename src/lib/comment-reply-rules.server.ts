/**
 * Хранение и исполнение правил «ответить на комментарий, в Direct не писать».
 *
 * Правила лежат в app_settings одним JSON: своей таблицы они не стоят, их
 * единицы, а миграция на живой базе — отдельная операция с отдельным риском.
 * Отвеченные комментарии помним там же ограниченным списком: это защита от
 * повторного ответа, а не журнал.
 */
import {
  pickReplyText,
  pickRuleForComment,
  validateRule,
  type CommentReplyRule,
} from "./comment-reply-rules";

const RULES_KEY = "comment_reply_rules";
const ANSWERED_KEY = "comment_reply_answered";
/** Сколько отвеченных комментариев помним. Больше и не нужно: повторные
 * события приходят в пределах минут, а не дней. */
const ANSWERED_LIMIT = 300;

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const s = await db();
    const { data } = await s.from("app_settings").select("value").eq("key", key).maybeSingle();
    if (!data?.value) return fallback;
    const parsed = JSON.parse(data.value) as unknown;
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  const s = await db();
  // Тот же случай, что в tasks.ts и store-info.ts: ON CONFLICT (key) не
  // совпадает с первичным ключом (bot_id, key), и ошибку нельзя глотать.
  const { error } = await s
    .from("app_settings")
    .upsert({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() });
  if (error) throw new Error(`Не удалось сохранить «${key}»: ${error.message}`);
}

export async function loadCommentReplyRules(): Promise<CommentReplyRule[]> {
  return readJson<CommentReplyRule[]>(RULES_KEY, []);
}

export async function saveCommentReplyRule(
  input: Omit<CommentReplyRule, "id" | "createdAt"> & { id?: string },
): Promise<CommentReplyRule> {
  const problem = validateRule(input);
  if (problem) throw new Error(problem);
  const list = await loadCommentReplyRules();
  const rule: CommentReplyRule = {
    id: input.id || `crr_${Date.now().toString(36)}`,
    createdAt: list.find((r) => r.id === input.id)?.createdAt ?? new Date().toISOString(),
    name: input.name.trim(),
    keywords: input.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean),
    matchMode: input.matchMode,
    platformPostId: input.platformPostId?.trim() || null,
    replies: input.replies.map((t) => t.trim()).filter(Boolean),
    isActive: input.isActive,
  };
  const next = list.some((r) => r.id === rule.id)
    ? list.map((r) => (r.id === rule.id ? rule : r))
    : [...list, rule];
  await writeJson(RULES_KEY, next);
  return rule;
}

export async function deleteCommentReplyRule(id: string): Promise<void> {
  const list = await loadCommentReplyRules();
  await writeJson(RULES_KEY, list.filter((r) => r.id !== id));
}

type Answered = { commentId: string; ruleId: string; at: string };

async function loadAnswered(): Promise<Answered[]> {
  return readJson<Answered[]>(ANSWERED_KEY, []);
}

/**
 * Ответить на комментарий по правилам продавца.
 *
 * Возвращает, что именно произошло — этим пользуется и вебхук, и кнопка
 * проверки в панели: «сработало» без подробностей уже один раз стоило нам
 * дня на поиск того, что уведомления не доходят.
 */
export async function replyToCommentByRules(payload: {
  accountId?: string | null;
  commentId?: string | null;
  commentText?: string | null;
  platformPostId?: string | null;
  postId?: string | null;
  authorUsername?: string | null;
  accountUsername?: string | null;
}): Promise<{ status: "sent" | "no_rule" | "already" | "skipped" | "failed"; error?: string; ruleId?: string }> {
  const accountId = payload.accountId?.trim();
  const commentId = payload.commentId?.trim();
  const text = payload.commentText?.trim() ?? "";
  if (!accountId || !commentId || !text) return { status: "skipped" };

  // На свои же комментарии магазин не отвечает.
  const author = payload.authorUsername?.trim().toLowerCase();
  const own = payload.accountUsername?.trim().toLowerCase();
  if (author && own && author === own) return { status: "skipped" };

  const rules = await loadCommentReplyRules();
  if (rules.length === 0) return { status: "no_rule" };

  const rule = pickRuleForComment(rules, text, payload.platformPostId);
  if (!rule) return { status: "no_rule" };

  const answered = await loadAnswered();
  if (answered.some((a) => a.commentId === commentId)) return { status: "already", ruleId: rule.id };

  const sentBefore = answered.filter((a) => a.ruleId === rule.id).length;
  const message = pickReplyText(rule, sentBefore);
  if (!message) return { status: "skipped", ruleId: rule.id };

  const { postCommentReply } = await import("./zernio.server");
  const postId = (payload.platformPostId || payload.postId || "").trim();
  if (!postId) return { status: "skipped", ruleId: rule.id };
  const res = await postCommentReply(postId, commentId, accountId, message);
  if (!res.ok) return { status: "failed", error: res.error, ruleId: rule.id };

  // Отмечаем только после успешной отправки: иначе сбой сети съел бы
  // единственную попытку ответить.
  try {
    await writeJson(
      ANSWERED_KEY,
      [...answered, { commentId, ruleId: rule.id, at: new Date().toISOString() }].slice(
        -ANSWERED_LIMIT,
      ),
    );
  } catch (err) {
    console.warn("[comment-reply] ответ отправлен, но не отмечен", err);
  }
  return { status: "sent", ruleId: rule.id };
}
