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
 * Сколько ждать, прежде чем считать `pending` брошенным прошлым прогоном.
 * Крон каждые 15 минут (vercel.json); 10 минут — длиннее одного прогона и
 * короче следующего тика.
 */
export const STALE_PENDING_MS = 10 * 60 * 1000;

/**
 * Что делать с уже существующей строкой comment_dm_fallback_sends.
 *
 * Раньше любой зависший pending заново слал DM, в том числе обычным inbox
 * в уже открытый чат. Inbox не идемпотентен: если прошлый прогон успел
 * отправить и умер до UPDATE, человек получал то же сообщение каждые 15
 * минут (живой случай: «мишки с геометрическими фигурами»).
 *
 * Один повтор private-reply ещё допустим (Meta на дубль отвечает
 * «already sent»). Второй и дальше — бросаем, не пишем в директ.
 */
export type StalePendingAction = "wait" | "retry" | "abandon" | "skip";

export function stalePendingAction(
  row: { status: string; created_at: string; updated_at: string },
  now: Date,
  staleMs: number = STALE_PENDING_MS,
): StalePendingAction {
  if (row.status !== "pending") return "skip";
  const created = new Date(row.created_at).getTime();
  const updated = new Date(row.updated_at).getTime();
  if (Number.isNaN(created) || Number.isNaN(updated)) return "abandon";
  if (now.getTime() - updated <= staleMs) return "wait";
  // updated уже уехал от insert — этот комментарий уже подхватывали.
  if (updated - created > staleMs) return "abandon";
  return "retry";
}

/** Private-reply ИЛИ альт-канал доставили DM — для крона это успех, не повод слать ещё. */
export function fallbackRecordStatus(
  privateOk: boolean,
  altChannelStatus: string,
): "sent" | "failed" {
  if (privateOk || altChannelStatus === "sent") return "sent";
  return "failed";
}

/**
 * Логи правила читаем страницами по 200, не больше пяти страниц за проход.
 *
 * Раньше крон брал одну страницу из 200 логов и сверял с ней ВСЕ комментарии
 * поста за 6,5 дня. На ходовом рилсе 200 срабатываний набирается за сутки-двое:
 * всё, что старше, выглядело «пропущенным». Private-reply на такой комментарий
 * Meta отклоняет (Zernio уже ответил), и крон уходил в альт-канал — обычным
 * сообщением в открытый диалог. Открытый диалог есть ровно у тех, кто уже
 * получил материалы и оплатил, — им то же сообщение и приходило повторно
 * (живой случай, сент. 2026: ~3 000 попыток за три недели на одном аккаунте,
 * почти все — по одному рилсу).
 */
export const LOG_PAGE_SIZE = 200;
export const LOG_MAX_PAGES = 5;

/** Запас на задержку между комментарием и записью о нём в логах Zernio. */
export const LOG_LAG_MS = 10 * 60 * 1000;

export type LogCoverage = { from: number; to: number };

/**
 * За комментарии какого времени прочитанные логи отвечают: «Zernio его видел»
 * или «не видел». complete — прочитаны все логи правила (последняя страница
 * неполная), тогда за любой. Иначе окно ограничено прочитанным. Порядок выдачи
 * у Zernio не документирован, поэтому определяем его по самим записям. Без
 * разбираемых дат не отвечаем ни за один комментарий — null.
 */
export function logCoverage(
  logs: ReadonlyArray<{ createdAt?: unknown }>,
  complete: boolean,
): LogCoverage | null {
  if (complete) return { from: -Infinity, to: Infinity };
  const times = logs.map((row) => Date.parse(String(row.createdAt ?? "")));
  if (times.length === 0 || times.some((t) => Number.isNaN(t))) return null;
  const first = times[0];
  const last = times[times.length - 1];
  // Новые сверху: прочитано всё от самой старой записи до сегодня.
  if (first >= last) return { from: Math.min(...times), to: Infinity };
  // Старые сверху: прочитано начало истории, про всё новее — ничего не известно.
  return { from: first, to: last - LOG_LAG_MS };
}

export function commentCoveredByLogs(
  createdTimeIso: string,
  coverage: LogCoverage | null,
): boolean {
  if (!coverage) return false;
  const created = Date.parse(createdTimeIso);
  if (Number.isNaN(created)) return false;
  return created >= coverage.from && created <= coverage.to;
}

