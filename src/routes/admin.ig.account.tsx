import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import {
  createIgAuthLink,
  getIgAccountSettings,
  saveIgAccountSettings,
  syncIgAccountsFromUnipile,
} from "@/lib/ig.functions";

export const Route = createFileRoute("/admin/ig/account")({
  component: IgAccountPage,
  validateSearch: (s: Record<string, unknown>) => ({
    account_id: typeof s.account_id === "string" ? s.account_id : undefined,
    status: typeof s.status === "string" ? s.status : undefined,
  }),
});

function IgAccountPage() {
  const search = Route.useSearch();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ig-account"], queryFn: () => getIgAccountSettings() });
  const [accountId, setAccountId] = useState("");
  const [accountName, setAccountName] = useState("");
  const [dmEnabled, setDmEnabled] = useState(false);
  const [defaultReply, setDefaultReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!q.data) return;
    setAccountId(q.data.accountId);
    setAccountName(q.data.accountName);
    setDmEnabled(q.data.dmEnabled);
    setDefaultReply(q.data.defaultReply);
  }, [q.data]);

  // Hosted Auth redirect may append account_id
  useEffect(() => {
    if (!search.account_id || !q.data) return;
    void (async () => {
      const id = search.account_id!;
      setAccountId(id);
      await saveIgAccountSettings({
        data: {
          accountId: id,
          accountName: q.data.accountName || "",
          dmEnabled: q.data.dmEnabled,
          defaultReply: q.data.defaultReply,
        },
      });
      setMsg("Аккаунт сохранён из redirect Unipile");
      qc.invalidateQueries({ queryKey: ["ig-account"] });
      await router.navigate({ to: "/admin/ig/account", search: {} });
    })();
  }, [search.account_id, q.data]);

  async function onSave() {
    setBusy(true);
    setMsg("");
    try {
      await saveIgAccountSettings({
        data: { accountId, accountName, dmEnabled, defaultReply },
      });
      setMsg("Сохранено");
      qc.invalidateQueries({ queryKey: ["ig-account"] });
      qc.invalidateQueries({ queryKey: ["ig-dashboard"] });
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onConnect() {
    setBusy(true);
    setMsg("");
    try {
      const { url } = await createIgAuthLink();
      window.location.href = url;
    } catch (e: any) {
      setMsg(e?.message || String(e));
      setBusy(false);
    }
  }

  async function onSync() {
    setBusy(true);
    setMsg("");
    try {
      const res = await syncIgAccountsFromUnipile();
      if (!res.ok) setMsg(res.message || "Не найдено");
      else {
        setMsg(`Синхронизировано: ${res.accountName} (${res.accountId})`);
        qc.invalidateQueries({ queryKey: ["ig-account"] });
      }
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-2xl font-semibold">Instagram — аккаунт</h1>
      <p className="text-sm text-muted-foreground">
        Подключение через Unipile Hosted Auth. Нужны env: UNIPILE_DSN, UNIPILE_API_KEY.
      </p>

      {q.isLoading && <p>Загрузка…</p>}

      <div className="bg-card border rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void onConnect()} disabled={busy || !q.data?.configured}>
            Подключить Instagram
          </Button>
          <Button variant="outline" onClick={() => void onSync()} disabled={busy || !q.data?.configured}>
            Синхронизировать из Unipile
          </Button>
        </div>

        <div className="space-y-2">
          <Label>Unipile account id</Label>
          <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="account_..." />
        </div>
        <div className="space-y-2">
          <Label>Имя / username</Label>
          <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="dm"
            type="checkbox"
            checked={dmEnabled}
            onChange={(e) => setDmEnabled(e.target.checked)}
          />
          <Label htmlFor="dm">Включить авто-DM по комментариям</Label>
        </div>
        <div className="space-y-2">
          <Label>Ответ по умолчанию (если у правила пусто)</Label>
          <Textarea
            value={defaultReply}
            onChange={(e) => setDefaultReply(e.target.value)}
            rows={4}
          />
        </div>
        <Button onClick={() => void onSave()} disabled={busy}>
          Сохранить
        </Button>
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        {q.data && !q.data.configured && (
          <p className="text-sm text-destructive">Unipile env не настроены на сервере.</p>
        )}
      </div>
    </div>
  );
}
