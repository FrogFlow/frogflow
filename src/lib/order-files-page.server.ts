import { requireAppOrigin } from "./app-origin.server";
import {
  mintOrderFilesToken,
  orderFilesSigningSecret,
  ORDER_FILES_LINK_DAYS,
  parseOrderFilesToken,
  renderOrderFilesErrorHtml,
  renderOrderFilesPageHtml,
} from "./order-files-page";
import { collectOrderFiles, type OrderItem } from "./orders.server";

const VIEWABLE_STATUSES = new Set(["awaiting_confirmation", "delivering", "delivered"]);

export function orderFilesPageUrl(orderId: number): string | null {
  const secret = orderFilesSigningSecret();
  if (!secret) return null;
  try {
    return `${requireAppOrigin()}/files/${mintOrderFilesToken(orderId, secret)}`;
  } catch {
    return null;
  }
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export async function orderFilesPageResponse(token: string): Promise<Response> {
  const secret = orderFilesSigningSecret();
  if (!secret) {
    return htmlResponse(
      renderOrderFilesErrorHtml(
        "Ссылка недоступна",
        "Напишите продавцу в Direct — пришлём файлы ещё раз.",
      ),
      503,
    );
  }
  const parsed = parseOrderFilesToken(token, secret);
  if (!parsed.ok) {
    const expired = parsed.reason === "expired";
    return htmlResponse(
      renderOrderFilesErrorHtml(
        expired ? "Ссылка устарела" : "Ссылка недействительна",
        expired
          ? "Напишите продавцу в Direct — пришлём новую кнопку."
          : "Проверьте ссылку или напишите продавцу в Direct.",
      ),
      expired ? 410 : 404,
    );
  }

  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select("id, status, display_no, order_no, fulfillment_kind, order_items(*)")
    .eq("id", parsed.orderId)
    .maybeSingle();
  if (error) throw error;
  if (
    !order ||
    !VIEWABLE_STATUSES.has(String(order.status)) ||
    order.fulfillment_kind === "physical"
  ) {
    return htmlResponse(
      renderOrderFilesErrorHtml(
        "Ссылка недействительна",
        "Проверьте ссылку или напишите продавцу в Direct.",
      ),
      404,
    );
  }

  const { files } = await collectOrderFiles(
    order.id as number,
    (order.order_items ?? []) as OrderItem[],
  );
  if (files.length === 0) {
    return htmlResponse(
      renderOrderFilesErrorHtml(
        "Файлы не найдены",
        "Напишите продавцу в Direct — проверим заказ и пришлём материалы.",
      ),
      404,
    );
  }

  const { data: shopSetting } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "shop_name")
    .maybeSingle();

  return htmlResponse(
    renderOrderFilesPageHtml({
      shopName: shopSetting?.value?.trim() || "Магазин",
      orderNo: order.display_no ?? order.order_no ?? order.id,
      files,
      linkDays: ORDER_FILES_LINK_DAYS,
    }),
  );
}
