/**
 * Telegram кладёт подпись Mini App не только в Telegram.WebApp.initData:
 * сначала — в hash или query (`tgWebAppData=…`), SDK читает и часто
 * сразу стирает fragment. Редирект WebView может убить hash до нашего
 * boot-скрипта — поэтому capture должен быть первым в <head>.
 */

export function looksLikeInitData(value: string): boolean {
  const v = value.trim();
  return v.includes("hash=") && (v.includes("auth_date=") || v.includes("user="));
}

export function initDataFromWebAppLocation(source: string): string {
  const raw = source.trim().replace(/^[#?]/, "");
  if (!raw) return "";

  const params = new URLSearchParams(raw);
  const encoded = params.get("tgWebAppData")?.trim() ?? "";
  if (looksLikeInitData(encoded)) return encoded;

  const prefix = "tgWebAppData=";
  const start = raw.indexOf(prefix);
  if (start < 0) return looksLikeInitData(encoded) ? encoded : "";

  let rest = raw.slice(start + prefix.length);
  const cut = rest.search(/&tgWebApp[A-Z]/);
  if (cut >= 0) rest = rest.slice(0, cut);
  try {
    rest = decodeURIComponent(rest.replace(/\+/g, " ")).trim();
  } catch {
    rest = rest.trim();
  }
  if (looksLikeInitData(rest)) return rest;
  return "";
}

/** @deprecated alias — hash и search разбираются одним парсером */
export function initDataFromWebAppHash(hash: string): string {
  return initDataFromWebAppLocation(hash);
}

export function initDataFromStoredInitParams(json: string | null | undefined): string {
  if (!json) return "";
  try {
    const parsed = JSON.parse(json) as { tgWebAppData?: unknown; initData?: unknown };
    if (typeof parsed.tgWebAppData === "string" && looksLikeInitData(parsed.tgWebAppData)) {
      return parsed.tgWebAppData.trim();
    }
    if (typeof parsed.initData === "string" && looksLikeInitData(parsed.initData)) {
      return parsed.initData.trim();
    }
    if (typeof parsed.tgWebAppData === "string") {
      return initDataFromWebAppLocation(String(parsed.tgWebAppData));
    }
  } catch {
    return "";
  }
  return "";
}

export function initDataFromCapturedLaunch(packed: string | null | undefined): string {
  if (!packed?.trim()) return "";
  if (looksLikeInitData(packed)) return packed.trim();
  for (const part of packed.split("\n")) {
    const got = initDataFromWebAppLocation(part);
    if (looksLikeInitData(got)) return got;
  }
  return "";
}

export function resolveTelegramInitData(input: {
  sdkInitData?: string | null;
  hash?: string;
  search?: string;
  storedInitParamsJson?: string | null;
  capturedLaunch?: string | null;
  capturedRaw?: string | null;
}): string {
  const candidates = [
    input.sdkInitData,
    input.capturedRaw,
    initDataFromCapturedLaunch(input.capturedLaunch),
    initDataFromWebAppLocation(input.hash ?? ""),
    initDataFromWebAppLocation(input.search ?? ""),
    initDataFromStoredInitParams(input.storedInitParamsJson),
  ];
  for (const c of candidates) {
    const v = (c ?? "").trim();
    if (looksLikeInitData(v)) return v;
  }
  return "";
}
