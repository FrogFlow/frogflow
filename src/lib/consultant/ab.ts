import type { CopyBucket } from "./copy";

const KEY = "consultant_ab_bucket";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function getForcedAbBucket(): Promise<CopyBucket | null> {
  const s = await db();
  const { data } = await s.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  const v = data?.value?.trim();
  if (v === "a" || v === "b") return v;
  return null;
}

export async function saveForcedAbBucket(bucket: "split" | CopyBucket): Promise<void> {
  const s = await db();
  await s.from("app_settings").upsert({
    key: KEY,
    value: bucket,
    updated_at: new Date().toISOString(),
  });
}

export function bucketForUser(userKey: string, forced: CopyBucket | null): CopyBucket {
  if (forced) return forced;
  let h = 0;
  for (let i = 0; i < userKey.length; i++) h = (h + userKey.charCodeAt(i) * 17) % 2;
  return h === 0 ? "a" : "b";
}
