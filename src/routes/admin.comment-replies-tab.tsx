import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components-ui/card";
import { Label } from "@/components-ui/label";
import { Input } from "@/components-ui/input";
import { Textarea } from "@/components-ui/textarea";
import { Button } from "@/components-ui/button";
import { Switch } from "@/components-ui/switch";
import { toast } from "sonner";
import {
  deleteCommentReplyRuleFn,
  listCommentReplyRulesFn,
  saveCommentReplyRuleFn,
} from "@/lib/comment-reply-rules.functions";
import type { CommentReplyRule } from "@/lib/comment-reply-rules";
import { errorMessage } from "@/lib/error-message";
import { Trash2 } from "lucide-react";

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
export function CommentRepliesTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);

  const rules = useQuery({
    queryKey: ["comment_reply_rules"],
    queryFn: () => listCommentReplyRulesFn(),
  });

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
              <Label className="text-xs">ID поста (необязательно)</Label>
              <Input
                value={form.platformPostId}
                onChange={(e) => setForm({ ...form, platformPostId: e.target.value })}
                placeholder="пусто — на все посты"
                className="h-9 text-sm"
              />
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
                  {rule.platformPostId ? ` · пост ${rule.platformPostId}` : " · все посты"}
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
