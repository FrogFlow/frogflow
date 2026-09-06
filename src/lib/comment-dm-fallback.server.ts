import {
  commentMatchesAutomation,
  commentAgeVerdict,
  commentPrivateReplyBlockReason,
} from "./comment-dm-fallback";
import { tg } from "./telegram.server";
import { escapeHtml } from "./vip-bot.server";

/** Потолок правил за один проход крона — по числу их обычно не больше ~20-30 на аккаунт. */
const MAX_AUTOMATIONS_PER_RUN = 20;

/** Потолок реальных отправок за один проход — если сопоставление где-то ошиблось, не разослать лишнего разом; остаток подхватит следующий проход. */
const MAX_SENDS_PER_RUN = 15;

/** Сколько логов автоматизации проверять на "Zernio уже отправил" — с запасом на обычный объём срабатываний одного правила. */
const LOG_CHECK_LIMIT = 200;

/**
 * Сколько ждать, прежде чем считать зарезервированную (`pending`), но не
 * дошедшую до статуса `sent`/`failed` строку брошенной прошлым прогоном.
 *
 * Найдено на живых данных: 73 строки застряли в `pending` навсегда — прогон,
 * который их зарезервировал, оборвался (похоже, таймаут функции: у этого
 * крона не задан maxDuration, а эскалация теперь может делать до 4
 * последовательных сетевых вызовов на комментарий) до того, как записал
 * результат. Уникальный индекс (automation_id, comment_id) после этого
 * навсегда блокировал повтор — эти люди не получили бы ответ уже никогда.
 * 10 минут — с запасом выше времени одного прогона (крон каждые 15 минут,
 * см. vercel.json), но короче интервала между прогонами, так что зависшая
 * строка подхватывается уже следующим тиком.
 */
const STALE_PENDING_MS = 10 * 60 * 1000;

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

/**
 * Тот же паттерн, что notifyAdminsAboutDeliveryIssue в orders.server.ts —
 * написать продавцу в Telegram (admin_chat_id), когда ни один автоматический
 * путь не сработал и дальше есть только ручной ответ. Не общий импорт из
 * orders.server.ts намеренно: там функция не экспортирована, а дублировать
 * этот маленький хелпер — тот же приём, что и у db() в каждом *.server.ts.
 */
async function notifyAdminsCommentUnresolved(text: string): Promise<void> {
  const s = await db();
  const { data: setting } = await s
    .from("app_settings")
    .select("value")
    .eq("key", "admin_chat_id")
    .maybeSingle();

  const raw = setting?.value?.trim();
  if (!raw) return;

  for (const chatId of raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    try {
      await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
    } catch (e) {
      console.error("[comment-dm-fallback] notifyAdminsCommentUnresolved failed", e);
    }
  }
}

/**
 * Резервная (fallback) отправка DM по комментарию — второй путь на случай,
 * если родное Comment-to-DM автоматизации Zernio перестало срабатывать на
 * конкретном посте (см. MIGRATION-62 и comment-dm-fallback.ts).
 *
 * Раз в 15 минут (см. vercel.json) для каждого per-post правила сверяем
 * реальные комментарии поста (listInstagramComments) с логами срабатываний
 * этого правила (getCommentAutomationLogs): если комментарий подходит под
 * ключевые слова, но не отмечен как "sent" в логах — либо Zernio его вообще
 * не увидел, либо увидел и не смог отправить — шлём DM тем же
 * sendCommentPrivateReply, что и ручная догоняющая рассылка в панели,
 * тем же текстом/кнопками, что настроены в самом правиле.
 *
 * Если и наш private-reply не проходит — три уровня эскалации по нарастанию
 * риска (см. комментарий внутри цикла): 1) обычное inbox-сообщение в уже
 * существующий диалог с этим человеком, если он есть (другой вызов Zernio,
 * не привязан к comment ID); 2) публичный ответ (commentReply правила) —
 * только если шаг 1 реально доставил DM, иначе он рискует публично соврать
 * «мы написали вам в директ»; 3) сообщение продавцу в Telegram, если не
 * доставилось нигде. Сопоставление ключевых слов здесь — лучшее
 * воспроизведение чужого алгоритма Zernio, не гарантированная копия. Тот же
 * довод — почему это резервный путь, а не замена родному: подтверждённая
 * логика Zernio остаётся основной.
 *
 * Компромисс размена: если Zernio всё же ответит с опозданием ПОСЛЕ того,
 * как отработал наш fallback, человек получит два похожих DM вместо одного.
 * Это дешевле, чем повторение инцидента "почти сотня клиентов без ответа
 * несколько дней" — окно в 5 минут (FALLBACK_MIN_AGE_MS) снижает вероятность,
 * но не исключает её полностью.
 *
 * Учитываются только per-post правила (у которых задан platformPostId) —
 * правило "все посты" пришлось бы сверять со всеми постами аккаунта разом,
 * а именно точечная (per-post) подписка Zernio — то место, где мы наблюдали
 * тихий обрыв.
 */
