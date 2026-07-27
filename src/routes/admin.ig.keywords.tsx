import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import {
  deleteIgKeyword,
  listIgKeywords,
  listIgRecentPosts,
  saveIgKeyword,
} from "@/lib/ig.functions";

export const Route = createFileRoute("/admin/ig/keywords")({
  component: IgKeywordsPage,
});

type Kw = {
  id?: string;
  post_id: string;
  post_note?: string | null;
  keyword: string;
  reply_text: string;
  is_active: boolean;
};

const empty: Kw = { post_id: "", post_note: "", keyword: "", reply_text: "", is_active: true };

function IgKeywordsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ig-keywords"], queryFn: () => listIgKeywords() });
  const postsQ = useQuery({
    queryKey: ["ig-recent-posts"],
    queryFn: () => listIgRecentPosts(),
    retry: false,
  });
  const list = (q.data ?? []) as Kw[];
  const [editing, setEditing] = useState<Kw | null>(null);
  const [err, setErr] = useState("");
  const [manualId, setManualId] = useState(false);

  async function onSave() {
    if (!editing) return;
    setErr("");
    try {
      await saveIgKeyword({ data: editing });
      setEditing(null);
      setManualId(false);
      qc.invalidateQueries({ queryKey: ["ig-keywords"] });
      qc.invalidateQueries({ queryKey: ["ig-posts"] });
      qc.invalidateQueries({ queryKey: ["ig-dashboard"] });
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }
  async function onDelete(id: string) {
    if (!confirm("Удалить правило?")) return;
    await deleteIgKeyword({ data: { id } });
    qc.invalidateQueries({ queryKey: ["ig-keywords"] });
    qc.invalidateQueries({ queryKey: ["ig-dashboard"] });
  }

  function pickPost(id: string, caption: string) {
    if (!editing) return;
    setEditing({
      ...editing,
      post_id: id,
      post_note: editing.post_note || caption.slice(0, 120) || "",
    });
    setManualId(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Правила</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Одно правило = <strong>пост</strong> (выберите из списка) + <strong>кодовое слово</strong> +{" "}
            <strong>текст в личку</strong> автору комментария.
          </p>
        </div>
        {!editing && (
          <Button
            onClick={() => {
              setEditing({ ...empty });
              setManualId(false);
              setErr("");
              void postsQ.refetch();
            }}
          >
            + Правило
          </Button>
        )}
      </div>

      {editing && (
        <div className="bg-card border rounded-lg p-4 space-y-3 max-w-2xl">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Какой пост слушать</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void postsQ.refetch()}
                disabled={postsQ.isFetching}
              >
                {postsQ.isFetching ? "Загрузка…" : "Обновить список"}
              </Button>
            </div>

            {postsQ.isError && (
              <p className="text-sm text-amber-700">
                Не удалось загрузить посты: {(postsQ.error as Error).message}. Можно ввести id вручную.
              </p>
            )}

            {!manualId && (postsQ.data?.length ?? 0) > 0 && (
              <div className="max-h-56 overflow-y-auto border rounded-md divide-y">
                {postsQ.data!.map((p) => {
                  const selected = editing.post_id === p.id;
                  const label = p.caption?.trim() || "(без подписи)";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent ${
                        selected ? "bg-accent font-medium" : ""
                      }`}
                      onClick={() => pickPost(p.id, p.caption || "")}
                    >
                      <div className="line-clamp-2">{label}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{p.id}</div>
                    </button>
                  );
                })}
              </div>
            )}

            {!manualId && !postsQ.isLoading && !postsQ.data?.length && !postsQ.isError && (
              <p className="text-sm text-muted-foreground">Постов не найдено — введите id вручную.</p>
            )}

            {(manualId || !postsQ.data?.length) && (
              <Input
                value={editing.post_id}
                onChange={(e) => setEditing({ ...editing, post_id: e.target.value })}
                placeholder="Unipile post_id"
              />
            )}

            {editing.post_id && !manualId && (postsQ.data?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Выбран: <span className="font-mono">{editing.post_id}</span>
              </p>
            )}

            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => setManualId((v) => !v)}
            >
              {manualId ? "Выбрать из списка" : "Ввести post_id вручную"}
            </button>
          </div>

          <div className="space-y-2">
            <Label>Заметка (необязательно)</Label>
            <Input
              value={editing.post_note || ""}
              onChange={(e) => setEditing({ ...editing, post_note: e.target.value })}
              placeholder="Рекламный пост…"
            />
          </div>
          <div className="space-y-2">
            <Label>Кодовое слово в комментарии</Label>
            <Input
              value={editing.keyword}
              onChange={(e) => setEditing({ ...editing, keyword: e.target.value })}
              placeholder="прайс"
            />
          </div>
          <div className="space-y-2">
            <Label>Сообщение в личку автору</Label>
            <Textarea
              value={editing.reply_text}
              onChange={(e) => setEditing({ ...editing, reply_text: e.target.value })}
              rows={4}
              placeholder="Здравствуйте! Прайс тут: …"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editing.is_active}
              onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
            />
            Активно
          </label>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex gap-2">
            <Button onClick={() => void onSave()} disabled={!editing.post_id.trim()}>
              Сохранить
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setManualId(false);
              }}
            >
              Отмена
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {list.map((row) => (
          <div key={row.id} className="bg-card border rounded-lg p-3 flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="font-medium">
                Слово «{row.keyword}»{" "}
                {!row.is_active && <span className="text-muted-foreground">(выкл)</span>}
              </div>
              <div className="text-xs font-mono text-muted-foreground break-all">
                пост: {row.post_id || "⚠️ не указан"}
              </div>
              {row.post_note && <div className="text-xs text-muted-foreground">{row.post_note}</div>}
              <div className="text-sm text-muted-foreground whitespace-pre-wrap">{row.reply_text}</div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(row);
                  setManualId(false);
                  void postsQ.refetch();
                }}
              >
                Изменить
              </Button>
              {row.id && (
                <Button size="sm" variant="destructive" onClick={() => void onDelete(row.id!)}>
                  Удалить
                </Button>
              )}
            </div>
          </div>
        ))}
        {!list.length && !q.isLoading && (
          <p className="text-muted-foreground text-sm">
            Пока нет правил. «+ Правило» → выбрать пост → слово → текст в ЛС.
          </p>
        )}
      </div>
    </div>
  );
}
