import { randomBytes } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { isAdminAuthed } from "@/lib/admin-session.server";
import { isControlPlane } from "@/lib/control-plane.server";

export const Route = createFileRoute("/api/admin/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Панель оператора (CONTROL_PLANE=1) не арендатор — у неё нет BOT_ID,
        // и isAdminAuthed() сам по себе этого не проверяет (см.
        // control-plane.server.ts).
        if (isControlPlane()) {
          return new Response("Not found", { status: 404 });
        }
        if (!(await isAdminAuthed())) {
          return new Response("Unauthorized", { status: 401 });
        }
        const form = await request.formData();
        const file = form.get("file");
        const bucket = String(form.get("bucket") || "");
        if (!(file instanceof File) || !["product-images", "product-files"].includes(bucket)) {
          return new Response("Bad request", { status: 400 });
        }
        const ext = (file.name.split(".").pop() || "bin").toLowerCase().slice(0, 10);
        const botId = process.env.BOT_ID?.trim() || "unknown";
        const key = `${botId}/${randomBytes(16).toString("hex")}.${ext}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
        const { error } = await supabaseAdmin.storage.from(bucket).upload(key, bytes, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
        if (error) return new Response(error.message, { status: 500 });
        return Response.json({ path: key, name: file.name });
      },
    },
  },
});
