export const STORE_ADDRESS_KEY = "consultant_store_address";
export const STORE_PHONE_KEY = "consultant_store_phone";
export const STORE_HOURS_KEY = "consultant_store_hours";

export const DEFAULT_STORE_ADDRESS = "г. Алматы, ул. Сатпаева, 3 (бутик-молл COLIBRI, 1-й этаж)";
export const DEFAULT_STORE_PHONE = "+7 (777) 333 08 08";
export const DEFAULT_STORE_HOURS = "ежедневно с 10:00 до 22:00";

export type ConsultantStoreInfo = {
  address: string;
  phone: string;
  hours: string;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function getConsultantStoreInfo(): Promise<ConsultantStoreInfo> {
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("key, value")
    .in("key", [STORE_ADDRESS_KEY, STORE_PHONE_KEY, STORE_HOURS_KEY, "admin_contact_link"]);

  const map = new Map((data ?? []).map((row) => [row.key, row.value]));
  const address = map.get(STORE_ADDRESS_KEY)?.trim() || DEFAULT_STORE_ADDRESS;
  const rawPhone = map.get(STORE_PHONE_KEY)?.trim() || map.get("admin_contact_link")?.trim();
  const phone = rawPhone || DEFAULT_STORE_PHONE;
  const hours = map.get(STORE_HOURS_KEY)?.trim() || DEFAULT_STORE_HOURS;

  return { address, phone, hours };
}

export async function saveConsultantStoreInfo(info: Partial<ConsultantStoreInfo>): Promise<void> {
  const s = await db();
  const entries: Array<{ key: string; value: string }> = [];
  if (typeof info.address === "string") entries.push({ key: STORE_ADDRESS_KEY, value: info.address.trim() });
  if (typeof info.phone === "string") entries.push({ key: STORE_PHONE_KEY, value: info.phone.trim() });
  if (typeof info.hours === "string") entries.push({ key: STORE_HOURS_KEY, value: info.hours.trim() });

  for (const entry of entries) {
    // Тот же случай, что и в knowledge.ts: ON CONFLICT (key) не совпадает с
    // первичным ключом (bot_id, key) из MIGRATION-02, вставка падает, а
    // ошибка до сих пор терялась — адрес, телефон и часы работы молча
    // оставались прежними.
    const { error } = await s.from("app_settings").upsert(entry);
    if (error) {
      throw new Error(`Не удалось сохранить «${entry.key}»: ${error.message}`);
    }
  }
}