/** Дошли ли логи до записи старше cutoff — дальше листать незачем. */
export function logsReachBack(
  logs: ReadonlyArray<{ createdAt?: unknown }>,
  cutoffMs: number,
): boolean {
  return logs.some((row) => {
    const t = Date.parse(String(row.createdAt ?? ""));
    return !Number.isNaN(t) && t <= cutoffMs;
  });
}

/**
 * Комментарии, которые Zernio уже обработал. skipped — Zernio видел комментарий
 * и сознательно не писал (например, этому человеку правило уже отвечало):
 * слать за него — ровно тот повтор, от которого правило себя защищает.
 * failed — пытался и не смог: это и есть работа резервного пути.
 */
export function commentIdsHandledByZernio(
  logs: ReadonlyArray<{ status?: unknown; commentId?: unknown }>,
): Set<string> {
  return new Set(
    logs
      .filter((row) => {
        const status = String(row.status ?? "");
        return status === "sent" || status === "skipped";
      })
      .map((row) => String(row.commentId ?? ""))
      .filter(Boolean),
  );
}

/**
 * Авторы, которым по этому посту уже писали. Человек, оставивший кодовое слово
 * дважды, получает сообщение один раз: второй комментарий Zernio пропускает,
 * и резервный путь не должен его «догонять».
 */
export function commenterIdsOf(
  comments: ReadonlyArray<{ id?: string; from?: { id?: string } }>,
  commentIds: ReadonlySet<string>,
): Set<string> {
  return new Set(
    comments
      .filter((c) => c.id && commentIds.has(c.id))
      .map((c) => c.from?.id ?? "")
      .filter(Boolean),
  );
}

/**
 * Meta отказала в private-reply, потому что на этот комментарий уже отвечали.
 * Значит, человек своё сообщение получил — эскалировать в директ нельзя.
 */
export function isPrivateReplyAlreadySent(raw: string): boolean {
  const text = raw.toLowerCase();
  return (
    text.includes("2534023") ||
    text.includes("privatereplyconsumed") ||
    text.includes("already sent a private reply")
  );
}

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
 * показать оператору.
 *
 * ВАЖНО про 2534066: раньше здесь было уверенное объяснение "это холодный DM
 * без предыдущей переписки" — по единственному живому тесту (Educational,
 * сент. 2026), где публичный ответ на тот же comment ID прошёл, а DM упал с
 * этой ошибкой. Гипотеза не пережила следующую проверку: тот же код вышел и
 * на аккаунте, у которого переписка с бизнесом уже была. Сама Meta в тексте
 * ошибки называет ДВЕ равнозначные причины (права токена ИЛИ невалидный
 * comment ID) и не говорит, какая именно — мы не знаем этого точнее нее, и
 * выдавать одну из версий за подтверждённый факт больше нельзя. Этого кода
 * нет ни в документации Zernio, ни в публичной документации Meta.
 */
export function explainInstagramPrivateReplyError(raw: string): string {
  const text = raw.toLowerCase();
  if (
    text.includes("2534066") ||
    text.includes("granular scopes") ||
    text.includes("comment id is valid")
  ) {
    return (
      "Instagram отклонил private reply (код 2534066). Meta в самом тексте ошибки " +
      "называет две возможные причины разом и не уточняет, какая верна: недостаточно " +
      "прав токена на private reply (скоуп instagram_business_manage_messages) — или " +
      "невалидный comment ID/контекст. Публичный ответ в комментариях идёт другим вызовом " +
      "и скоупом (instagram_business_manage_comments), поэтому его успех НЕ подтверждает " +
      "и не исключает ни одну из этих причин. Этот код не описан ни у Zernio, ни у Meta. " +
      "Самое надёжное действие — переподключить Instagram в Zernio заново (полный вход " +
      "через Meta, явно подтвердив доступ к сообщениям на экране согласия, а не быстрым " +
      "«Продолжить»). Если не поможет — писать в поддержку Zernio с этим кодом, comment ID " +
      "и post ID: с их стороны видно то, чего не видно нам."
    );
  }
  if (text.includes("2534025") || text.includes("older than") || /\b7\s*day/.test(text)) {
    return "Instagram не принимает приватный ответ: комментарию больше 7 дней.";
  }
  if (isPrivateReplyAlreadySent(raw)) {
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
