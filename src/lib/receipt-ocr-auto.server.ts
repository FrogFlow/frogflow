/**
 * Автопроверка чека — не то же самое, что модуль receipt_ocr.
 *
 * Модуль значит «у деплоя есть Vision и тариф это покрывает». Переключатель
 * в настройках — продавец сама решает, гонять ли OCR прямо сейчас: ночью
 * включила, чтобы заказы уходили сами, днём выключила и смотрит чеки глазами.
 * Раньше выключить автопроверку можно было только сняв модуль у оператора —
 * а это уже не тумблер на вечер, а переписка с нами.
 *
 * Ключ отсутствует → как раньше: автопроверка включена, если модуль куплен.
 * Явное "false" выключает Vision и автовыдачу, заказ уходит на ручную проверку.
 */
export const RECEIPT_OCR_AUTO_SETTING_KEY = "receipt_ocr_auto";

/** Ключ отсутствует или любое значение кроме "false" — автопроверка включена. */
export function parseReceiptOcrAutoSetting(value: string | null | undefined): boolean {
  return value !== "false";
}

export async function isReceiptOcrAutoEnabled(): Promise<boolean> {
  const { hasModule } = await import("./modules/modules.server");
  if (!(await hasModule("receipt_ocr"))) return false;
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", RECEIPT_OCR_AUTO_SETTING_KEY)
    .maybeSingle();
  return parseReceiptOcrAutoSetting(data?.value);
}

/**
 * Чек уже в руках. OCR — если тумблер включён, даже когда нет proof_auto:
 * в KZ покупатель часто шлёт скрин, пока ещё выбирает Robokassa/реквизиты,
 * и заказ уходил продавцу как обычный. proof_auto без тумблера оставляем
 * в этой ветке, чтобы в заметке было «автопроверка выключена», а не тишина.
 */
export function shouldEnterReceiptOcrPath(ocrEnabled: boolean, proofAuto: boolean): boolean {
  return ocrEnabled || proofAuto;
}
