export async function notifyConsultantHandoff(params: {
  userKey: string;
  reason: string;
  text: string;
  customerName?: string;
  customerUsername?: string;
  customerContact?: string;
  lastProducts?: string[];
}): Promise<void> {
  try {
    const { notifyOwner } = await import("@/lib/internal/internal-api.server");

    let directUsername = (params.customerUsername || "").replace(/^@/, "").trim();
    let displayName = params.customerName || (params.customerUsername ? `@${directUsername}` : "");
    if (!displayName || !directUsername) {
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
          if (data.username) {
            directUsername = data.username.replace(/^@/, "").trim();
            displayName = `@${directUsername}`;
          } else if (!displayName) {
            displayName =
              [data.first_name, data.last_name].filter(Boolean).join(" ") || "";
          }
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

    if (params.customerContact) {
      lines.push(`📞 Контакты: ${params.customerContact}`);
    }

    // Extract readable conversation ID (e.g. ig_2026778764876869 → show last 6 digits)
    const shortId = params.userKey.replace(/^ig_/, "…");
    lines.push(`💬 ${shortId}`);
    lines.push("");

    lines.push(`📝 «${params.text.slice(0, 300)}»`);

    if (params.lastProducts && params.lastProducts.length > 0) {
      lines.push("");
      try {
        const { loadConsultantCatalog } = await import("./catalog");
        const catalog = await loadConsultantCatalog();
        const readable = params.lastProducts.slice(0, 3).map((id) => {
          const p = catalog.find((item) => item.id === id);
          if (!p) return id;
          const sizeStr = p.size ? ` ${p.size}` : "";
          const priceStr = p.price_kzt ? ` (${p.price_kzt.toLocaleString("ru-RU")} ₸)` : "";
          return `${p.name}${sizeStr}${priceStr}`;
        });
        if (readable.length === 1) {
          lines.push(`🏷 Товар: ${readable[0]}`);
        } else {
          lines.push(`🏷 Товары:\n${readable.map((r) => `  • ${r}`).join("\n")}`);
        }
      } catch {
        lines.push(`🏷 Товары: ${params.lastProducts.slice(0, 3).join(", ")}`);
      }
    }

    const message = lines.join("\n");

    const replyMarkup = {
      inline_keyboard: [
        [
          directUsername
            ? { text: "💬 Открыть диалог в Instagram", url: `https://ig.me/m/${directUsername}` }
            : { text: "💬 Открыть Instagram Direct", url: "https://www.instagram.com/direct/inbox/" },
        ],
      ],
    };

    const res = await notifyOwner(message, replyMarkup);
    console.log("[notifyConsultantHandoff] response:", res);
  } catch (e) {
    console.error("[notifyConsultantHandoff] error:", e);
  }
}
