/**
 * Telegram кладёт подпись Mini App не только в Telegram.WebApp.initData:
 * сначала — в hash (`#tgWebAppData=…`), SDK читает его и пишет в
 * sessionStorage, затем часто очищает hash. Если проверять только
 * `WebApp.initData` в тот же тик, что загрузилась страница, строка ещё
 * пустая — даже когда WebView уже Telegram.
 */

export function initDataFromWebAppHash(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return "";

  const params = new URLSearchParams(raw);
  const encoded = params.get("tgWebAppData")?.trim() ?? "";
  if (encoded.includes("hash=")) return encoded;

  const prefix = "tgWebAppData=";
  const start = raw.indexOf(prefix);
  if (start < 0) return encoded;

  let rest = raw.slice(start + prefix.length);
  const cut = rest.search(/&tgWebApp[A-Z]/);
  if (cut >= 0) rest = rest.slice(0, cut);
  try {
    return decodeURIComponent(rest.replace(/\+/g, " ")).trim();
  } catch {
    return rest.trim();
  }
}

export function initDataFromStoredInitParams(json: string | null | undefined): string {
  if (!json) return "";
  try {
    const parsed = JSON.parse(json) as { tgWebAppData?: unknown; initData?: unknown };
    if (typeof parsed.tgWebAppData === "string" && parsed.tgWebAppData.trim()) {
      return parsed.tgWebAppData.trim();
    }
    if (typeof parsed.initData === "string" && parsed.initData.trim()) {
      return parsed.initData.trim();
    }
  } catch {
    return "";
  }
  return "";
}

export function resolveTelegramInitData(input: {
  sdkInitData?: string | null;
  hash?: string;
  storedInitParamsJson?: string | null;
}): string {
  const sdk = input.sdkInitData?.trim() ?? "";
  if (sdk) return sdk;
  const fromHash = initDataFromWebAppHash(input.hash ?? "");
  if (fromHash) return fromHash;
  return initDataFromStoredInitParams(input.storedInitParamsJson);
}
