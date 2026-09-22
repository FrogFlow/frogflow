import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components-ui/card";
import { Label } from "@/components-ui/label";
import { Input } from "@/components-ui/input";
import { Button } from "@/components-ui/button";
import { toast } from "sonner";
import {
  listStoryTagsFn,
  upsertStoryTagFn,
  deleteStoryTagFn,
  getStoriesFn,
  getConsultantCatalogFn,
} from "@/lib/consultant/story-tags.functions";
import { getInstagramAccountsFn, getZernioPostsFn } from "@/lib/instagram.functions";
import { errorMessage } from "@/lib/error-message";
import { Trash2, RefreshCw } from "lucide-react";

export function StoriesTab({ accountId: propAccountId }: { accountId?: string }) {
  const qc = useQueryClient();
  const [manualId, setManualId] = useState("");
  const [manualSelected, setManualSelected] = useState("");

  const accountsQuery = useQuery({
    queryKey: ["instagram-accounts"],
    queryFn: () => getInstagramAccountsFn(),
    enabled: !propAccountId,
  });

  const effectiveAccountId =
    propAccountId ||
    accountsQuery.data?.accounts?.find((a: any) => (a.platform || "instagram") === "instagram")?._id ||
    "";

  const storiesQuery = useQuery({
    queryKey: ["ig_stories", effectiveAccountId],
    queryFn: () => (effectiveAccountId ? getStoriesFn({ data: { accountId: effectiveAccountId } }) : Promise.resolve([])),
    enabled: !!effectiveAccountId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const tagsQuery = useQuery({
    queryKey: ["ig_story_tags"],
    queryFn: () => listStoryTagsFn(),
  });

  const catalogQuery = useQuery({
    queryKey: ["ig_consultant_catalog"],
    queryFn: () => getConsultantCatalogFn(),
  });

  const upsertMutation = useMutation({
    mutationFn: (data: {
      storyId: string;
      storyUrl: string;
      thumbnailUrl: string;
      products: { id?: string; name: string; priceKzt: number }[];
    }) => upsertStoryTagFn({ data }),
    onSuccess: (res: any) => {
      toast.success(
        res?.saved > 1
          ? `Привязано товаров: ${res.saved}`
          : "Товар привязан к Reels / Сторис",
      );
      qc.invalidateQueries({ queryKey: ["ig_story_tags"] });
    },
    onError: (e: any) => {
      toast.error("Ошибка сохранения: " + errorMessage(e));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStoryTagFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Привязка удалена");
      qc.invalidateQueries({ queryKey: ["ig_story_tags"] });
    },
    onError: (e: any) => {
      toast.error("Ошибка удаления: " + errorMessage(e));
    },
  });

  const handleManualSave = () => {
    if (!manualId.trim() || !manualSelected) return;
    try {
      const parsed = JSON.parse(manualSelected);
      const raw = manualId.trim();
      upsertMutation.mutate({
        storyId: raw,
        storyUrl: raw.startsWith("http") ? raw : "",
        thumbnailUrl: "",
        products: [{ id: parsed.id || undefined, name: parsed.name, priceKzt: parsed.price || 0 }],
      });
      setManualId("");
      setManualSelected("");
    } catch {
      toast.error("Выберите товар из списка");
    }
  };

  /**
   * Посты и рилсы. Список историй приходит из /instagram/stories и содержит
   * только сторис — те, что живут сутки. Рилсы в нём не появляются вовсе, и
   * привязать к ним товары можно было лишь вставив ссылку руками. А отвечают
   * покупатели как раз на рилсы: они не исчезают через сутки.
   */
  const postsQuery = useQuery({
    queryKey: ["ig_posts", effectiveAccountId],
    queryFn: () => getZernioPostsFn({ data: { accountId: effectiveAccountId as string } }),
    enabled: Boolean(effectiveAccountId),
  });
  const posts = ((postsQuery.data?.posts ?? []) as any[]).filter((p) => !p._isStory);

  const stories = storiesQuery.data || [];
  const tags = tagsQuery.data || [];
  const catalog = catalogQuery.data || [];

  return (
    <div className="space-y-6">
      {/* Manual entry card */}
      <Card>
        <CardHeader>
          <CardTitle>Привязка товаров к Reels и Сторис</CardTitle>
          <CardDescription>
            Введите ссылку на Instagram Reel (например, https://www.instagram.com/reel/...) или ID публикации вручную.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Label className="text-xs mb-1 block">Ссылка на Reel / Сторис или ID</Label>
              <Input
                value={manualId}
                onChange={(e: any) => setManualId(e.target.value)}
                placeholder="https://www.instagram.com/reel/... или ID"
                className="h-9 text-sm"
              />
            </div>
            <div className="flex-1">
              <Label className="text-xs mb-1 block">Выберите товар</Label>
              <select
                value={manualSelected}
                onChange={(e) => setManualSelected(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">-- Выберите товар из каталога --</option>
                {catalog.map((p: any) => (
                  <option
                    key={p.id}
                    value={JSON.stringify({ id: p.id, name: p.name, price: p.price_kzt })}
                  >
                    {p.name} ({p.price_kzt?.toLocaleString("ru-RU")} ₸)
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button
                size="sm"
                disabled={!manualId.trim() || !manualSelected || upsertMutation.isPending}
                onClick={handleManualSave}
                className="h-9"
              >
                {upsertMutation.isPending ? "Сохранение..." : "Привязать"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Посты и рилсы: они не исчезают через сутки, и отвечают чаще всего на них */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Рилсы и посты ({posts.length})</CardTitle>
              <CardDescription>
                Не исчезают через сутки, поэтому вопросы приходят в основном по ним. Привяжите
                товары — и консультант назовёт их с ценами, когда покупатель ответит на публикацию.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => postsQuery.refetch()}
              disabled={postsQuery.isFetching}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${postsQuery.isFetching ? "animate-spin" : ""}`} />
              {postsQuery.isFetching ? "Обновление..." : "Обновить"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!effectiveAccountId ? (
            <div className="text-sm text-muted-foreground">
              Аккаунт Instagram не подключен.
            </div>
          ) : postsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Загрузка публикаций...</div>
          ) : posts.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Публикаций не нашлось. Если рилс только что вышел, используйте ручную привязку выше.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {posts.map((post: any) => {
                const postId = String(post.platformPostId || post._zernioPostId || post._id || post.id || "");
                if (!postId) return null;
                const postUrl = String(post.platformPostUrl || post.permalink || post.url || "");
                const thumbnailUrl = String(post._thumbnail || "");
                const caption = String(post.caption || post.content || "")
                  .replace(/\s+/g, " ")
                  .trim();
                // Привязка ищется и по id, и по ссылке: в ответе покупателя
                // приходит шорткод из ссылки, а не числовой идентификатор.
                const existingTag = tags.find(
                  (t: any) =>
                    t.story_id === postId ||
                    (postUrl && t.story_url === postUrl) ||
                    (postUrl && t.story_id && postUrl.includes(t.story_id)),
                );
                return (
                  <StoryCard
                    key={postId}
                    storyId={postId}
                    storyUrl={postUrl}
                    thumbnailUrl={thumbnailUrl}
                    caption={caption}
                    existingTag={existingTag}
                    catalog={catalog}
                    onSave={(products: { id?: string; name: string; priceKzt: number }[]) =>
                      upsertMutation.mutate({ storyId: postUrl || postId, storyUrl: postUrl, thumbnailUrl, products })
                    }
                    isSaving={upsertMutation.isPending}
                    onDelete={() => existingTag?.id && deleteMutation.mutate(existingTag.id)}
                    isDeleting={deleteMutation.isPending}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Saved tags */}
      {tags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Привязанные публикации ({tags.length})</CardTitle>
            <CardDescription>
              Консультант автоматически назовет эти товары и цены, когда клиент напишет из этого Reels или ответит на Stories.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-lg border">
              {tags.map((tag: any) => (
                <div
                  key={tag.id || tag.story_id}
                  className="flex items-center justify-between p-3 gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {tag.thumbnail_url ? (
                      <img
                        src={tag.thumbnail_url}
                        alt="Story"
                        className="w-12 h-12 object-cover rounded bg-muted flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground flex-shrink-0">
                        Сторис
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{tag.product_name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        ID: {tag.story_id}{" "}
                        {tag.product_price_kzt
                          ? `• ${tag.product_price_kzt.toLocaleString("ru-RU")} ₸`
                          : ""}{" "}
                        {tag.product_id ? `• товар: ${tag.product_id}` : ""}
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (confirm(`Удалить привязку «${tag.product_name}»?`)) {
                        deleteMutation.mutate(tag.id);
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Удалить
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Auto-loaded stories from API */}
      <Card>
        <CardHeader className="relative">
          <CardTitle>Активные сторис из Instagram</CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="absolute top-4 right-4"
            onClick={() => storiesQuery.refetch()}
            disabled={storiesQuery.isFetching}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${storiesQuery.isFetching ? "animate-spin" : ""}`} />
            {storiesQuery.isFetching ? "Обновление..." : "Обновить"}
          </Button>
          <CardDescription>
            Истории, опубликованные в вашем Instagram за последние 24 часа.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!effectiveAccountId ? (
            <div className="text-sm text-muted-foreground">
              Аккаунт Instagram не подключен. Подключите аккаунт в разделе Instagram.
            </div>
          ) : storiesQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Загрузка историй...</div>
          ) : stories.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Нет активных историй за последние 24 часа. Если история опубликована только что, используйте ручную привязку выше.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stories.map((story: any) => {
                const storyId = String(story.platformPostId || story._zernioPostId || story._id || "");
                if (!storyId) return null;

                const storyUrl = String(story.platformPostUrl || story.permalink || story._thumbnail || "");
                const thumbnailUrl = String(story._thumbnail || "");
                const existingTag = tags.find(
                  (t: any) => t.story_id === storyId || (storyUrl && t.story_url === storyUrl),
                );

                return (
                  <StoryCard
                    key={storyId}
                    storyId={storyId}
                    storyUrl={storyUrl}
                    thumbnailUrl={thumbnailUrl}
                    existingTag={existingTag}
                    catalog={catalog}
                    onSave={(products: { id?: string; name: string; priceKzt: number }[]) =>
                      upsertMutation.mutate({ storyId, storyUrl, thumbnailUrl, products })
                    }
                    isSaving={upsertMutation.isPending}
                    onDelete={() => existingTag?.id && deleteMutation.mutate(existingTag.id)}
                    isDeleting={deleteMutation.isPending}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StoryCard({
  storyId,
  storyUrl,
  thumbnailUrl,
  caption,
  existingTag,
  catalog,
  onSave,
  isSaving,
  onDelete,
  isDeleting,
}: any) {
  // Товаров в одной сторис бывает несколько: простыня, пододеяльник, наволочки.
  // Старые привязки хранят один товар в product_*, новые — список в products.
  const [chosen, setChosen] = useState<{ id?: string; name: string; priceKzt: number }[]>(() => {
    const saved = existingTag?.products;
    const list = Array.isArray(saved) ? saved : null;
    if (list?.length) {
      return list.map((p: any) => ({
        id: p.id || undefined,
        name: String(p.name ?? ""),
        priceKzt: Number(p.price_kzt) || 0,
      }));
    }
    return existingTag?.product_name
      ? [
          {
            id: existingTag.product_id || undefined,
            name: existingTag.product_name,
            priceKzt: Number(existingTag.product_price_kzt) || 0,
          },
        ]
      : [];
  });

  const addProduct = (value: string) => {
    if (!value) return;
    try {
      const p = JSON.parse(value);
      setChosen((prev) =>
        prev.some((c) => (c.id || c.name) === (p.id || p.name))
          ? prev
          : [...prev, { id: p.id || undefined, name: p.name, priceKzt: Number(p.price) || 0 }],
      );
    } catch {}
  };

  const handleSave = () => {
    if (chosen.length === 0) return;
    onSave(chosen);
  };

  return (
    <div className="border rounded-lg overflow-hidden flex flex-col bg-card">
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="Story thumbnail" className="w-full h-48 object-cover bg-muted" />
      ) : (
        <div className="w-full h-48 bg-muted flex items-center justify-center text-xs text-muted-foreground">
          Нет превью
        </div>
      )}
      <div className="p-3 flex flex-col gap-3 flex-1 justify-between">
        <div className="space-y-1">
          {caption ? <div className="text-xs line-clamp-2">{caption}</div> : null}
          <div className="text-xs text-muted-foreground truncate">ID: {storyId}</div>
          {existingTag && (
            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 truncate">
              ✓ Привязано товаров: {chosen.length || 1}
            </div>
          )}
        </div>
        <div className="space-y-2">
          {chosen.length > 0 && (
            <ul className="space-y-1">
              {chosen.map((c, i) => (
                <li
                  key={`${c.id ?? c.name}-${i}`}
                  className="flex items-center gap-2 rounded border bg-muted/40 px-2 py-1 text-xs"
                >
                  <span className="flex-1 truncate">
                    {c.name} ({c.priceKzt.toLocaleString("ru-RU")} ₸)
                  </span>
                  <button
                    type="button"
                    aria-label={`Убрать ${c.name}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setChosen((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Label className="text-xs mb-1 block">
              {chosen.length > 0 ? "Добавить ещё товар" : "Выберите товар"}
            </Label>
            <select
              value=""
              onChange={(e) => addProduct(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">-- Не выбрано --</option>
              {catalog.map((p: any) => (
                <option
                  key={p.id}
                  value={JSON.stringify({ id: p.id, name: p.name, price: p.price_kzt })}
                >
                  {p.name} ({p.price_kzt?.toLocaleString("ru-RU")} ₸)
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={chosen.length === 0 || isSaving}
              onClick={handleSave}
            >
              {existingTag ? "Обновить" : "Сохранить"}
            </Button>
            {existingTag && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDeleting}
                onClick={onDelete}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
