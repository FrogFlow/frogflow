export const VERTICALS = ["default", "consultant"] as const;
export type Vertical = typeof VERTICALS[number];

export function isConsultantVertical(vertical: string | null | undefined): boolean {
  return vertical === "consultant";
}
