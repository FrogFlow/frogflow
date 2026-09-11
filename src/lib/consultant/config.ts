/**
 * Модель консультанта задаётся ENV, не размазана по вызовам.
 * Haiku 4.5 — выбор для BOVI; замена модели не должна трогать tools/state.
 */
export const DEFAULT_CONSULTANT_MODEL = "claude-haiku-4-5-20251001";

export function consultantModel(): string {
  return process.env.CONSULTANT_MODEL?.trim() || DEFAULT_CONSULTANT_MODEL;
}

export function consultantApiKey(): string {
  return process.env.ANTHROPIC_API_KEY?.trim() || "";
}

export const CONSULTANT_AI_TIMEOUT_MS = 40_000;
export const CONSULTANT_MAX_TOOL_ROUNDS = 3;
