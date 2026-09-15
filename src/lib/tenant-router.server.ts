declare const process: any;
import { currentVertical } from "./verticals/vertical.server";

export type ResolvedTenant = {
  bot_id: string;
  niche: string;
  username?: string;
  name?: string;
  isFallback: boolean;
};

type CacheEntry = {
  expiresAt: number;
  tenant: ResolvedTenant;
};

const CACHE_TTL_MS = 60_000;
const tenantCache = new Map<string, CacheEntry>();

export function clearTenantCache(): void {
  tenantCache.clear();
}

/**
 * Получить базовый fallback-тенант из переменных окружения.
 * Гарантирует 100% обратную совместимость для существующих одиночных деплоев (BOVI, Digital).
 */
export function defaultFallbackTenant(): ResolvedTenant {
  const envBotId = process.env.BOT_ID?.trim() || "default";
  const envNiche = process.env.VERTICAL?.trim() || currentVertical() || "digital";
  return {
    bot_id: envBotId,
    niche: envNiche,
    isFallback: true,
  };
}

/**
 * Разрешить арендатора (магазин) по входящему событию Zernio (accountId / username).
 */
export async function resolveTenant(input: {
  accountId?: string | null;
  username?: string | null;
  botId?: string | null;
}): Promise<ResolvedTenant> {
  const accountId = input.accountId?.trim() || null;
  const username = input.username?.trim().toLowerCase() || null;
  const explicitBotId = input.botId?.trim() || null;

  if (explicitBotId) {
    return {
      bot_id: explicitBotId,
      niche: process.env.VERTICAL?.trim() || "digital",
      isFallback: false,
    };
  }

  const cacheKey = accountId ? `acc:${accountId}` : username ? `user:${username}` : null;
  if (cacheKey) {
    const cached = tenantCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tenant;
    }
  }

  try {
    const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

    // 1. Поиск по zernio_account_id в bot_accounts
    if (accountId) {
      const { data: accData } = await supabaseAdmin
        .from("bot_accounts" as any)
        .select("bot_id, niche, account_username")
        .eq("zernio_account_id", accountId)
        .eq("is_active", true)
        .maybeSingle();

      if (accData && (accData as any).bot_id) {
        const resolved: ResolvedTenant = {
          bot_id: (accData as any).bot_id,
          niche: (accData as any).niche || "digital",
          username: (accData as any).account_username || undefined,
          isFallback: false,
        };
        if (cacheKey) {
          tenantCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, tenant: resolved });
        }
        return resolved;
      }

      // 2. Поиск в таблице bots (если колонка zernio_account_id есть в bots)
      const { data: botData } = await supabaseAdmin
        .from("bots")
        .select("id, niche")
        .eq("zernio_account_id" as any, accountId)
        .maybeSingle();

      if (botData && (botData as any).id) {
        const resolved: ResolvedTenant = {
          bot_id: (botData as any).id,
          niche: (botData as any).niche || "digital",
          isFallback: false,
        };
        if (cacheKey) {
          tenantCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, tenant: resolved });
        }
        return resolved;
      }
    }

    // 3. Поиск по username в bot_accounts
    if (username) {
      const { data: userAccData } = await supabaseAdmin
        .from("bot_accounts" as any)
        .select("bot_id, niche, account_username")
        .ilike("account_username", username)
        .eq("is_active", true)
        .maybeSingle();

      if (userAccData && (userAccData as any).bot_id) {
        const resolved: ResolvedTenant = {
          bot_id: (userAccData as any).bot_id,
          niche: (userAccData as any).niche || "digital",
          username: (userAccData as any).account_username || username,
          isFallback: false,
        };
        if (cacheKey) {
          tenantCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, tenant: resolved });
        }
        return resolved;
      }
    }
  } catch (err) {
    console.warn("[tenant-router] Warning during tenant resolution, using fallback:", err);
  }

  const fallback = defaultFallbackTenant();
  if (cacheKey) {
    tenantCache.set(cacheKey, { expiresAt: Date.now() + 10_000, tenant: fallback });
  }
  return fallback;
}
