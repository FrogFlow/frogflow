import { describe, it, expect } from "vitest";
import {
  commentMatchesAutomation,
  commentAgeVerdict,
  annotateCommentStatus,
  commentPrivateReplyBlockReason,
  explainInstagramPrivateReplyError,
  stalePendingAction,
  fallbackRecordStatus,
  logCoverage,
  commentCoveredByLogs,
  logsReachBack,
  commentIdsHandledByZernio,
  commenterIdsOf,
  isPrivateReplyAlreadySent,
  LOG_LAG_MS,
  FALLBACK_MIN_AGE_MS,
  FALLBACK_MAX_AGE_MS,
  STALE_PENDING_MS,
} from "./comment-dm-fallback";

/**
 * Ошибка здесь либо пропускает резервную DM мимо реального совпадения
 * (клиент снова не получает ответ), либо шлёт её человеку, чей комментарий
 * ничего общего с правилом не имел, — обе цены высоки для чистой функции без
 * побочных эффектов, стоит тестировать саму логику.
 */
describe("commentMatchesAutomation", () => {
  it("пустой список ключевых слов — совпадает любой комментарий", () => {
    expect(commentMatchesAutomation("что угодно", [], "contains")).toBe(true);
    expect(commentMatchesAutomation("что угодно", undefined, "exact")).toBe(true);
  });

  it("contains: совпадает по вхождению подстроки, без учёта регистра", () => {
    expect(commentMatchesAutomation("хочу ГОД себе", ["год"], "contains")).toBe(true);
    expect(commentMatchesAutomation("совсем другое", ["год"], "contains")).toBe(false);
  });

  it("exact: совпадает только при полном равенстве текста и ключевого слова", () => {
    expect(commentMatchesAutomation("год", ["Год"], "exact")).toBe(true);
    expect(commentMatchesAutomation("хочу год себе", ["год"], "exact")).toBe(false);
  });

  it("exact: пробелы по краям комментария не мешают совпадению", () => {
    expect(commentMatchesAutomation("  год  ", ["год"], "exact")).toBe(true);
  });

  it("совпадает любое из нескольких ключевых слов", () => {
    expect(commentMatchesAutomation("хочу цена", ["год", "цена"], "contains")).toBe(true);
  });

  it("пустая строка среди ключевых слов не совпадает со всем подряд", () => {
    expect(commentMatchesAutomation("год", ["", "цена"], "contains")).toBe(false);
  });
});

describe("commentAgeVerdict", () => {
  const now = new Date("2026-01-15T12:00:00Z");

  it("слишком новый комментарий — даём Zernio шанс сработать первым", () => {
    const justNow = new Date(now.getTime() - 60 * 1000).toISOString();
    expect(commentAgeVerdict(justNow, now)).toBe("too_new");
  });

  it("комментарий в разумном окне — можно пробовать резервную отправку", () => {
    const anHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    expect(commentAgeVerdict(anHourAgo, now)).toBe("eligible");
  });

  it("комментарий старше 7-дневного окна private-reply — не пытаемся", () => {
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(commentAgeVerdict(eightDaysAgo, now)).toBe("too_old");
  });

  it("неразбираемая дата — не отправляем вслепую", () => {
    expect(commentAgeVerdict("не дата", now)).toBe("too_old");
  });

  it("границы окна согласованы с экспортированными константами", () => {
    const justUnderMin = new Date(now.getTime() - (FALLBACK_MIN_AGE_MS - 1000)).toISOString();
    const justOverMin = new Date(now.getTime() - (FALLBACK_MIN_AGE_MS + 1000)).toISOString();
    const justUnderMax = new Date(now.getTime() - (FALLBACK_MAX_AGE_MS - 1000)).toISOString();
    const justOverMax = new Date(now.getTime() - (FALLBACK_MAX_AGE_MS + 1000)).toISOString();
    expect(commentAgeVerdict(justUnderMin, now)).toBe("too_new");
    expect(commentAgeVerdict(justOverMin, now)).toBe("eligible");
    expect(commentAgeVerdict(justUnderMax, now)).toBe("eligible");
    expect(commentAgeVerdict(justOverMax, now)).toBe("too_old");
  });
});

/**
 * Это ровно то, что видит оператор в панели догоняющей рассылки: список
 * комментариев без этой классификации выглядит как непонятный шум ("25
 * комментариев, хз какого качества, откуда они и почему без ответа —
 * непонятно"). Ошибка здесь — неверная подсказка оператору, кому реально
 * нужен ручной ответ.
 */
