import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import { Checkbox } from "@/components-ui/checkbox";
import {
  getInstagramConnectUrlFn,
  getInstagramAccountsFn,
  registerInstagramWebhookFn,
  getAutomationsFn,
  saveAutomationFn,
  deleteAutomationFn,
  toggleAutomationFn,
  getInstagramLogsFn,
  getZernioPostsFn,
} from "@/lib/instagram.functions";

export const Route = createFileRoute("/admin/instagram")({
  head: () => ({ meta: [{ title: "Управление Instagram — Админка" }] }),
  component: AdminInstagramPage,
});

function AdminInstagramPage() {
  const qc = useQueryClient();

  const accountsQuery = useQuery({ queryKey: ["ig_accounts"], queryFn: () => getInstagramAccountsFn() });
  const automationsQuery = useQuery({ queryKey: ["ig_automations"], queryFn: () => getAutomationsFn() });
  const logsQuery = useQuery({ queryKey: ["ig_logs"], queryFn: () => getInstagramLogsFn() });
  
  const accounts = accountsQuery.data?.accounts || [];
  const acc = accounts[0];
  
  const postsQuery = useQuery({ 
    queryKey: ["ig_posts", acc?._id], 
    queryFn: () => getZernioPostsFn({ data: { accountId: acc?._id } }), 
    enabled: !!acc?._id 
  });

  const [connecting, setConnecting] = useState(false);
  const [registeringWebhook, setRegisteringWebhook] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Form state for Comment-to-DM automation
  const [title, setTitle] = useState("");
  const [keywordsStr, setKeywordsStr] = useState("");
  const [replyText, setReplyText] = useState("");
  const [dmText, setDmText] = useState("");
  const [postId, setPostId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [savingAuto, setSavingAuto] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    setStatusMsg(null);
    try {
      const res = await getInstagramConnectUrlFn();
      if (res?.authUrl) {
        window.open(res.authUrl, "_blank");
        setStatusMsg("Ссылка авторизации открыта в новой вкладке. Пройдите авторизацию через Meta.");
      } else {
        setStatusMsg("Ошибка: не удалось получить ссылку авторизации.");
      }
    } catch (e: any) {
      setStatusMsg(`Ошибка подключения: ${e.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleRegisterWebhook = async () => {
    setRegisteringWebhook(true);
    setStatusMsg(null);
    try {
      const res = await registerInstagramWebhookFn();
      if (res?.ok) {
        setStatusMsg("✅ Соединение успешно обновлено!");
      } else {
        setStatusMsg("❌ Ошибка при обновлении соединения.");
      }
    } catch (e: any) {
      setStatusMsg(`Ошибка: ${e.message}`);
    } finally {
      setRegisteringWebhook(false);
    }
  };

  const handleSaveAutomation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (!accountsQuery.data?.accounts || accountsQuery.data.accounts.length === 0) {
      alert("Нет подключенных аккаунтов Instagram!");
      return;
    }
    const acc = accountsQuery.data.accounts[0];
    
    setSavingAuto(true);
    try {
      const keywords = keywordsStr
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

      await saveAutomationFn({
        data: {
          accountId: acc._id,
          profileId: acc.profileId || "", // We can pass empty, backend will use default profileId if missing
          name: title,
          keywords,
          matchMode: "contains",
          dmMessage: dmText,
          commentReply: replyText,
          platformPostId: postId.trim() || null,
        },
      });

      setTitle("");
      setKeywordsStr("");
      setReplyText("");
      setDmText("");
      setPostId("");
      setIsActive(true);
      qc.invalidateQueries({ queryKey: ["ig_automations"] });
    } catch (e: any) {
      alert(`Ошибка сохранения: ${e.message}`);
    } finally {
      setSavingAuto(false);
    }
  };

  const handleToggleAutomation = async (id: string, currentIsActive: boolean) => {
    try {
      await toggleAutomationFn({ data: { id, isActive: !currentIsActive } });
      qc.invalidateQueries({ queryKey: ["ig_automations"] });
    } catch (e: any) {
      alert(`Ошибка переключения: ${e.message}`);
    }
  };

  const handleDeleteAutomation = async (id: string) => {
    if (!confirm("Удалить эту автоматизацию?")) return;
    try {
      await deleteAutomationFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["ig_automations"] });
    } catch (e: any) {
      alert(`Ошибка удаления: ${e.message}`);
    }
  };

  const automations = automationsQuery.data?.automations || [];
  const logs = logsQuery.data?.logs || [];
  const posts = postsQuery.data?.posts || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Интеграция Instagram</h1>
          <p className="text-sm text-muted-foreground">
            Официальное подключение аккаунтов, обработка Direct и автоответов на комментарии
          </p>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-600 text-sm">
          {statusMsg}
        </div>
      )}

      {/* 1. Подключение и статус аккаунта */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded-lg p-5 bg-card space-y-3">
          <h2 className="text-lg font-semibold">1. Авторизация</h2>
          <p className="text-sm text-muted-foreground">
            Авторизация происходит через официальный шлюз Meta. Пароли вводить не требуется.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleConnect} disabled={connecting}>
              {connecting ? "Генерация ссылки..." : "🔗 Подключить аккаунт"}
            </Button>
            <Button variant="outline" onClick={handleRegisterWebhook} disabled={registeringWebhook}>
              {registeringWebhook ? "Регистрация..." : "⚡ Обновить соединение"}
            </Button>
          </div>
        </div>

        <div className="border rounded-lg p-5 bg-card space-y-3">
          <h2 className="text-lg font-semibold">Подключенные аккаунты</h2>
          {accountsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Загрузка аккаунтов...</p>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет подключенных Instagram аккаунтов</p>
          ) : (
            <div className="space-y-2">
              {accounts.map((acc: any) => (
                <div key={acc._id} className="p-3 border rounded-md flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium">{acc.name || acc.username || "Instagram Account"}</div>
                    <div className="text-xs text-muted-foreground">ID: {acc._id}</div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-600 font-medium">
                    Активен
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2. Автоответов */}
      <div className="border rounded-lg p-5 bg-card space-y-4">
        <h2 className="text-lg font-semibold">Автоматические ответы на комментарии</h2>
        <p className="text-sm text-muted-foreground">
          При написании указанных ключевых слов в комментариях под постом или Reels, бот автоматически ответит пользователю публично и пришлет подробное сообщение в Директ.
        </p>

        <form onSubmit={handleSaveAutomation} className="grid grid-cols-1 md:grid-cols-2 gap-4 border p-4 rounded-md bg-muted/20">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="auto_title">Название правила</Label>
            <Input
              id="auto_title"
              placeholder="Например: Автовыдача учебника по математике"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="auto_kw">Ключевые слова (через запятую)</Label>
            <Input
              id="auto_kw"
              placeholder="цена, купить, хочу, материал"
              value={keywordsStr}
              onChange={(e) => setKeywordsStr(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Оставьте пустым для срабатывания на любой комментарий</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="auto_post_id">Прикрепить к посту (необязательно)</Label>
            <select
              id="auto_post_id"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={postId}
              onChange={(e) => setPostId(e.target.value)}
            >
              <option value="">Любой пост (оставьте так для всех постов)</option>
              {posts.map((p: any) => (
                <option key={p.platformPostId || p._id} value={p.platformPostId || p._id}>
                  {p.text ? p.text.substring(0, 40) + "..." : "Пост от " + new Date(p.createdAt || p.created_at).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="auto_reply">Публичный ответ на комментарий</Label>
            <Textarea
              id="auto_reply"
              rows={2}
              placeholder="Написали вам в Директ! 📩"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="auto_dm">Личное сообщение в DM (Direct)</Label>
            <Textarea
              id="auto_dm"
              rows={2}
              placeholder="Здравствуйте! Вот подробная информация и ссылка на каталог: ..."
              value={dmText}
              onChange={(e) => setDmText(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 md:col-span-2">
            <Checkbox id="auto_active" checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
            <Label htmlFor="auto_active" className="cursor-pointer">Правило активно</Label>
          </div>

          <div className="md:col-span-2">
            <Button type="submit" disabled={savingAuto}>
              {savingAuto ? "Сохранение..." : "➕ Добавить автоматизацию"}
            </Button>
          </div>
        </form>

        {/* Список автоматизаций */}
        <div className="space-y-3 mt-4">
          <h3 className="font-medium text-sm">Активные правила ({automations.length})</h3>
          {automations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Правила пока не добавлены.</p>
          ) : (
            <div className="space-y-2">
              {automations.map((auto: any) => (
                <div key={auto.id} className="p-4 border rounded-md flex flex-col md:flex-row md:items-center justify-between gap-3 bg-card">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{auto.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${auto.isActive ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                        {auto.isActive ? 'Активно' : 'Отключено'}
                      </span>
                      <span className="text-xs text-muted-foreground">Срабатываний: {auto.stats?.triggered || 0}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Ключевые слова: {auto.keywords && auto.keywords.length > 0 ? auto.keywords.join(", ") : "Все комментарии"}
                    </div>
                    {auto.commentReply && <div className="text-xs">💬 Ответ: "{auto.commentReply}"</div>}
                    {auto.dmMessage && <div className="text-xs">📩 DM: "{auto.dmMessage}"</div>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleToggleAutomation(auto.id, auto.isActive)}>
                      {auto.isActive ? "Выключить" : "Включить"}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDeleteAutomation(auto.id)}>
                      Удалить
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. Журнал событий */}
      <div className="border rounded-lg p-5 bg-card space-y-4">
        <h2 className="text-lg font-semibold">Журнал событий</h2>
        <p className="text-sm text-muted-foreground">Последние системные события интеграции</p>

        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Событий пока не зафиксировано.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="p-2">Время</th>
                  <th className="p-2">Тип события</th>
                  <th className="p-2">Event ID</th>
                  <th className="p-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: any) => (
                  <tr key={log.id} className="border-b hover:bg-muted/20">
                    <td className="p-2 text-xs">{new Date(log.created_at).toLocaleString("ru-RU")}</td>
                    <td className="p-2 font-mono text-xs">{log.event_type}</td>
                    <td className="p-2 font-mono text-xs">{log.event_id || "-"}</td>
                    <td className="p-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-600">
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
