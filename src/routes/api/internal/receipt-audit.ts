import { createFileRoute } from "@tanstack/react-router";
import { authenticateInternalRequest } from "@/lib/internal/internal-api.server";
import type { SeenReceiptHash } from "@/lib/receipt-audit";

/**
 * Аудит чеков для панели оператора.
 * Только чтение: Vision смотрит файл, заказы не трогаем.
 */
export const Route = createFileRoute("/api/internal/receipt-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateInternalRequest(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.message }, { status: auth.status });
        }

        let action: "inventory" | "scan" = "inventory";
        let afterId = 0;
        let seenHashes: SeenReceiptHash[] = [];
        try {
          const body = (await request.json()) as {
            action?: unknown;
            afterId?: unknown;
            seenHashes?: unknown;
          };
          if (body?.action === "scan") action = "scan";
          const n = Number(body?.afterId);
          if (Number.isFinite(n) && n > 0) afterId = Math.floor(n);
          if (Array.isArray(body?.seenHashes)) {
            seenHashes = body.seenHashes.flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const rec = item as { hash?: unknown; orderId?: unknown; displayNo?: unknown };
              const hash = typeof rec.hash === "string" ? rec.hash : "";
              const orderId = Number(rec.orderId);
              if (!hash || !Number.isFinite(orderId)) return [];
              const displayNo =
                typeof rec.displayNo === "number" || typeof rec.displayNo === "string"
                  ? rec.displayNo
                  : orderId;
              return [{ hash, orderId, displayNo }];
            });
          }
        } catch {
          /* пустое тело — инвентарь */
        }

        const { loadReceiptAuditInventory, scanNextReceipt } =
          await import("@/lib/receipt-audit.server");
        if (action === "scan") {
          const scan = await scanNextReceipt({ afterId, seenHashes });
          return Response.json({ ok: true, scan });
        }
        const inventory = await loadReceiptAuditInventory();
        return Response.json({ ok: true, inventory });
      },
    },
  },
});
