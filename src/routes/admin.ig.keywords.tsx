import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import {
  deleteIgKeyword,
  listIgKeywords,
  listIgRecentPosts,
  resolveIgPostLink,
  runIgPollNow,
  saveIgKeyword,
} from "@/lib/ig.functions";

export const Route = createFileRoute("/admin/ig/keywords")({
  component: IgKeywordsPage,
});

type Kw = {
  id?: string;
  post_id: string;
  post_shortcode?: string | null;
  post_note?: string | null;
  keyword: string;
  reply_text: string;
  is_active: boolean;
};

const empty: Kw = { post_id: "", post_shortcode: "", post_note: "", keyword: "", reply_text: "", is_active: true };

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
  const [pollMsg, setPollMsg] = useState("");

  const thumbByPostId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of postsQ.data ?? []) {
      if (p.thumbnail_url) m.set(p.commentsPostId, p.thumbnail_url);
    }
    return m;
  }, [postsQ.data]);

  async function onSave() {
    if (!editing) return;
    setErr("");
    try {
      await saveIgKeyword({ data: editing });
      setEditing(null);
      setPasteUrl("");
      qc.invalidateQueries({ queryKey: ["ig-keywords"] });
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

  function pickPost(post: { commentsPostId: string; caption: string; shortcode?: string }) {
    if (!editing) return;
    setEditing({
      ...editing,
      post_id: post.commentsPostId,
      post_shortcode: post.shortcode || "",
      post_note: editing.post_note || post.caption.slice(0, 120) || "",
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
        post_id: post.commentsPostId,
        post_shortcode: post.shortcode || "",
        post_note: editing.post_note || post.caption || pasteUrl.trim(),
      });
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setResolving(false);
    }
  }

  async function onTestPoll() {
    setPollMsg("");
    try {
      const r = await runIgPollNow();
      setPollMsg(
        `Комментариев: ${r.scanned}, совпадений: ${r.matched}, отправлено: ${r.sent}` +
          (r.errors?.length ? ` · ${r.errors.join("; ")}` : ""),
      );
      qc.invalidateQueries({ queryKey: ["ig-log"] });
      qc.invalidateQueries({ queryKey: ["ig-dashboard"] });
    } catch (e: any) {
      setPollMsg(e?.message || String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Правила</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Пост + кодовое слово в комментарии + текст в личку. Одно правило = один сценарий.
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
                placeholder="https://www.instagram.com/p/XXXX/"
              />
              <Button type="button" variant="outline" disabled={resolving || !pasteUrl.trim()} onClick={() => void onResolveUrl()}>
                {resolving ? "…" : "Найти"}
              </Button>
            </div>
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
                  const selected = editing.post_id === p.commentsPostId;
                  return (
                    <button
                      key={p.commentsPostId}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent flex gap-3 items-start ${selected ? "bg-accent font-medium" : ""}`}
                      onClick={() => pickPost(p)}
                    >
                      {p.thumbnail_url ? (
                        <img src={p.thumbnail_url} alt="" className="w-12 h-12 object-cover rounded shrink-0 bg-muted" />
                      ) : (
                        <div className="w-12 h-12 rounded shrink-0 bg-muted flex items-center justify-center text-xs text-muted-foreground">IG</div>
                      )}
                      <div className="min-w-0">
                        <div className="line-clamp-2">{p.caption?.trim() || "Без подписи"}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {editing.post_id && editing.post_note && (
            <p className="text-xs text-muted-foreground">Выбран пост: {editing.post_note}</p>
          )}

          <div className="space-y-2">
            <Label>Кодовое слово в комментарии</Label>
            <Input value={editing.keyword} onChange={(e) => setEditing({ ...editing, keyword: e.target.value })} placeholder="прайс" />
          </div>
          <div className="space-y-2">
            <Label>Сообщение в личку автору</Label>
            <Textarea value={editing.reply_text} onChange={(e) => setEditing({ ...editing, reply_text: e.target.value })} rows={4} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
            Активно
          </label>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex gap-2">
            <Button onClick={() => void onSave()} disabled={!editing.post_id.trim()}>
              Сохранить
            </Button>
            <Button variant="outline" onClick={() => { setEditing(null); setPasteUrl(""); }}>
              Отмена
            </Button>
          </div>
        </div>
      )}

      {pollMsg && <p className="text-sm text-muted-foreground">{pollMsg}</p>}

      <div className="space-y-2">
        {list.map((row) => (
          <div key={row.id} className="bg-card border rounded-lg p-3 flex items-start justify-between gap-3">
            <div className="flex gap-3 min-w-0">
              {thumbByPostId.get(row.post_id) ? (
                <img src={thumbByPostId.get(row.post_id)} alt="" className="w-14 h-14 object-cover rounded shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded shrink-0 bg-muted flex items-center justify-center text-xs text-muted-foreground">IG</div>
              )}
              <div className="min-w-0">
                <div className="font-medium">
                  Слово «{row.keyword}» {!row.is_active && <span className="text-muted-foreground">(выкл)</span>}
                </div>
                {row.post_note && <div className="text-sm text-muted-foreground line-clamp-2">{row.post_note}</div>}
                <div className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">{row.reply_text}</div>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={() => { setEditing(row); setPasteUrl(""); void postsQ.refetch(); }}>
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
          <p className="text-muted-foreground text-sm">Пока нет правил. «+ Правило» → пост → слово → текст в ЛС.</p>
        )}
      </div>

      {list.length > 0 && (
        <Button variant="outline" onClick={() => void onTestPoll()}>
          Проверить правила сейчас
        </Button>
      )}
    </div>
  );
}
