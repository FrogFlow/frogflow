import crypto from "crypto";

// Адрес попадает в Result/Success/Fail URL платёжного шлюза — ошибиться тут
// значит увести колбэки об оплате на чужой хост, поэтому вариант «примерно».
export { requireAppOrigin as publicAppOrigin } from "./app-origin.server";

export function md5Hex(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

export function buildRobokassaPaymentUrl(params: {
  login: string;
  pass1: string;
  outSum: string;
  invId: number;
  description: string;
  isTest: boolean;
}): string {
  const signature = md5Hex(`${params.login}:${params.outSum}:${params.invId}:${params.pass1}`);
  const desc = encodeURIComponent(params.description);
  return (
    `https://auth.robokassa.kz/Merchant/Index.aspx` +
    `?MerchantLogin=${encodeURIComponent(params.login)}` +
    `&OutSum=${params.outSum}` +
    `&InvId=${params.invId}` +
    `&Description=${desc}` +
    `&SignatureValue=${signature}` +
    `&IsTest=${params.isTest ? 1 : 0}`
  );
}

export function verifyRobokassaResultSignature(params: {
  outSum: string;
  invId: string;
  signature: string;
  pass2: string;
  shpEntries?: Array<{ key: string; value: string }>;
}): boolean {
  let checkString = `${params.outSum}:${params.invId}:${params.pass2}`;
  const custom = [...(params.shpEntries ?? [])].sort((a, b) => a.key.localeCompare(b.key));
  if (custom.length > 0) {
    checkString += `:${custom.map((p) => `${p.key}=${p.value}`).join(":")}`;
  }
  const expected = md5Hex(checkString).toUpperCase();
  return params.signature.toUpperCase() === expected;
}