describe("annotateCommentStatus", () => {
  const automation = { keywords: ["год"], matchMode: "contains" as const };
  const sent = new Set(["c-sent"]);
  const failed = new Set(["c-failed"]);

  it("комментарий от самого аккаунта — не адресат", () => {
    expect(
      annotateCommentStatus(
        { id: "c1", message: "год", from: { isOwner: true } },
        automation,
        sent,
        failed,
      ),
    ).toBe("owner");
  });

  it("уже отправлено Zernio — есть в логах со статусом sent", () => {
    expect(annotateCommentStatus({ id: "c-sent", message: "год" }, automation, sent, failed)).toBe(
      "sent",
    );
  });

  it("нет привязанного правила к посту вовсе", () => {
    expect(annotateCommentStatus({ id: "c1", message: "год" }, null, sent, failed)).toBe(
      "no_automation",
    );
  });

  it("правило есть, но ключевое слово не совпало", () => {
    expect(
      annotateCommentStatus({ id: "c1", message: "просто спасибо" }, automation, sent, failed),
    ).toBe("no_match");
  });

  it("совпало, Zernio пытался и провалил отправку — есть в логах со статусом failed", () => {
    expect(
      annotateCommentStatus({ id: "c-failed", message: "год" }, automation, sent, failed),
    ).toBe("failed");
  });

  it("совпало, но нигде в логах не встречается — похоже, пропущено", () => {
    expect(annotateCommentStatus({ id: "c-new", message: "год" }, automation, sent, failed)).toBe(
      "missing",
    );
  });
});

describe("commentPrivateReplyBlockReason", () => {
  const now = new Date("2026-09-05T12:00:00Z");

  it("ответ в ветке — Instagram не принимает private reply", () => {
    expect(
      commentPrivateReplyBlockReason(
        {
          parentId: "parent-1",
          createdTime: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
        },
        now,
      ),
    ).toBe("nested");
  });

  it("canReply=false — не пытаемся", () => {
    expect(
      commentPrivateReplyBlockReason(
        { createdTime: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), canReply: false },
        now,
      ),
    ).toBe("cannot_reply");
  });

  it("старше 7 дней — не пытаемся", () => {
    expect(
      commentPrivateReplyBlockReason(
        { createdTime: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString() },
        now,
      ),
    ).toBe("too_old");
  });

  it("обычный свежий комментарий к посту — можно слать", () => {
    expect(
      commentPrivateReplyBlockReason(
        { createdTime: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), canReply: true },
        now,
      ),
    ).toBeNull();
  });
});

describe("explainInstagramPrivateReplyError", () => {
  it("2534066 отделяет private reply от публичного ответа в комментариях, не выбирая одну причину", () => {
    const explained = explainInstagramPrivateReplyError(
      'Zernio API Error 403: {"error":"Please check if access token has enough IG permissions granular scopes for IG private reply. Or, verify if the comment ID is valid","error_subcode":2534066}',
    );
    expect(explained).toMatch(/2534066/);
    expect(explained).toMatch(/instagram_business_manage_messages/);
    expect(explained).toMatch(/публичн/i);
    // Раньше текст уверенно называл единственную причину ("холодный DM") — эта
    // гипотеза опровергнута живым случаем (аккаунт с уже открытым чатом
    // получил тот же код), поэтому текст обязан признавать обе версии Meta,
    // а не настаивать на одной.
    expect(explained).toMatch(/comment ID/);
    expect(explained).not.toMatch(/холодный DM этим методом Instagram не принимает/i);
  });

  it("окно 7 дней и повторный private reply получают короткий текст", () => {
    expect(explainInstagramPrivateReplyError("comment older than 7 days")).toMatch(/7 дней/);
    expect(explainInstagramPrivateReplyError("already sent a private reply")).toMatch(/уже уходил/);
  });

  it("незнакомый текст оставляем как есть", () => {
    expect(explainInstagramPrivateReplyError("rate limited")).toBe("rate limited");
  });
});

