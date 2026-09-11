import { logger } from "@/lib/logger.server";
import { consultantModel } from "./config";

export function consultantRequestId(): string {
  return `csl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function logConsultantEvent(
  requestId: string,
  kind: string,
  extra: Record<string, unknown> = {},
): void {
  logger.info(`consultant.${kind}`, {
    requestId,
    model: consultantModel(),
    ...extra,
  });
}
