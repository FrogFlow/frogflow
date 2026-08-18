/**
 * Клиент внутреннего API клиентских деплоев (CONTROL-PLANE-PLAN.md §5).
 * Панель зовёт {app_url}/api/internal/*, предъявляя bots.internal_secret;
 * токен Telegram остаётся на стороне деплоя и в панель не попадает.
 */
import { errorMessage } from "@/lib/error-message";

/** Дольше держать смысла нет: панель ждёт синхронно, а деплой либо отвечает быстро, либо лежит. */
export const INTERNAL_TIMEOUT_MS = 10_000;

export type InternalTarget = {
  app_url: string | null;
  internal_secret: string | null;
};

export type InternalCallResult<T = unknown> =
  | { ok: true; body: T }
  /** Звать нечего — не заполнена карточка клиента, а не сбой доставки. */
  | { ok: false; kind: "skipped"; error: string }
  /** Деплой ответил и отказал: не тот секрет, нет владельца, Telegram отклонил. */
  | { ok: false; kind: "failed"; error: string }
  /** Не достучались вообще: таймаут, DNS, TLS, лежащий деплой. */
  | { ok: false; kind: "unreachable"; error: string };

/** Никогда не бросает: любой исход — это данные для отчёта, а не обрыв работы. */
export async function callInternal<T = unknown>(
  target: InternalTarget,
  path: `/api/internal/${string}`,
  body: unknown,
): Promise<InternalCallResult<T>> {
  if (!target.app_url) {
    return { ok: false, kind: "skipped", error: "Адрес деплоя (app_url) не заполнен" };
  }
  if (!target.internal_secret) {
    return { ok: false, kind: "skipped", error: "internal_secret не задан" };
  }

  const url = `${target.app_url.replace(/\/$/, "")}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTERNAL_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": target.internal_secret,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res
        .json()
        .then((j: { error?: string }) => j?.error)
        .catch(() => null);
      return {
        ok: false,
        kind: "failed",
        error: `HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
      };
    }
    const parsed = (await res.json().catch(() => null)) as T;
    return { ok: true, body: parsed };
  } catch (e: unknown) {
    const reason =
      e instanceof Error && e.name === "AbortError"
        ? `деплой не ответил за ${INTERNAL_TIMEOUT_MS / 1000} с`
        : errorMessage(e);
    return { ok: false, kind: "unreachable", error: `Деплой недоступен: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
