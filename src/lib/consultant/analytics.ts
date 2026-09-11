export type ConsultantEventKind =
  "query" | "oos" | "purchase" | "handoff" | "catalog" | "country" | "error" | "injection";

export type ConsultantEvent = {
  at: string;
  userKey: string;
  kind: ConsultantEventKind;
  text: string;
  bucket?: string;
};

const KEY = "consultant_events_json";
const LIMIT = 300;

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function recordConsultantEvent(
  event: Omit<ConsultantEvent, "at"> & { at?: string },
): Promise<void> {
  const row: ConsultantEvent = {
    at: event.at ?? new Date().toISOString(),
    userKey: event.userKey,
    kind: event.kind,
    text: event.text.slice(0, 240),
    bucket: event.bucket,
  };
  const s = await db();
  const { data } = await s.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  let list: ConsultantEvent[] = [];
  try {
    const parsed = data?.value ? (JSON.parse(data.value) as unknown) : [];
    if (Array.isArray(parsed)) list = parsed as ConsultantEvent[];
  } catch {
    list = [];
  }
  list.push(row);
  list = list.slice(-LIMIT);
  await s.from("app_settings").upsert({
    key: KEY,
    value: JSON.stringify(list),
    updated_at: row.at,
  });
}

export async function loadConsultantEvents(): Promise<ConsultantEvent[]> {
  const s = await db();
  const { data } = await s.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (!data?.value) return [];
  try {
    const parsed = JSON.parse(data.value) as unknown;
    return Array.isArray(parsed) ? (parsed as ConsultantEvent[]) : [];
  } catch {
    return [];
  }
}

export function summarizeConsultantEvents(events: ConsultantEvent[]) {
  const byKind: Record<string, number> = {};
  const oosTexts: Record<string, number> = {};
  for (const e of events) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (e.kind === "oos" && e.text) {
      const key = e.text.toLowerCase().slice(0, 80);
      oosTexts[key] = (oosTexts[key] ?? 0) + 1;
    }
  }
  const frequentOos = Object.entries(oosTexts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([text, count]) => ({ text, count }));
  return { byKind, frequentOos, total: events.length };
}
