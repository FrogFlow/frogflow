export async function notifyConsultantHandoff(params: {
  userKey: string;
  reason: string;
  text: string;
  customerName?: string;
  customerUsername?: string;
  lastProducts?: string[];
}): Promise<void> {
  try {
    const { notifyOwner } = await import("@/lib/internal/internal-api.server");

    // Resolve customer display name
    let displayName = params.customerName || params.customerUsername || "";
    if (!displayName) {
      try {
        const { supabaseService } = await import(
          "@/integrations-supabase/client.server"
        );
        const { data } = await supabaseService
          .from("bot_users")
          .select("username, first_name, last_name")
          .eq("user_key", params.userKey)
          .maybeSingle();
        if (data) {
          if (data.username) displayName = `@${data.username}`;
          else
            displayName =
              [data.first_name, data.last_name].filter(Boolean).join(" ") || "";
        }
      } catch {
        /* ignore lookup failure */
      }
    }

    const reasonLabels: Record<string, string> = {
      purchase: "🛒 Покупка",
      other: "❓ Вопрос вне каталога",
      error: "⚠️ Ошибка",
      injection: "🚫 Подозрительный запрос",
      handoff: "👋 Передача менеджеру",
    };

    const label = reasonLabels[params.reason] || `📋 ${params.reason}`;

    const lines: string[] = [];
    lines.push(`${label}`);
    lines.push("");

    if (displayName) {
      lines.push(`👤 ${displayName}`);
    }

    // Extract readable conversation ID (e.g. ig_2026778764876869 → show last 6 digits)
    const shortId = params.userKey.replace(/^ig_/, "…");
    lines.push(`💬 ${shortId}`);
    lines.push("");

    lines.push(`📝 «${params.text.slice(0, 300)}»`);

    if (params.lastProducts && params.lastProducts.length > 0) {
      lines.push("");
      lines.push(
        `🏷 Товары: ${params.lastProducts.slice(0, 3).join(", ")}`,
      );
    }

    const message = lines.join("\n");

    const res = await notifyOwner(message);
    console.log("[notifyConsultantHandoff] response:", res);
  } catch (e) {
    console.error("[notifyConsultantHandoff] error:", e);
  }
}
