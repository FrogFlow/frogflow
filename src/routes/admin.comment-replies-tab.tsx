import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components-ui/card";
import { Label } from "@/components-ui/label";
import { Input } from "@/components-ui/input";
import { Textarea } from "@/components-ui/textarea";
import { Button } from "@/components-ui/button";
import { Switch } from "@/components-ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components-ui/select";
import { toast } from "sonner";
import {
  deleteCommentReplyRuleFn,
  listCommentReplyRulesFn,
  saveCommentReplyRuleFn,
} from "@/lib/comment-reply-rules.functions";
import type { CommentReplyRule } from "@/lib/comment-reply-rules";
import { getZernioPostsFn } from "@/lib/instagram.functions";
import { describePostMediaKind } from "@/lib/zernio-post-ids";
import { errorMessage } from "@/lib/error-message";
import { Image as ImageIcon, RefreshCcw, Trash2 } from "lucide-react";

const EMPTY = {
  name: "",
  keywords: "",
  matchMode: "contains" as "contains" | "exact",
  platformPostId: "",
  replies: "",
  isActive: true,
};

/**
 * Автоответы на комментарии БЕЗ сообщения в Direct.
 *
 * Отдельно от вкладки автоматизаций: там Comment-to-DM, где публичный ответ —
 * добавка к обязательному сообщению в личку. Здесь наоборот: отвечаем под
 * постом и в Direct не пишем вовсе.
 */
/** Дата публикации человеческим видом; у части постов её нет вовсе. */
function postDate(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") return "Без даты";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Без даты" : d.toLocaleDateString("ru-RU");
}

const ALL_POSTS = "__all__";

