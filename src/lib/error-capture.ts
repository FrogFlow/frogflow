// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.
//
// Known limitation: this is one slot shared by the whole process, not scoped
// per request. Under concurrent requests, a rare race is possible where
// request B's consumeLastCapturedError() picks up request A's error instead
// of its own (or vice versa) if both fail within the same instant. The
// consequence is limited to server.ts's console.error() picking the wrong
// stack for that one log line (see server.ts) — the value is never sent back
// to a client, so this is a diagnostics-quality issue, not a data leak.
// Scoping it correctly would need AsyncLocalStorage wired through Node's
// global `error`/`unhandledrejection` listeners, which don't carry the
// original request's async context — not worth the complexity for a log
// line that's already best-effort.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