describe("stalePendingAction", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  const stale = STALE_PENDING_MS;

  it("sent/failed не трогаем", () => {
    const ts = now.toISOString();
    expect(stalePendingAction({ status: "sent", created_at: ts, updated_at: ts }, now)).toBe(
      "skip",
    );
    expect(stalePendingAction({ status: "failed", created_at: ts, updated_at: ts }, now)).toBe(
      "skip",
    );
  });

  it("свежий pending — ждём, вдруг прогон ещё жив", () => {
    const created = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    expect(
      stalePendingAction({ status: "pending", created_at: created, updated_at: created }, now),
    ).toBe("wait");
  });

  it("первый зависший pending — один повтор private-reply", () => {
    const created = new Date(now.getTime() - stale - 1000).toISOString();
    expect(
      stalePendingAction({ status: "pending", created_at: created, updated_at: created }, now),
    ).toBe("retry");
  });

  it("pending, который уже подхватывали — больше не пишем в директ", () => {
    const created = new Date(now.getTime() - 40 * 60 * 1000).toISOString();
    const updated = new Date(now.getTime() - stale - 1000).toISOString();
    expect(
      stalePendingAction({ status: "pending", created_at: created, updated_at: updated }, now),
    ).toBe("abandon");
  });
});

describe("fallbackRecordStatus", () => {
  it("альт-канал доставил — это успех, не failed", () => {
    expect(fallbackRecordStatus(false, "sent")).toBe("sent");
    expect(fallbackRecordStatus(true, "skipped")).toBe("sent");
    expect(fallbackRecordStatus(false, "failed")).toBe("failed");
    expect(fallbackRecordStatus(false, "skipped")).toBe("failed");
  });
});

describe("logCoverage / commentCoveredByLogs", () => {
  const hour = 60 * 60 * 1000;
  const now = Date.parse("2026-09-24T12:00:00Z");
  const at = (hoursAgo: number) => new Date(now - hoursAgo * hour).toISOString();

  it("прочитаны все логи — отвечаем за любой комментарий", () => {
    const coverage = logCoverage([{ createdAt: at(1) }], true);
    expect(commentCoveredByLogs(at(150), coverage)).toBe(true);
  });

  it("живой случай: 200 логов за последние сутки — комментарий трёхдневной давности не наш", () => {
    const logs = Array.from({ length: 200 }, (_, i) => ({ createdAt: at(i * 0.1) }));
    const coverage = logCoverage(logs, false);
    expect(commentCoveredByLogs(at(72), coverage)).toBe(false);
    expect(commentCoveredByLogs(at(5), coverage)).toBe(true);
    // Свежий комментарий, на который Zernio так и не ответил, — ради него крон и есть.
    expect(commentCoveredByLogs(at(0.5), coverage)).toBe(true);
  });

  it("старые сверху: про всё новее последней прочитанной записи не знаем", () => {
    const logs = [{ createdAt: at(100) }, { createdAt: at(90) }, { createdAt: at(80) }];
    const coverage = logCoverage(logs, false);
    expect(commentCoveredByLogs(at(95), coverage)).toBe(true);
    expect(commentCoveredByLogs(at(10), coverage)).toBe(false);
    expect(coverage?.to).toBe(Date.parse(at(80)) - LOG_LAG_MS);
  });

  it("без разбираемых дат не отвечаем ни за один комментарий", () => {
    expect(logCoverage([{ createdAt: "вчера" }], false)).toBeNull();
    expect(commentCoveredByLogs(at(1), null)).toBe(false);
  });

  it("logsReachBack — есть запись не новее границы", () => {
    const logs = [{ createdAt: at(1) }, { createdAt: at(200) }];
    expect(logsReachBack(logs, now - 156 * hour)).toBe(true);
    expect(logsReachBack([{ createdAt: at(1) }], now - 156 * hour)).toBe(false);
  });
});

describe("commentIdsHandledByZernio / commenterIdsOf", () => {
  it("sent и skipped — обработано Zernio, failed — нет", () => {
    const ids = commentIdsHandledByZernio([
      { status: "sent", commentId: "a" },
      { status: "skipped", commentId: "b" },
      { status: "failed", commentId: "c" },
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  it("авторы обработанных комментариев", () => {
    const comments = [
      { id: "a", from: { id: "u1" } },
      { id: "b", from: { id: "u2" } },
    ];
    expect([...commenterIdsOf(comments, new Set(["a"]))]).toEqual(["u1"]);
  });
});

describe("isPrivateReplyAlreadySent", () => {
  it("отказ Meta «уже отвечали» узнаём по коду и по тексту", () => {
    expect(isPrivateReplyAlreadySent("(#10) ... error_subcode 2534023")).toBe(true);
    expect(isPrivateReplyAlreadySent("You have already sent a private reply")).toBe(true);
    expect(isPrivateReplyAlreadySent("2534066 comment id is valid")).toBe(false);
  });
});
