import { commentMatchesAutomation, commentAgeVerdict } from "./comment-dm-fallback";

/** Потолок правил за один проход крона — по числу их обычно не больше ~20-30 на аккаунт. */
const MAX_AUTOMATIONS_PER_RUN = 20;

/** Потолок реальных отправок за один проход — если сопоставление где-то ошиблось, не разослать лишнего разом; остаток подхватит следующий проход. */
const MAX_SENDS_PER_RUN = 15;

/** Сколько логов автоматизации проверять на "Zernio уже отправил" — с запасом на обычный объём срабатываний одного правила. */
const LOG_CHECK_LIMIT = 200;

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
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
 * Сознательно НЕ дублируется автоматический публичный ответ (commentReply):
 * ошибочный лишний ПУБЛИЧНЫЙ комментарий на живом посте клиента заметен и
 * необратим сильнее, чем случайный лишний приватный DM, а сопоставление
 * ключевых слов здесь — лучшее воспроизведение чужого алгоритма, не
 * гарантированная копия. Тот же довод — почему это резервный путь, а не
 * замена родному: подтверждённая логика Zernio остаётся основной.
 *
 * Компромисс размена: если Zernio всё же ответит с опозданием ПОСЛЕ того,
 * как отработал наш fallback, человек получит два похожих DM вместо одного.
 * Это дешевле, чем повторение инцидента "почти сотня клиентов без ответа
 * несколько дней" — окно в 20 минут (FALLBACK_MIN_AGE_MS) снижает вероятность,
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
        if (reserveError) continue; // уже зарезервировано другим проходом — пропускаем молча

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

        await s
          .from("comment_dm_fallback_sends")
          .update({
            status: result.ok ? "sent" : "failed",
            error: result.error?.slice(0, 500) ?? null,
          })
          .eq("bot_id", botId)
          .eq("automation_id", automationId)
          .eq("comment_id", commentId);
      }
    } catch (e) {
      console.error(`[comment-dm-fallback] правило ${automationId} не проверено`, e);
    }
  }

  return { automationsChecked: perPost.length, commentsChecked, sent, failed };
}
