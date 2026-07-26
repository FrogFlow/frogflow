import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import { deleteIgKeyword, listIgKeywords, saveIgKeyword } from "@/lib/ig.functions";

export const Route = createFileRoute("/admin/ig/keywords")({
  component: IgKeywordsPage,
});

type Kw = {
  id?: string;
  keyword: string;
  reply_text: string;
  is_active: boolean;
};

const empty: Kw = { keyword: "", reply_text: "", is_active: true };

function IgKeywordsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ig-keywords"], queryFn: () => listIgKeywords() });
  const list = (q.data ?? []) as Kw[];
  const [editing, setEditing] = useState<Kw | null>(null);

  async function onSave() {
    if (!editing) return;
    await saveIgKeyword({ data: editing });
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["ig-keywords"] });
  }
  async function onDelete(id: string) {
    if (!confirm("Удалить правило?")) return;
    await deleteIgKeyword({ data: { id } });
    qc.invalidateQueries({ queryKey: ["ig-keywords"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Ключевые слова</h1>
          <p className="text-sm text-muted-foreground">
            Совпадение — подстрока без учёта регистра. На совпадение отправляется reply_text в директ.
          </p>
        </div>
        {!editing && <Button onClick={() => setEditing({ ...empty })}>+ Добавить</Button>}
      </div>

      {editing && (
        <div className="bg-card border rounded-lg p-4 space-y-3 max-w-xl">
          <div className="space-y-2">
            <Label>Ключевое слово</Label>
            <Input
              value={editing.keyword}
              onChange={(e) => setEditing({ ...editing, keyword: e.target.value })}
              placeholder="прайс"
            />
          </div>
          <div className="space-y-2">
            <Label>Текст DM</Label>
            <Textarea
              value={editing.reply_text}
              onChange={(e) => setEditing({ ...editing, reply_text: e.target.value })}
              rows={4}
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
          <div key={row.id} className="bg-card border rounded-lg p-3 flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">
                «{row.keyword}» {!row.is_active && <span className="text-muted-foreground">(выкл)</span>}
              </div>
              <div className="text-sm text-muted-foreground whitespace-pre-wrap">{row.reply_text}</div>
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
          <p className="text-muted-foreground text-sm">Пока нет правил.</p>
        )}
      </div>
    </div>
  );
}