export function CommentRepliesTab({ accountId }: { accountId?: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);

  const rules = useQuery({
    queryKey: ["comment_reply_rules"],
    queryFn: () => listCommentReplyRulesFn(),
  });

  // Тот же список публикаций, что и у обычных автоматизаций: вводить id
  // поста руками неудобно и легко ошибиться.
  const posts = useQuery({
    queryKey: ["ig_posts", accountId],
    queryFn: () => getZernioPostsFn({ data: { accountId: accountId as string } }),
    enabled: Boolean(accountId),
  });
  const postList: Record<string, unknown>[] = (posts.data?.posts ?? []) as Record<
    string,
    unknown
  >[];
  const postIdOf = (p: Record<string, unknown>) =>
    String(p.platformPostId || p._id || p.id || "");
  /** Показать в списке правил подпись публикации, а не голый идентификатор. */
  const postById = (id: string) => postList.find((p) => postIdOf(p) === id);

  const save = useMutation({
    mutationFn: () =>
      saveCommentReplyRuleFn({
        data: {
          ...(editing ? { id: editing } : {}),
          name: form.name,
          keywords: form.keywords
            .split(/[,\n]/)
            .map((k) => k.trim())
            .filter(Boolean),
          matchMode: form.matchMode,
          platformPostId: form.platformPostId.trim() || null,
          replies: form.replies
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean),
          isActive: form.isActive,
        },
      }),
    onSuccess: () => {
      toast.success(editing ? "Правило обновлено" : "Правило создано");
      setForm(EMPTY);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["comment_reply_rules"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCommentReplyRuleFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Правило удалено");
      qc.invalidateQueries({ queryKey: ["comment_reply_rules"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const startEdit = (rule: CommentReplyRule) => {
    setEditing(rule.id);
    setForm({
      name: rule.name,
      keywords: rule.keywords.join(", "),
      matchMode: rule.matchMode,
      platformPostId: rule.platformPostId ?? "",
      replies: rule.replies.join("\n"),
      isActive: rule.isActive,
    });
  };

  const list: CommentReplyRule[] = rules.data ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {editing ? "Правка правила" : "Новое правило"}
            </CardTitle>
            <CardDescription>
              Бот отвечает под постом и ничего не пишет в Direct. Разрешение на переписку
              не тратится, лимиты Meta не задеваются.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Название</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Вопросы о цене"
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Ключевые слова, через запятую</Label>
              <Input
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                placeholder="цена, сколько, почём"
                className="h-9 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Оставьте пустым — правило сработает на любой комментарий.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Как сравнивать</Label>
              <select
                value={form.matchMode}
                onChange={(e) =>
                  setForm({ ...form, matchMode: e.target.value as "contains" | "exact" })
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="contains">Слово встречается в комментарии</option>
                <option value="exact">Комментарий точно равен слову</option>
              </select>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Публикация</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  disabled={!accountId || posts.isFetching}
                  onClick={() => qc.invalidateQueries({ queryKey: ["ig_posts", accountId] })}
                >
                  <RefreshCcw className="w-3 h-3 mr-1" />
                  {posts.isFetching ? "Загрузка…" : "Обновить"}
                </Button>
              </div>
              <Select
                value={form.platformPostId || ALL_POSTS}
                onValueChange={(v: string) =>
                  setForm({ ...form, platformPostId: v === ALL_POSTS ? "" : v })
                }
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="На все посты" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_POSTS}>На все посты и рилсы</SelectItem>
                  {postList.map((p) => (
                    <SelectItem key={postIdOf(p)} value={postIdOf(p)}>
                      <div className="flex items-center gap-2 py-1 max-w-[320px]">
                        {p._thumbnail ? (
                          <img
                            src={String(p._thumbnail)}
                            className="w-8 h-8 object-cover rounded shrink-0 bg-muted"
                            alt=""
                          />
                        ) : (
                          <div className="w-8 h-8 bg-muted rounded flex items-center justify-center shrink-0">
                            <ImageIcon className="w-4 h-4 opacity-40" />
                          </div>
                        )}
                        <div className="flex flex-col min-w-0 text-left">
                          <span className="text-[9px] text-muted-foreground font-bold uppercase">
                            {postDate(p._date)}
                            {describePostMediaKind(p) ? ` · ${describePostMediaKind(p)}` : ""}
                          </span>
                          <span className="text-xs truncate font-medium">
                            {String(p.caption || p.content || "Без подписи").slice(0, 60)}
                          </span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!accountId && (
                <p className="text-[11px] text-muted-foreground">
                  Аккаунт Instagram не подключён — список публикаций пуст.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Тексты ответа, по одному в строке</Label>
              <Textarea
                value={form.replies}
                onChange={(e) => setForm({ ...form, replies: e.target.value })}
                placeholder={"Ответили вам в Direct\nНаписали в личные сообщения"}
                rows={4}
                className="text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Несколько вариантов чередуются по кругу: Instagram давит одинаковые
                ответы подряд.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Switch
                checked={form.isActive}
                onCheckedChange={(v: boolean) => setForm({ ...form, isActive: v })}
              />
              <Label className="text-xs">Правило включено</Label>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="flex-1"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Сохранение..." : editing ? "Сохранить" : "Создать"}
              </Button>
              {editing && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(null);
                    setForm(EMPTY);
                  }}
                >
                  Отмена
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-7">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Правила ({list.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rules.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
            {!rules.isLoading && list.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Правил пока нет. Создайте первое слева.
              </p>
            )}
            {list.map((rule) => (
              <div key={rule.id} className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm flex-1 truncate">{rule.name}</span>
                  <span
                    className={
                      rule.isActive
                        ? "text-[11px] text-emerald-600 dark:text-emerald-400"
                        : "text-[11px] text-muted-foreground"
                    }
                  >
                    {rule.isActive ? "включено" : "выключено"}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(rule)}>
                    Править
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(rule.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {rule.keywords.length > 0
                    ? `Слова: ${rule.keywords.join(", ")} (${rule.matchMode === "exact" ? "точно" : "вхождение"})`
                    : "На любой комментарий"}
                  {rule.platformPostId
                    ? ` · ${describePostMediaKind(postById(rule.platformPostId) ?? {}) || "публикация"}: ${
                        String(
                          postById(rule.platformPostId)?.caption ||
                            postById(rule.platformPostId)?.content ||
                            rule.platformPostId,
                        ).slice(0, 40)
                      }`
                    : " · все посты"}
                </p>
                <ul className="text-xs space-y-0.5">
                  {rule.replies.map((text, i) => (
                    <li key={i} className="text-muted-foreground truncate">
                      — {text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
