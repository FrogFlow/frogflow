import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { addIgExclusion, deleteIgExclusion, listIgExclusions } from "@/lib/ig.functions";

export const Route = createFileRoute("/admin/ig/exclusions")({
  component: IgExclusionsPage,
});

function IgExclusionsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ig-exclusions"], queryFn: () => listIgExclusions() });
  const [providerUserId, setProviderUserId] = useState("");
  const [username, setUsername] = useState("");
  const [reason, setReason] = useState("");

  async function onAdd() {
    await addIgExclusion({
      data: {
        provider_user_id: providerUserId || null,
        username: username || null,
        reason: reason || null,
      },
    });
    setProviderUserId("");
    setUsername("");
    setReason("");
    qc.invalidateQueries({ queryKey: ["ig-exclusions"] });
  }

  async function onDelete(id: string) {
    if (!confirm("Удалить исключение?")) return;
    await deleteIgExclusion({ data: { id } });
    qc.invalidateQueries({ queryKey: ["ig-exclusions"] });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Исключения</h1>
        <p className="text-sm text-muted-foreground">
          Пользователи в списке не получают авто-DM. После успешной отправки бот добавляет автора сам.
        </p>
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-3 max-w-xl">
        <div className="space-y-2">
          <Label>provider_user_id (Unipile)</Label>
          <Input value={providerUserId} onChange={(e) => setProviderUserId(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>username</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@name" />
        </div>
        <div className="space-y-2">
          <Label>Причина</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <Button onClick={() => void onAdd()}>Добавить</Button>
      </div>

      <div className="space-y-2">
        {(q.data ?? []).map((row: any) => (
          <div key={row.id} className="bg-card border rounded-lg p-3 flex justify-between gap-3 text-sm">
            <div>
              <div>{row.username ? `@${String(row.username).replace(/^@/, "")}` : "—"}</div>
              <div className="font-mono text-xs text-muted-foreground">{row.provider_user_id || "—"}</div>
              {row.reason && <div className="text-muted-foreground">{row.reason}</div>}
            </div>
            <Button size="sm" variant="destructive" onClick={() => void onDelete(row.id)}>
              Удалить
            </Button>
          </div>
        ))}
        {!q.data?.length && !q.isLoading && (
          <p className="text-muted-foreground text-sm">Список пуст.</p>
        )}
      </div>
    </div>
  );
}
