/**
 * Уведомление менеджерам о передаче диалога. Возвращает результат доставки:
 * кнопка проверки в панели раньше рапортовала «отправлено» независимо от
 * того, дошло ли хоть кому-то.
 */
export async function notifyConsultantHandoff(params: {
  userKey: string;
  reason: string;
  text: string;
  customerName?: string;
  customerUsername?: string;
  customerContact?: string;
  lastProducts?: string[];
  /** Задано — ответ менеджера на это уведомление уйдёт покупателю. */
  replyTo?: { userKey: string; taskId?: string };
}): Promise<import("@/lib/internal/internal-api.server").NotifyOwnerResult> {
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
      question: "❓ Вопрос без ответа — диалог передан вам",
      photo: "📸 Просят фото — диалог передан вам",
      voice: "🎤 Голосовое сообщение — бот его не слышит",
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
        const seenLines = new Set<string>();
        const readable: string[] = [];
        for (const id of params.lastProducts) {
          const p = catalog.find((item) => item.id === id);
          if (!p) {
            if (!seenLines.has(id)) {
              seenLines.add(id);
              readable.push(id);
            }
            continue;
          }
          const sizeStr = p.size ? ` ${p.size}` : "";
          const colorStr = p.colors?.length ? `, ${p.colors.join("/")}` : "";
          const priceStr = p.price_kzt ? ` (${p.price_kzt.toLocaleString("ru-RU")} ₸)` : "";
          const line = `${p.name}${sizeStr}${colorStr}${priceStr}`;
          if (!seenLines.has(line)) {
            seenLines.add(line);
            readable.push(line);
          }
        }
        if (readable.length === 1) {
          lines.push(`🏷 Товар: ${readable[0]}`);
        } else if (readable.length > 1) {
          lines.push(`🏷 Товары:\n${readable.map((r) => `  • ${r}`).join("\n")}`);
        }
      } catch {
        const unique = Array.from(new Set(params.lastProducts.slice(0, 3)));
        lines.push(`🏷 Товары: ${unique.join(", ")}`);
      }
    }

    if (params.replyTo) {
      lines.push("");
      lines.push("↩️ Ответьте на это сообщение — отправлю ваш текст покупателю.");
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
    if (params.replyTo) {
      const { rememberReplyTargets } = await import("./manager-reply");
      const at = new Date().toISOString();
      await rememberReplyTargets(
        (res.deliveries ?? [])
          .filter((d) => d.ok && d.messageId)
          .map((d) => ({
            chatId: d.chatId,
            messageId: d.messageId as number,
            userKey: params.replyTo!.userKey,
            taskId: params.replyTo!.taskId,
            at,
          })),
      );
    }
    return res;
  } catch (e) {
    console.error("[notifyConsultantHandoff] error:", e);
    return { ok: false as const, status: 500, message: String(e) };
  }
}
