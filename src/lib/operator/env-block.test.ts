import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * buildEnvBlockFor() решает, какие секреты попадают в блок переменных
 * клиента. Ошибка здесь либо отдаёт лишний секрет в работающий деплой —
 * TELEGRAM_WEBHOOK_SECRET из режима "running" уронил бы бота до
 * переустановки вебхука, — либо выдаёт неполный набор для нового.
 * requireOperator() и Supabase мокаются: тестируется генерация блока,
 * а не гейт авторизации (он не завязан на данные клиента).
 */

vi.mock("./guard.server", () => ({
  requireOperator: vi.fn(async () => {}),
  operatorSessionSecretReady: vi.fn(() => true),
}));

type BotRow = {
  bot_name: string | null;
  app_url: string | null;
  modules: Record<string, boolean> | null;
};

let botRow: BotRow;

vi.mock("../../integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "bots") throw new Error(`неожиданная таблица в моке: ${table}`);
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: string) => ({
            single: async () => ({ data: botRow, error: null }),
          }),
        }),
      };
    },
  },
}));

beforeEach(() => {
  botRow = {
    bot_name: "Тест",
    app_url: "https://client.example",
    modules: { vip: false, instagram: false },
  };
  process.env.SUPABASE_JWT_SECRET = "test-jwt-secret-not-real";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
});

describe("buildEnvBlockFor", () => {
  it("режим running не отдаёт секреты и токены деплоя", async () => {
    const { buildEnvBlockFor } = await import("./env-block.server");
    const res = await buildEnvBlockFor({ botId: "bot-1", mode: "running" });
    expect(res.envBlock).not.toContain("TELEGRAM_WEBHOOK_SECRET=");
    expect(res.envBlock).not.toContain("TELEGRAM_BOT_TOKEN=");
    expect(res.envBlock).not.toContain("SESSION_SECRET=");
    expect(res.envBlock).not.toContain("ADMIN_PASSWORD=");
    expect(res.webhookSecret).toBeNull();
    expect(res.omitted.join(" ")).toContain("TELEGRAM_BOT_TOKEN");
    // Ключ арендатора и адрес деплоя — то, что можно вставить на ходу.
    expect(res.envBlock).toContain("SUPABASE_TENANT_KEY=");
    expect(res.envBlock).toContain("BOT_ID=bot-1");
  });

  it("режим new отдаёт полный набор секретов", async () => {
    const { buildEnvBlockFor } = await import("./env-block.server");
    const res = await buildEnvBlockFor({ botId: "bot-1", mode: "new" });
    expect(res.envBlock).toContain("TELEGRAM_WEBHOOK_SECRET=");
    expect(res.envBlock).toContain("SESSION_SECRET=");
    expect(res.envBlock).toContain("CRON_SECRET=");
    expect(res.envBlock).toContain("ADMIN_PASSWORD=");
    expect(res.webhookSecret).not.toBeNull();
    expect(res.omitted).toEqual([]);
  });

  it("включённый VIP без токена в режиме new — предупреждает и добавляет блок VIP", async () => {
    botRow.modules = { vip: true, instagram: false };
    const { buildEnvBlockFor } = await import("./env-block.server");
    const res = await buildEnvBlockFor({ botId: "bot-1", mode: "new" });
    expect(res.warnings.some((w) => w.includes("VIP"))).toBe(true);
    expect(res.envBlock).toContain("VIP_BOT_TOKEN=");
  });

  it("включённый Instagram без SMTP в режиме new — предупреждает про почту", async () => {
    botRow.modules = { vip: false, instagram: true };
    const { buildEnvBlockFor } = await import("./env-block.server");
    const res = await buildEnvBlockFor({ botId: "bot-1", mode: "new" });
    expect(res.warnings.some((w) => w.includes("почта"))).toBe(true);
    expect(res.envBlock).toContain("ZERNIO_API_KEY=");
    expect(res.envBlock).toContain("SMTP_HOST=");
  });

  it("Instagram в режиме running добавляет omitted-предупреждение про SMTP, а не сами значения", async () => {
    botRow.modules = { vip: false, instagram: true };
    const { buildEnvBlockFor } = await import("./env-block.server");
    const res = await buildEnvBlockFor({ botId: "bot-1", mode: "running" });
    expect(res.envBlock).not.toContain("SMTP_HOST=");
    expect(res.omitted.some((o) => o.includes("SMTP"))).toBe(true);
  });

  it("не заполненный адрес деплоя — заглушка в блоке и предупреждение", async () => {
    botRow.app_url = null;
    const { buildEnvBlockFor } = await import("./env-block.server");
    const res = await buildEnvBlockFor({ botId: "bot-1", mode: "running" });
    expect(res.envBlock).toContain("PUBLIC_APP_URL=https://<домен-проекта>");
    expect(res.warnings.some((w) => w.includes("Адрес деплоя"))).toBe(true);
  });

  it("appUrlOverride перекрывает адрес из карточки", async () => {
    botRow.app_url = "https://old.example";
    const { buildEnvBlockFor } = await import("./env-block.server");
    const res = await buildEnvBlockFor({
      botId: "bot-1",
      mode: "running",
      appUrlOverride: "https://new.example",
    });
    expect(res.envBlock).toContain("PUBLIC_APP_URL=https://new.example");
    expect(res.envBlock).not.toContain("old.example");
  });
});
