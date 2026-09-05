/**
 * Два разных идентификатора поста, которые Zernio отдаёт вперемешку.
 *
 * Comment-to-DM на конкретный пост по доке требует оба:
 *   - platformPostId — нативный media id Instagram (длинная цифра);
 *   - postId         — id записи поста в Zernio (24-символьный hex).
 *
 * listZernioPosts склеивает analytics, sync-external и /posts. У каждого
 * эндпоинта свои имена полей: analytics.postId — это как раз id Zernio,
 * а latePostId / корневой id / _id могут быть id издателя Late, id
 * аналитической строки или тем же Instagram media id. Если в правило
 * уходит не тот — карточка в админке выглядит живой (Target заполнен),
 * а движок Zernio комментарии этого рилса не подписывает.
 */

export function isInstagramMediaId(value: string | null | undefined): boolean {
  return typeof value === "string" && /^\d{10,}$/.test(value.trim());
}

export function isZernioObjectId(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value.trim());
}

function asId(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * Id записи поста в Zernio — то, что уходит в comment-automations.postId.
 *
 * Берём только 24-символьный hex. Instagram media id (цифры) и latePostId
 * (id издателя, не поста) сознательно отбрасываем: именно их раньше
 * подставляли первым, и правило сохранялось с чужим идентификатором.
 */
export function pickZernioPostId(post: {
  postId?: unknown;
  _id?: unknown;
  id?: unknown;
  _zernioPostId?: unknown;
  latePostId?: unknown;
}): string | null {
  // analytics.postId в доке Zernio — канонический id поста / External Post.
  // latePostId сюда не входит: это id Late, comment-automations его не ждут.
  for (const value of [post._zernioPostId, post.postId, post._id, post.id]) {
    const id = asId(value);
    if (isZernioObjectId(id)) return id;
  }
  return null;
}

export function describeAutomationTargetIds(
  platformPostId?: string | null,
  postId?: string | null,
): string {
  const target = platformPostId?.trim() || "нет";
  const zernio = postId?.trim() || "нет";
  let flag = "";
  if (!postId?.trim()) {
    flag = " [нет id Zernio — правило могли сохранить без обязательного postId]";
  } else if (isInstagramMediaId(postId) || postId.trim() === platformPostId?.trim()) {
    flag = " [в postId лежит Instagram id, а не id поста Zernio]";
  } else if (!isZernioObjectId(postId)) {
    flag = " [postId не похож на id Zernio]";
  }
  return `target=${target} zernioPost=${zernio}${flag}`;
}

/** Подпись типа медиа в селекте — чтобы не выбрать фото вместо рилса с тем же текстом. */
export function describePostMediaKind(post: {
  mediaProductType?: unknown;
  mediaType?: unknown;
  type?: unknown;
  _isStory?: unknown;
}): string {
  if (post._isStory === true) return "Stories";
  const raw = [post.mediaProductType, post.mediaType, post.type]
    .map((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""))
    .find(Boolean);
  if (!raw) return "";
  if (raw.includes("reel")) return "Reels";
  if (raw.includes("carousel") || raw.includes("album")) return "Карусель";
  if (raw.includes("video")) return "Видео";
  if (raw.includes("image") || raw.includes("photo") || raw === "feed") return "Фото";
  if (raw.includes("story")) return "Stories";
  return raw;
}
