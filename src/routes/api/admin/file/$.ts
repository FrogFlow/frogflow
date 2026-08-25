import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { isAdminAuthed } from "@/lib/admin-session.server";
import { isOwnTenantStorageKey } from "@/lib/tenant-storage-key.server";
import { isControlPlane } from "@/lib/control-plane.server";

export const Route = createFileRoute("/api/admin/file/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          // Панель оператора (CONTROL_PLANE=1) не арендатор: isOwnTenantStorageKey
          // пропускает непрефиксованные ключи без проверки BOT_ID, поэтому
          // без этой проверки роут отдал бы чужой файл (см. control-plane.server.ts).
          if (isControlPlane()) return new Response("Not found", { status: 404 });
          if (!(await isAdminAuthed())) return new Response("Unauthorized", { status: 401 });
          const splat = params._splat;
          if (!splat) return new Response("Not found (no splat)", { status: 404 });
          const url = new URL(request.url);
          const bucket = url.searchParams.get("bucket") || "product-files";
          if (!["product-files", "payment-proofs", "product-images"].includes(bucket)) {
            return new Response("Bad bucket", { status: 400 });
          }
          // Второй слой поверх сессии админки: эти бакеты общие на все
          // деплои (Storage не проходит через RLS), а сессия свою бы
          // изоляцию не дала, если бы кто-то подобрал/угадал чужой путь.
          if (!isOwnTenantStorageKey(splat)) {
            return new Response("Not found", { status: 404 });
          }
          const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
          const { data, error } = await supabaseAdmin.storage.from(bucket).download(splat);
          if (error) {
            console.error("Storage download error:", error);
            return new Response(`Storage error: ${error.message}`, { status: 404 });
          }
          if (!data) return new Response("Not found (no data)", { status: 404 });
          const buf = await data.arrayBuffer();
          return new Response(buf, {
            headers: { "Content-Type": data.type || "application/octet-stream" },
          });
        } catch (e: unknown) {
          console.error("API error:", e);
          return new Response(`Server error: ${errorMessage(e)}`, { status: 500 });
        }
      },
    },
  },
});