export async function runCommentDmFallback(): Promise<{
  automationsChecked: number;
  commentsChecked: number;
  sent: number;
  failed: number;
}> {
  const { hasModule } = await import("./modules/modules.server");
  if (!(await hasModule("instagram"))) {
    return { automationsChecked: 0, commentsChecked: 0, sent: 0, failed: 0 };
  }

  const {
    listCommentAutomations,
    listInstagramComments,
    getCommentAutomationLogs,
    sendCommentPrivateReply,
    postCommentReply,
    sendZernioInboxMessage,
  } = await import("./zernio.server");

  const { automations } = await listCommentAutomations();
  const perPost = automations
    .filter((a) => a.isActive !== false && a.trigger !== "story_reply" && a.platformPostId)
    .slice(0, MAX_AUTOMATIONS_PER_RUN);

  const s = await db();
  const botId = process.env.BOT_ID!.trim();
  const now = new Date();

  let commentsChecked = 0;
  let sent = 0;
  let failed = 0;
  let sendsThisRun = 0;

  for (const automation of perPost) {
    const automationId = String(automation.id || automation._id || "");
    const postId = automation.platformPostId;
    if (!automationId || !postId) continue;

    try {
      const [{ comments }, { logs }] = await Promise.all([
        listInstagramComments(postId, automation.accountId),
        getCommentAutomationLogs(automationId, { limit: LOG_CHECK_LIMIT }),
      ]);

      const sentByZernio = new Set(
        logs
          .filter((row) => String(row.status ?? "") === "sent")
          .map((row) => String(row.commentId ?? "")),
      );
      // По доке Zernio: commentReplyStatus "skipped", если публичный ответ не
      // настроен ИЛИ если DM не прошёл — то есть ровно та эскалация, которую
      // мы сейчас достраиваем, у Zernio своей нет вовсе. Проверяем только
      // "sent", чтобы не постить дубликат публичного ответа, если Zernio его
      // всё же отправил (skipped/failed для нас не повод молчать).
      const commentReplySentByZernio = new Set(
        logs
          .filter((row) => String(row.commentReplyStatus ?? "") === "sent")
          .map((row) => String(row.commentId ?? "")),
      );

      for (const comment of comments) {
        const commentId = comment.id;
        if (!commentId || comment.from?.isOwner) continue;
        commentsChecked++;

        if (sentByZernio.has(commentId)) continue; // штатно отработало
        if (
          !commentMatchesAutomation(
            comment.message ?? "",
            automation.keywords,
            automation.matchMode,
          )
        ) {
          continue;
        }

        const verdict = commentAgeVerdict(comment.createdTime ?? "", now);
        if (verdict !== "eligible") continue; // "too_new" — дать Zernio шанс; "too_old" — вне 7-дневного окна
        // 2534066 на вложенных / canReply=false сжигал все 15 слотов прохода
        // на одном посте, и остальные правила в этом тике не проверялись.
        if (commentPrivateReplyBlockReason(comment, now)) continue;

        if (sendsThisRun >= MAX_SENDS_PER_RUN) continue; // остальное — в следующий проход через 15 минут

        // Резервируем строку ДО отправки: уникальный индекс (automation_id,
        // comment_id) — единственная защита от повторной отправки при гонке
        // или перекрытии двух проходов крона, а не отметка постфактум.
        const { error: reserveError } = await s.from("comment_dm_fallback_sends").insert({
          bot_id: botId,
          automation_id: automationId,
          platform_post_id: postId,
          comment_id: commentId,
          status: "pending",
        });
        if (reserveError) {
          // Уже зарезервировано — либо другим (свежим) проходом, либо прошлым
          // прогоном, который оборвался, не дописав результат. Отличаем одно
          // от другого по возрасту: свежий pending оставляем как есть (не
          // лезем в гонку с ещё выполняющимся прогоном), а брошенный старше
          // STALE_PENDING_MS — забираем себе и пробуем реально отправить,
          // а не молчим о нём вечно.
          const { data: existing } = await s
            .from("comment_dm_fallback_sends")
            .select("status, updated_at")
            .eq("automation_id", automationId)
            .eq("comment_id", commentId)
            .maybeSingle();
          const isStalePending =
            existing?.status === "pending" &&
            now.getTime() - new Date(existing.updated_at).getTime() > STALE_PENDING_MS;
          if (!isStalePending) continue;

          // .update() над несуществующей строкой "успешен" и без единой
          // затронутой строки — ошибку тут не проверить, нужен именно
          // вернувшийся набор: пусто — кто-то другой забрал эту же строку
          // между select и update прямо сейчас, отступаем.
          const { data: takeover } = await s
            .from("comment_dm_fallback_sends")
            .update({ updated_at: now.toISOString() })
            .eq("automation_id", automationId)
            .eq("comment_id", commentId)
            .eq("status", "pending")
            .lt("updated_at", new Date(now.getTime() - STALE_PENDING_MS).toISOString())
            .select("id");
          if (!takeover?.length) continue;
        }

        sendsThisRun++;
        const result = await sendCommentPrivateReply(
          postId,
          commentId,
          automation.accountId,
          automation.dmMessage,
          automation.buttons ?? [],
        );
        if (result.ok) sent++;
        else failed++;

        // Эскалация — только если наш собственный private-reply тоже не
        // прошёл (второй провал: родная автоматизация Zernio + наш резерв).
        //
        // 1. Альтернативный канал: у комментатора может уже быть диалог с
        //    этим аккаунтом (bot_users по ig_<id>) — тогда то же сообщение
        //    уходит обычным inbox-сообщением в существующий диалог, а не
        //    через комментарий-специфичный private-reply. Другой вызов
        //    Zernio, не привязанный к comment ID вообще — не наследует то,
        //    из-за чего падает именно private-reply к этому комментарию.
        // 2. Публичный ответ (commentReply правила) — ТОЛЬКО если альт-канал
        //    реально доставил DM: у commentReply часто в тексте что-то вроде
        //    «мы написали вам в директ», и постить это на живом посте, когда
        //    ни один DM в реальности не ушёл — публично вводить в заблуждение,
        //    а это необратимее случайного лишнего DM.
        // 3. Ничего не доставилось нигде — автоматически сделать больше
        //    нечего, зовём продавца в Telegram.
        let altChannelStatus: "skipped" | "sent" | "failed" = "skipped";
        let altChannelError: string | null = null;
        if (!result.ok) {
          const commenterId = comment.from?.id;
          if (commenterId) {
            const { data: buyer } = await s
              .from("bot_users")
              .select("zernio_conversation_id")
              .eq("user_key", `ig_${commenterId}`)
              .maybeSingle();
            if (buyer?.zernio_conversation_id) {
              const altResult = await sendZernioInboxMessage(
                buyer.zernio_conversation_id,
                automation.accountId,
                automation.dmMessage,
                { buttons: automation.buttons ?? [] },
              );
              if (altResult.ok) {
                altChannelStatus = "sent";
              } else {
                // Обычное сообщение отказало — вероятная причина: 24-часовое
                // окно с этим человеком уже закрылось (см. живой тест: то же
                // сообщение прошло только пока покупатель писал в последние
                // сутки). HUMAN_AGENT — единственный документированный у
                // Zernio способ Instagram послать сообщение вне этого окна
                // без comment-триггера private-reply. По политике Meta он для
                // живого агента, отвечающего уже известному контакту — ровно
                // наш случай (эскалация к реальному человеку в диалоге,
                // который уже существует), не массовая рассылка.
                const tagResult = await sendZernioInboxMessage(
                  buyer.zernio_conversation_id,
                  automation.accountId,
                  automation.dmMessage,
                  {
                    buttons: automation.buttons ?? [],
                    messagingType: "MESSAGE_TAG",
                    messageTag: "HUMAN_AGENT",
                  },
                );
                altChannelStatus = tagResult.ok ? "sent" : "failed";
                altChannelError = tagResult.ok
                  ? null
                  : `без тега: ${altResult.error ?? ""}; с HUMAN_AGENT: ${tagResult.error ?? ""}`.slice(
                      0,
                      500,
                    );
              }
            }
          }
        }

        let commentReplyStatus: "skipped" | "sent" | "failed" = "skipped";
        let commentReplyError: string | null = null;
        const commentReplyText = automation.commentReply?.trim();
        const dmDeliveredSomehow = result.ok || altChannelStatus === "sent";
        if (
          !result.ok &&
          altChannelStatus === "sent" &&
          commentReplyText &&
          !commentReplySentByZernio.has(commentId)
        ) {
          const replyResult = await postCommentReply(
            postId,
            commentId,
            automation.accountId,
            commentReplyText,
          );
          commentReplyStatus = replyResult.ok ? "sent" : "failed";
          commentReplyError = replyResult.ok ? null : (replyResult.error?.slice(0, 500) ?? null);
        }

        await s
          .from("comment_dm_fallback_sends")
          .update({
            status: result.ok ? "sent" : "failed",
            error: result.error?.slice(0, 500) ?? null,
            alt_channel_status: altChannelStatus,
            alt_channel_error: altChannelError,
            comment_reply_status: commentReplyStatus,
            comment_reply_error: commentReplyError,
          })
          .eq("bot_id", botId)
          .eq("automation_id", automationId)
          .eq("comment_id", commentId);

        if (!dmDeliveredSomehow) {
          await notifyAdminsCommentUnresolved(
            `⚠️ Комментарий под правилом «${escapeHtml(automation.name)}» не получил ответа ` +
              `ни в директ (ни родная автоматизация, ни резерв, ни существующий диалог), ни в ` +
              `комментариях — автоматика больше ничего сделать не может. Ответьте вручную ` +
              `(comment ID ${escapeHtml(commentId)}).`,
          );
        }
      }
    } catch (e) {
      console.error(`[comment-dm-fallback] правило ${automationId} не проверено`, e);
    }
  }

  return { automationsChecked: perPost.length, commentsChecked, sent, failed };
}
