/**
 * Zernio API Client for Instagram & Multi-channel Integration
 */

function getZernioKey(): string {
  const key = process.env.ZERNIO_API_KEY?.trim();
  if (!key) {
    throw new Error("ZERNIO_API_KEY environment variable is not configured");
  }
  return key;
}

function getZernioBaseUrl(): string {
  return (process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1").replace(/\/$/, "");
}

export type ZernioProfile = {
  _id: string;
  name: string;
  description?: string;
};

export type ZernioAccount = {
  _id: string;
  platform: string;
  name?: string;
  username?: string;
  profileId?: string;
  isExpired?: boolean;
  metadata?: Record<string, unknown>;
};

export type ZernioCommentAutomation = {
  id?: string;
  _id?: string;
  title: string;
  keywords: string[];
  replyText: string;
  dmText?: string;
  postId?: string;
  isActive?: boolean;
};

export type ZernioWebhookMessagePayload = {
  event: "message.received" | "comment.received" | "account.connected" | string;
  id?: string;
  data?: {
    conversationId?: string;
    accountId?: string;
    senderId?: string;
    senderUsername?: string;
    senderName?: string;
    message?: string;
    mediaUrl?: string;
    commentId?: string;
    postId?: string;
    commentText?: string;
    instagramProfile?: {
      isFollower?: boolean;
      isFollowing?: boolean;
      followerCount?: number;
      isVerified?: boolean;
    };
  };
};

async function zernioRequest<T>(
  endpoint: string,
  options: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const apiKey = getZernioKey();
  const baseUrl = getZernioBaseUrl();

  let url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  if (options.query) {
    const params = new URLSearchParams(options.query);
    url += `?${params.toString()}`;
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[zernio] API request error ${response.status} on ${endpoint}:`, text);
    throw new Error(`Zernio API Error ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

/**
 * Получить список профилей Zernio или создать дефолтный профиль магазина.
 */
export async function ensureDefaultZernioProfile(): Promise<ZernioProfile> {
  try {
    const listRes = await zernioRequest<{ profiles: ZernioProfile[] }>("/profiles");
    if (listRes.profiles && listRes.profiles.length > 0) {
      return listRes.profiles[0];
    }
  } catch (e) {
    console.warn("[zernio] failed to list profiles, attempting create...", e);
  }

  const createRes = await zernioRequest<{ profile: ZernioProfile }>("/profiles", {
    method: "POST",
    body: {
      name: "Store Main Profile",
      description: "Default profile for Instagram Bot Store",
    },
  });

  return createRes.profile;
}

/**
 * Сгенерировать официальную ссылку авторизации Zernio OAuth (Connect Link) для Instagram.
 */
export async function getZernioConnectUrl(
  platform = "instagram",
  profileId?: string,
  redirectUrl?: string,
): Promise<{ authUrl: string }> {
  let targetProfileId = profileId;
  if (!targetProfileId) {
    const defaultProfile = await ensureDefaultZernioProfile();
    targetProfileId = defaultProfile._id;
  }

  const query: Record<string, string> = { profileId: targetProfileId };
  if (redirectUrl) {
    query.redirect_url = redirectUrl;
  }

  const res = await zernioRequest<{ authUrl: string }>(`/connect/${platform}`, {
    query,
  });

  return res;
}

/**
 * Получить список привязанных соц. аккаунтов.
 */
export async function listZernioAccounts(profileId?: string): Promise<ZernioAccount[]> {
  try {
    const query: Record<string, string> = {};
    if (profileId) query.profileId = profileId;
    const res = await zernioRequest<{ accounts: ZernioAccount[] }>("/accounts", { query });
    return res.accounts || [];
  } catch (e) {
    console.error("[zernio] listZernioAccounts error", e);
    return [];
  }
}

/**
 * Отправить личное сообщение в Instagram Direct (Zernio Inbox API).
 */
export async function sendZernioInboxMessage(
  conversationId: string,
  accountId: string,
  message: string,
  attachmentUrl?: string,
  attachmentType?: "image" | "video" | "audio",
): Promise<{ ok: boolean }> {
  try {
    const body: Record<string, unknown> = {
      accountId,
      message,
      messagingType: "MESSAGE_TAG",
      messageTag: "HUMAN_AGENT",
    };

    if (attachmentUrl) {
      body.attachmentUrl = attachmentUrl;
      body.attachmentType = attachmentType || "image";
    }

    await zernioRequest(`/inbox/conversations/${conversationId}/messages`, {
      method: "POST",
      body,
    });
    return { ok: true };
  } catch (e) {
    console.error(`[zernio] sendZernioInboxMessage failed for conversation ${conversationId}`, e);
    return { ok: false };
  }
}

/**
 * Ответить на комментарий под постом/Reels в Instagram.
 */
export async function replyToInstagramComment(
  postId: string,
  commentId: string,
  accountId: string,
  message: string,
): Promise<{ ok: boolean }> {
  try {
    await zernioRequest(`/inbox/comments/${postId}`, {
      method: "POST",
      body: {
        accountId,
        commentId,
        message,
      },
    });
    return { ok: true };
  } catch (e) {
    console.error(`[zernio] replyToInstagramComment failed for post ${postId}`, e);
    return { ok: false };
  }
}

/**
 * Отправить личное сообщение в DM по комментарию (Comment-to-DM Private Reply).
 */
export async function sendInstagramPrivateReply(
  commentId: string,
  accountId: string,
  message: string,
): Promise<{ ok: boolean }> {
  try {
    await zernioRequest(`/inbox/comments/private-reply`, {
      method: "POST",
      body: {
        accountId,
        commentId,
        message,
      },
    });
    return { ok: true };
  } catch (e) {
    console.error(`[zernio] sendInstagramPrivateReply failed for comment ${commentId}`, e);
    return { ok: false };
  }
}

/**
 * Зарегистрировать Webhook в Zernio на наш публичный эндпоинт.
 */
export async function registerZernioWebhook(webhookUrl: string): Promise<{ ok: boolean }> {
  try {
    await zernioRequest("/webhooks/settings", {
      method: "POST",
      body: {
        name: "Instagram Store Webhook",
        url: webhookUrl,
        events: ["message.received", "comment.received", "account.connected"],
        isActive: true,
      },
    });
    return { ok: true };
  } catch (e) {
    console.error("[zernio] registerZernioWebhook failed", e);
    return { ok: false };
  }
}

/**
 * Опубликовать Пост / Карточку в Instagram.
 */
export async function publishZernioPost(
  accountId: string,
  content: string,
  mediaUrls: string[] = [],
): Promise<{ ok: boolean; postId?: string }> {
  try {
    const body: Record<string, unknown> = {
      content,
      publishNow: true,
      platforms: [
        {
          platform: "instagram",
          accountId,
        },
      ],
    };

    if (mediaUrls.length > 0) {
      body.media = mediaUrls.map((url) => ({ url }));
    }

    const res = await zernioRequest<{ post: { _id: string } }>("/posts", {
      method: "POST",
      body,
    });

    return { ok: true, postId: res.post?._id };
  } catch (e) {
    console.error("[zernio] publishZernioPost failed", e);
    return { ok: false };
  }
}
