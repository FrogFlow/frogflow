import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components-ui/button";
import { Textarea } from "@/components-ui/textarea";
import { Badge } from "@/components-ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components-ui/card";
import { errorMessage } from "@/lib/error-message";
import {
  listManagerChatConversationsFn,
  listManagerChatMessagesFn,
  connectManagerChatFn,
  disconnectManagerChatFn,
  markManagerChatReadFn,
  sendManagerChatReplyFn,
} from "@/lib/modules/manager-chat.functions";

export const Route = createFileRoute("/admin/manager-chat")({
  beforeLoad: ({ context }) => {
    if (!context.modules.manager_chat) throw redirect({ to: "/admin" });
  },
  component: ManagerChatPage,
});

function conversationLabel(c: {
  username: string | null;
  first_name: string | null;
  telegram_id: number;
}) {
  return c.first_name || (c.username ? `@${c.username}` : `ID ${c.telegram_id}`);
}

/**
 * Бот часто шлёт текст с parse_mode: "HTML" (<b>, <a href>…) — в чистом
 * виде теги читались как есть (видно на скриншоте: буквально
 * `<a href="...">Условиями использования</a>`). Для читаемости в панели
 * достаточно голого текста, полноценный рендер HTML тут не нужен.
 */
function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

const SENDER_STYLE: Record<string, string> = {
  customer: "bg-background border",
  bot: "bg-muted text-foreground",
  manager: "ml-auto bg-primary text-primary-foreground",
};

const CHAT_HEIGHT = "h-[560px]";

function ManagerChatPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);

  const conversations = useQuery({
    queryKey: ["manager_chat_conversations"],
    queryFn: () => listManagerChatConversationsFn(),
    refetchInterval: 5000,
  });

  const messages = useQuery({
    queryKey: ["manager_chat_messages", selectedId],
    queryFn: () => listManagerChatMessagesFn({ data: { telegramId: selectedId! } }),
    enabled: selectedId !== null,
    refetchInterval: selectedId !== null ? 3000 : false,
  });

  useEffect(() => {
    if (selectedId === null) return;
    markManagerChatReadFn({ data: { telegramId: selectedId } })
      .then(() => qc.invalidateQueries({ queryKey: ["manager_chat_conversations"] }))
      .catch(() => {});
  }, [selectedId, qc]);

  // Прокручиваем окно переписки, а не страницу — открыли диалог или
  // пришло/ушло новое сообщение (в т.ч. по 3-секундному polling'у).
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages.data]);

  const selected = (conversations.data ?? []).find((c) => c.telegram_id === selectedId) ?? null;

  async function onToggleConnect() {
    if (selectedId === null || !selected) return;
    try {
      if (selected.active) {
        await disconnectManagerChatFn({ data: { telegramId: selectedId } });
      } else {
        await connectManagerChatFn({ data: { telegramId: selectedId } });
      }
      await qc.invalidateQueries({ queryKey: ["manager_chat_conversations"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  async function onSend() {
    if (selectedId === null || !reply.trim()) return;
    try {
      await sendManagerChatReplyFn({ data: { telegramId: selectedId, text: reply.trim() } });
      setReply("");
      await qc.invalidateQueries({ queryKey: ["manager_chat_messages", selectedId] });
      await qc.invalidateQueries({ queryKey: ["manager_chat_conversations"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Чат с менеджером</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Живые переписки бота с клиентами. Подключитесь к диалогу, чтобы отвечать самому — бот
          временно перестанет отвечать этому клиенту автоматически.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Диалоги</CardTitle>
          <CardDescription>Список обновляется каждые несколько секунд.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className={`${CHAT_HEIGHT} space-y-2 overflow-y-auto border-r pr-3`}>
            {(conversations.data ?? []).map((c) => (
              <button
                key={c.telegram_id}
                type="button"
                onClick={() => setSelectedId(c.telegram_id)}
                className={`w-full rounded-md border p-3 text-left ${
                  selectedId === c.telegram_id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium truncate">{conversationLabel(c)}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.active && (
                      <Badge variant="secondary" className="text-[10px]">
                        подключено
                      </Badge>
                    )}
                    {c.unread_count > 0 && <Badge className="text-[10px]">{c.unread_count}</Badge>}
                  </div>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {c.last_message_direction === "out" ? "Вы: " : ""}
                  {c.last_message_preview ? stripHtml(c.last_message_preview) : "Нет сообщений"}
                </p>
              </button>
            ))}
            {!conversations.isLoading && (conversations.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Диалогов пока нет.</p>
            )}
          </div>

          <div className={`${CHAT_HEIGHT} flex flex-col gap-3`}>
            {selectedId === null ? (
              <p className="m-auto text-sm text-muted-foreground">Выберите диалог слева.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 shrink-0">
                  <span className="text-sm font-medium">
                    {selected ? conversationLabel(selected) : ""}
                  </span>
                  <Button
                    size="sm"
                    variant={selected?.active ? "destructive" : "default"}
                    onClick={onToggleConnect}
                  >
                    {selected?.active ? "Завершить диалог" : "Подключиться к диалогу"}
                  </Button>
                </div>
                <div
                  ref={threadRef}
                  className="flex-1 min-h-0 space-y-2 overflow-y-auto rounded-md bg-muted/30 p-3"
                >
                  {(messages.data ?? []).map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${SENDER_STYLE[m.sender] ?? "bg-background border"}`}
                    >
                      {m.sender === "bot" && (
                        <p className="mb-1 text-[10px] uppercase opacity-60">автоответ бота</p>
                      )}
                      <p className="whitespace-pre-wrap">{stripHtml(m.text)}</p>
                      <p className="mt-1 text-[10px] opacity-70">
                        {new Date(m.created_at).toLocaleString("ru-RU")}
                      </p>
                    </div>
                  ))}
                  {messages.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Напишите ответ клиенту…"
                    rows={2}
                  />
                  <Button onClick={onSend} disabled={!reply.trim()}>
                    Отправить
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
