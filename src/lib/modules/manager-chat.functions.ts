import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-session.server";
import { requireModule } from "./require-module.server";
import {
  connect,
  disconnect,
  markRead,
  sendManagerReply,
  listConversations,
  listMessages,
  totalUnread,
} from "@/lib/manager-chat.server";

async function guard() {
  await requireAdmin();
  await requireModule("manager_chat");
}

export const listManagerChatConversationsFn = createServerFn({ method: "GET" }).handler(
  async () => {
    await guard();
    return listConversations();
  },
);

export const totalManagerChatUnreadFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return totalUnread();
});

const TelegramIdInput = z.object({ telegramId: z.number().int() });

export const listManagerChatMessagesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => TelegramIdInput.parse(d))
  .handler(async ({ data }) => {
    await guard();
    return listMessages(data.telegramId);
  });

export const connectManagerChatFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => TelegramIdInput.parse(d))
  .handler(async ({ data }) => {
    await guard();
    await connect(data.telegramId);
    return { ok: true as const };
  });

export const disconnectManagerChatFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => TelegramIdInput.parse(d))
  .handler(async ({ data }) => {
    await guard();
    await disconnect(data.telegramId);
    return { ok: true as const };
  });

export const markManagerChatReadFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => TelegramIdInput.parse(d))
  .handler(async ({ data }) => {
    await guard();
    await markRead(data.telegramId);
    return { ok: true as const };
  });

const SendReplyInput = z.object({
  telegramId: z.number().int(),
  text: z.string().min(1).max(4096),
});

export const sendManagerChatReplyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => SendReplyInput.parse(d))
  .handler(async ({ data }) => {
    await guard();
    await sendManagerReply(data.telegramId, data.text.trim());
    return { ok: true as const };
  });
