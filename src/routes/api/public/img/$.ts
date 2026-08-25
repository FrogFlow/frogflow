import { createFileRoute } from "@tanstack/react-router";
import { isOwnTenantStorageKey } from "@/lib/tenant-storage-key.server";
import { isControlPlane } from "@/lib/control-plane.server";

function resolveBucketAndKey(splat: string): { bucket: string; key: string } {
  if (splat.startsWith("broadcast-images/")) {
    return { bucket: "broadcast-images", key: splat.slice("broadcast-images/".length) };
  }
  if (splat.startsWith("instagram-media/")) {
    return { bucket: "instagram-media", key: splat.slice("instagram-media/".length) };
  }
  return { bucket: "product-images", key: splat };
}

export const Route = createFileRoute("/api/public/img/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        // Панель оператора (CONTROL_PLANE=1) не арендатор: isOwnTenantStorageKey
        // пропускает непрефиксованные (доисторические) ключи без проверки
        // BOT_ID вовсе, поэтому на панели этот роут отдавал бы любой такой
        // файл любого клиента без проверки.
        if (isControlPlane()) {
          return new Response("Not found", { status: 404 });
        }
        const splat = params._splat;
        if (!splat) return new Response("Not found", { status: 404 });
        const { bucket, key } = resolveBucketAndKey(splat);
        // product-images не проверяем: витринные фото публичны намеренно.
        // broadcast-images/instagram-media — общие бакеты, сверяем bot_id-
        // префикс, чтобы один клиент не мог скачать чужую картинку по
        // угаданному имени (см. tenant-storage-key.server.ts).
        if (bucket !== "product-images" && !isOwnTenantStorageKey(key)) {
          return new Response("Not found", { status: 404 });
        }
        const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
        const { data, error } = await supabaseAdmin.storage.from(bucket).download(key);
        if (error || !data) return new Response("Not found", { status: 404 });
        const buf = await data.arrayBuffer();
        return new Response(buf, {
          headers: {
            "Content-Type": data.type || "image/jpeg",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
