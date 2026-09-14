import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components-ui/card";
import { Label } from "@/components-ui/label";
import { Input } from "@/components-ui/input";
import { Button } from "@/components-ui/button";
import { listStoryTagsFn, upsertStoryTagFn, getStoriesFn } from "@/lib/consultant/story-tags.functions";

export function StoriesTab({ accountId }: { accountId?: string }) {
  const qc = useQueryClient();
  
  const storiesQuery = useQuery({
    queryKey: ["ig_stories", accountId],
    queryFn: () => accountId ? getStoriesFn({ data: { accountId } }) : Promise.resolve([]),
    enabled: !!accountId,
  });

  const tagsQuery = useQuery({
    queryKey: ["ig_story_tags"],
    queryFn: () => listStoryTagsFn(),
  });

  const upsertMutation = useMutation({
    mutationFn: (data: { storyId: string, storyUrl: string, thumbnailUrl: string, productName: string, productPriceKzt: number }) => 
      upsertStoryTagFn({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ig_story_tags"] }),
  });

  if (!accountId) return <div>Выберите аккаунт во вкладке "Аккаунты"</div>;
  if (storiesQuery.isLoading) return <div>Загрузка историй...</div>;

  const stories = storiesQuery.data || [];
  const tags = tagsQuery.data || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Привязка товаров к сторис</CardTitle>
        <CardDescription>
          Укажите, какие товары показаны в активных историях. Если клиент ответит на сторис, бот поймёт, о каком товаре речь.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stories.length === 0 ? (
          <div className="text-sm text-muted-foreground">Нет активных историй за последние 24 часа.</div>
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
                  onSave={(productName: string, price: number) => upsertMutation.mutate({ storyId, storyUrl, thumbnailUrl, productName, productPriceKzt: price })} 
                  isSaving={upsertMutation.isPending}
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
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
