import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components-ui/card";
import { Label } from "@/components-ui/label";
import { Input } from "@/components-ui/input";
import { Button } from "@/components-ui/button";
import { toast } from "sonner";
import { listStoryTagsFn, upsertStoryTagFn, getStoriesFn } from "@/lib/consultant/story-tags.functions";
import { errorMessage } from "@/lib/error-message";

export function StoriesTab({ accountId }: { accountId?: string }) {
  const qc = useQueryClient();
  const [manualId, setManualId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");

  const storiesQuery = useQuery({
    queryKey: ["ig_stories", accountId],
    queryFn: () => accountId ? getStoriesFn({ data: { accountId } }) : Promise.resolve([]),
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000, // cache 5 min — stories API is flaky
    refetchOnWindowFocus: false,
  });

  const tagsQuery = useQuery({
    queryKey: ["ig_story_tags"],
    queryFn: () => listStoryTagsFn(),
  });

  const upsertMutation = useMutation({
    mutationFn: (data: { storyId: string; storyUrl: string; thumbnailUrl: string; productName: string; productPriceKzt: number }) =>
      upsertStoryTagFn({ data }),
    onSuccess: () => {
      toast.success("Товар привязан к сторис");
      qc.invalidateQueries({ queryKey: ["ig_story_tags"] });
    },
    onError: (e: any) => {
      toast.error("Ошибка сохранения: " + errorMessage(e));
    },
  });

  const handleManualSave = () => {
    if (!manualId.trim() || !manualName.trim()) return;
    upsertMutation.mutate({
      storyId: manualId.trim(),
      storyUrl: "",
      thumbnailUrl: "",
      productName: manualName.trim(),
      productPriceKzt: parseInt(manualPrice) || 0,
    });
    setManualId("");
    setManualName("");
    setManualPrice("");
  };

  if (!accountId) return <div>Выберите аккаунт во вкладке "Аккаунты"</div>;

  const stories = storiesQuery.data || [];
  const tags = tagsQuery.data || [];

  return (
    <div className="space-y-6">
      {/* Manual entry card — always visible, doesn't depend on API */}
      <Card>
        <CardHeader>
          <CardTitle>Ручная привязка товара</CardTitle>
          <CardDescription>
            Введите ID сторис вручную, если автоподгрузка не сработала. ID можно скопировать из ссылки на сторис.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Label className="text-xs mb-1 block">ID сторис</Label>
              <Input value={manualId} onChange={(e: any) => setManualId(e.target.value)} placeholder="story_id или ссылка" className="h-8 text-sm" />
            </div>
            <div className="flex-1">
              <Label className="text-xs mb-1 block">Название товара</Label>
              <Input value={manualName} onChange={(e: any) => setManualName(e.target.value)} placeholder="Полотенце 70x140" className="h-8 text-sm" />
            </div>
            <div className="w-32">
              <Label className="text-xs mb-1 block">Цена (₸)</Label>
              <Input value={manualPrice} onChange={(e: any) => setManualPrice(e.target.value)} type="number" placeholder="12000" className="h-8 text-sm" />
            </div>
            <div className="flex items-end">
              <Button size="sm" disabled={!manualId.trim() || !manualName.trim() || upsertMutation.isPending} onClick={handleManualSave}>
                Сохранить
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Saved tags */}
      {tags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Привязанные товары ({tags.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {tags.map((tag: any) => (
                <div key={tag.id || tag.story_id} className="flex items-center justify-between border rounded-lg p-3">
                  <div>
                    <div className="font-medium text-sm">{tag.product_name}</div>
                    <div className="text-xs text-muted-foreground">
                      ID: {tag.story_id} {tag.product_price_kzt ? `• ${tag.product_price_kzt} ₸` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Auto-loaded stories from API */}
      <Card>
        <CardHeader>
          <CardTitle>Активные сторис из Instagram</CardTitle>
          <CardDescription>
            Автоматически подгруженные сторис. Если список пуст — используйте ручной ввод выше.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {storiesQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Загрузка...</div>
          ) : stories.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Нет активных историй из API. Используйте ручную привязку выше.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stories.map((story: any) => {
                const storyId = String(story.platformPostId || story._zernioPostId || story._id || "");
                if (!storyId) return null;

                const storyUrl = String(story.platformPostUrl || story.permalink || story._thumbnail || "");
                const thumbnailUrl = String(story._thumbnail || "");
                const existingTag = tags.find((t: any) => t.story_id === storyId || (storyUrl && t.story_url === storyUrl));

                return (
                  <StoryCard
                    key={storyId}
                    storyId={storyId}
                    storyUrl={storyUrl}
                    thumbnailUrl={thumbnailUrl}
                    existingTag={existingTag}
                    onSave={(productName: string, price: number) =>
                      upsertMutation.mutate({ storyId, storyUrl, thumbnailUrl, productName, productPriceKzt: price })
                    }
                    isSaving={upsertMutation.isPending}
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

function StoryCard({ storyId, storyUrl, thumbnailUrl, existingTag, onSave, isSaving }: any) {
  const [name, setName] = useState(existingTag?.product_name || "");
  const [price, setPrice] = useState(existingTag?.product_price_kzt?.toString() || "");

  return (
    <div className="border rounded-lg overflow-hidden flex flex-col">
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="Story thumbnail" className="w-full h-48 object-cover bg-muted" />
      ) : (
        <div className="w-full h-48 bg-muted flex items-center justify-center text-xs text-muted-foreground">Нет превью</div>
      )}
      <div className="p-3 flex flex-col gap-3">
        <div className="text-xs text-muted-foreground truncate">ID: {storyId}</div>
        <div>
          <Label className="text-xs mb-1 block">Название товара</Label>
          <Input value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Полотенце 70x140" className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs mb-1 block">Цена (₸)</Label>
          <Input value={price} onChange={(e: any) => setPrice(e.target.value)} type="number" placeholder="12000" className="h-8 text-sm" />
        </div>
        <Button size="sm" disabled={!name || isSaving} onClick={() => onSave(name, parseInt(price) || 0)}>
          {existingTag ? "Обновить" : "Сохранить"}
        </Button>
      </div>
    </div>
  );
}
