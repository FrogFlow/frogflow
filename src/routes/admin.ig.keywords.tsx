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
  resolveIgPostLink,
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
  const [pasteUrl, setPasteUrl] = useState("");
  const [resolving, setResolving] = useState(false);

  async function onSave() {
    if (!editing) return;
    setErr("");
    try {
      await saveIgKeyword({ data: editing });
      setEditing(null);
      setPasteUrl("");
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
  }

  async function onResolveUrl() {
    if (!editing || !pasteUrl.trim()) return;
    setResolving(true);
    setErr("");
    try {
      const post = await resolveIgPostLink({ data: { url: pasteUrl.trim() } });
      setEditing({
        ...editing,
        post_id: post.id,
        post_note: editing.post_note || post.caption || pasteUrl.trim(),
      });
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Правила</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Проще всего: вставьте <strong>ссылку на пост Instagram</strong> → кодовое слово → текст в личку.
          </p>
        </div>
        {!editing && (
          <Button
            onClick={() => {
              setEditing({ ...empty });
              setPasteUrl("");
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
            <Label>Ссылка на пост Instagram</Label>
            <div className="flex gap-2">
              <Input
                value={pasteUrl}
                onChange={(e) => setPasteUrl(e.target.value)}
                placeholder="https://www.instagram.com/p/XXXX/ или /reel/XXXX/"
              />
              <Button type="button" variant="outline" disabled={resolving || !pasteUrl.trim()} onClick={() => void onResolveUrl()}>
                {resolving ? "…" : "Найти"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Скопируйте ссылку из Instagram (Share → Copy link) и нажмите «Найти».
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Или выберите из последних постов</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => void postsQ.refetch()} disabled={postsQ.isFetching}>
                {postsQ.isFetching ? "Загрузка…" : "Обновить"}
              </Button>
            </div>

            {postsQ.isError && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                {(postsQ.error as Error).message}
              </p>
            )}

            {(postsQ.data?.length ?? 0) > 0 && (
              <div className="max-h-64 overflow-y-auto border rounded-md divide-y">
                {postsQ.data!.map((p) => {
                  const selected = editing.post_id === p.id;
                  const label = (p.caption || "").trim() || "Без подписи";
                  let when = "";
                  if (p.created_at) {
                    const d = new Date(p.created_at);
                    when = Number.isNaN(d.getTime())
                      ? String(p.created_at)
                      : d.toLocaleString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
                  }
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent flex gap-3 items-start ${
                        selected ? "bg-accent font-medium" : ""
                      }`}
                      onClick={() => pickPost(p.id, p.caption || "")}
                    >
                      {p.thumbnail_url ? (
                        <img
                          src={p.thumbnail_url}
                          alt=""
                          className="w-12 h-12 object-cover rounded shrink-0 bg-muted"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded shrink-0 bg-muted flex items-center justify-center text-xs text-muted-foreground">
                          IG
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2">{label}</div>
                        {when && <div className="text-xs text-muted-foreground mt-0.5">{when}</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {!postsQ.isLoading && !postsQ.isError && !postsQ.data?.length && (
              <p className="text-sm text-muted-foreground">Список пуст — используйте ссылку выше.</p>
            )}
          </div>

          {editing.post_id && (
            <p className="text-xs text-muted-foreground">
              ID поста для слежения: <span className="font-mono break-all">{editing.post_id}</span>
            </p>
          )}

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
                setPasteUrl("");
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
                  setPasteUrl("");
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
            Пока нет правил. «+ Правило» → ссылка на пост → слово → текст в ЛС.
          </p>
        )}
      </div>
    </div>
  );
}
