import { VERTICALS, verticalDef, type VerticalKey } from "./registry";

/**
 * Ниша деплоя — переменная окружения VERTICAL на проекте Vercel, тем же
 * приёмом, что и BOT_ID/CONTROL_PLANE (см. lib/control-plane.server.ts).
 * Пустая или неизвестная переменная молча даёт "digital": опечатка в панели
 * оператора не должна ронять магазин, а семь живых деплоев без этой
 * переменной обязаны продолжать работать как раньше.
 */
export function currentVertical(): VerticalKey {
  const raw = process.env.VERTICAL?.trim();
  return raw && raw in VERTICALS ? (raw as VerticalKey) : "digital";
}

export function currentVerticalDef() {
  return verticalDef(currentVertical());
}
