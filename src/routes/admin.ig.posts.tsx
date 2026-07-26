import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import { deleteIgWatchedPost, listIgWatchedPosts, saveIgWatchedPost } from "@/lib/ig.functions";

export const Route = createFileRoute("/admin/ig/posts")({
  component: IgPostsPage,
});

type Post = {
  id?: string;
  post_id: string;
  caption_snapshot?: string | null;
  is_active: boolean;
};

const empty: Post = { post_id: "", caption_snapshot: "", is_active: true };

function IgPostsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ig-posts"], queryFn: () => listIgWatchedPosts() });
  const list = (q.data ?? []) as Post[];
  const [editing, setEditing] = useState<Post | null>(null);

  async function onSave() {
    if (!editing) return;
    await saveIgWatchedPost({ data: editing });
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["ig-posts"] });
  }
  async function onDelete(id: string) {
    if (!confirm("Убрать пост из слежения?")) return;
    await deleteIgWatchedPost({ data: { id } });
    qc.invalidateQueries({ queryKey: ["ig-posts"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Посты в слежении</h1>
          <p className="text-sm text-muted-foreground">
            post_id — идентификатор поста в Unipile (List comments). Cron опрашивает комментарии раз в 1–2 мин.
          </p>
        </div>
        {!editing && <Button onClick={() => setEditing({ ...empty })}>+ Добавить</Button>}
      </div>

      {editing && (
        <div className="bg-card border rounded-lg p-4 space-y-3 max-w-xl">
          <div className="space-y-2">
            <Label>Unipile post_id</Label>
            <Input
              value={editing.post_id}
              onChange={(e) => setEditing({ ...editing, post_id: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Заметка / caption (опционально)</Label>
            <Textarea
              value={editing.caption_snapshot || ""}
              onChange={(e) => setEditing({ ...editing, caption_snapshot: e.target.value })}
              rows={2}
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
          <div className="flex gap-2">
            <Button onClick={() => void onSave()}>Сохранить</Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Отмена
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {list.map((row) => (
          <div key={row.id} className="bg-card border rounded-lg p-3 flex justify-between gap-3">
            <div>
              <div className="font-mono text-sm">{row.post_id}</div>
              {row.caption_snapshot && (
                <div className="text-sm text-muted-foreground">{row.caption_snapshot}</div>
              )}
              {!row.is_active && <span className="text-xs text-muted-foreground">выкл</span>}
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
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
          <p className="text-muted-foreground text-sm">Список пуст.</p>
        )}
      </div>
    </div>
  );
}
