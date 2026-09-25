import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components-ui/card";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Button } from "@/components-ui/button";
import { getSignedUploadUrl } from "@/lib/products.functions";
import {
  addProductMediaFn,
  listProductMediaFn,
  previewProductMediaMatchFn,
  removeProductMediaFn,
} from "@/lib/consultant-v2/media.functions";
import { errorMessage } from "@/lib/error-message";

export const PRODUCT_MEDIA_QUERY_KEY = ["consultant-product-media"];

/** Файл — прямо в хранилище по подписанной ссылке: видео больше предела запроса Vercel. */
async function uploadToStorage(file: File, onProgress: (percent: number) => void): Promise<string> {
  const { path, signedUrl } = await getSignedUploadUrl({
    data: { bucket: "product-images", filename: file.name },
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error("Ошибка сети при загрузке"));
    xhr.send(file);
  });
  return path;
}

/**
 * Фото и видео товаров для консультанта v2. Привязка — к модели (части
 * названия из прайса) и, если нужно, к цвету: номера строк прайса меняются
 * при каждой загрузке, а модель — нет.
 */
export function ProductMediaTab() {
  const qc = useQueryClient();
  const [match, setMatch] = useState("");
  const [color, setColor] = useState("");
  const [debounced, setDebounced] = useState({ match: "", color: "" });
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced({ match: match.trim(), color: color.trim() }), 400);
    return () => clearTimeout(t);
  }, [match, color]);

  const list = useQuery({ queryKey: PRODUCT_MEDIA_QUERY_KEY, queryFn: () => listProductMediaFn() });
  const preview = useQuery({
    queryKey: ["consultant-product-media-preview", debounced],
    queryFn: () =>
      previewProductMediaMatchFn({
        data: { match: debounced.match, ...(debounced.color ? { color: debounced.color } : {}) },
      }),
    enabled: debounced.match.length >= 3,
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeProductMediaFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PRODUCT_MEDIA_QUERY_KEY }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    if (match.trim().length < 3) {
      toast.error("Сначала укажите модель — часть названия из прайса");
      return;
    }
    try {
      for (const file of Array.from(files)) {
        const kind = file.type.startsWith("video/") ? "video" : "image";
        setProgress(0);
        const path = await uploadToStorage(file, setProgress);
        await addProductMediaFn({
          data: {
            match: match.trim(),
            ...(color.trim() ? { color: color.trim() } : {}),
            path,
            kind,
            name: file.name,
          },
        });
      }
      toast.success("Загружено");
      await qc.invalidateQueries({ queryKey: PRODUCT_MEDIA_QUERY_KEY });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setProgress(null);
    }
  }

  const data = list.data;
  if (data && !data.enabled) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Фото и видео товаров</CardTitle>
          <CardDescription>
            На «можно фото?» бот сам отправит покупателю снимок или видео модели. Нет фото — позовёт
            менеджера, как раньше. Модель — часть названия, как в прайсе: «Uchino Zero Twist», «Les
            Fleurs 70х140». Одно фото подходит всем размерам модели и не пропадает при новой
            загрузке прайса.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Модель (как в прайсе)</Label>
              <Input
                value={match}
                onChange={(e) => setMatch(e.target.value)}
                placeholder="Uchino Zero Twist"
              />
            </div>
            <div className="space-y-1">
              <Label>Цвет — если на фото один цвет</Label>
              <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="белый" />
            </div>
          </div>
          {debounced.match.length >= 3 && preview.data && (
            <p className="text-sm text-muted-foreground">
              {preview.data.count === 0
                ? "Ни одна позиция прайса не подходит — проверьте написание."
                : `Подходит к ${preview.data.count} поз.: ${preview.data.sample.join("; ")}${preview.data.count > preview.data.sample.length ? "…" : ""}`}
            </p>
          )}
          <div className="space-y-1">
            <Label>Фото или видео</Label>
            <Input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              disabled={progress !== null}
              onChange={(e) => {
                void onFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {progress !== null && <p className="text-sm">Загрузка… {progress}%</p>}
            <p className="text-xs text-muted-foreground">
              Instagram принимает видео до 25 МБ. Фото — до 8 МБ.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Загружено ({data?.items.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!data?.items.length ? (
            <p className="text-sm text-muted-foreground">Пока ничего.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {data.items.map((m) => (
                <div key={m.id} className="space-y-1 rounded-md border p-2">
                  {m.kind === "video" ? (
                    <video src={m.url} className="h-32 w-full rounded object-cover" muted />
                  ) : (
                    <img src={m.url} alt={m.match} className="h-32 w-full rounded object-cover" />
                  )}
                  <p className="text-xs font-medium">{m.match}</p>
                  {m.color && <p className="text-xs text-muted-foreground">цвет: {m.color}</p>}
                  <p
                    className={`text-xs ${m.matches ? "text-muted-foreground" : "text-destructive"}`}
                  >
                    {m.matches ? `позиций в прайсе: ${m.matches}` : "в прайсе не найдено"}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate(m.id)}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> Удалить
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!!data?.withoutMedia.length && (
        <Card>
          <CardHeader>
            <CardTitle>Модели без фото ({data.withoutMedia.length})</CardTitle>
            <CardDescription>Нажмите на модель — она подставится в поле выше.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {data.withoutMedia.map((model) => (
              <Button key={model} size="sm" variant="outline" onClick={() => setMatch(model)}>
                {model}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
