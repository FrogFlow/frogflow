#!/usr/bin/env node
/**
 * Mints the Supabase API key a single tenant's deployment uses instead of the
 * service_role key.
 *
 * The token carries `role: tenant_bot` and the tenant's `bot_id`. PostgREST
 * switches to that Postgres role, and the RLS policies from
 * MIGRATION-02 filter every query by the bot_id claim — so a deployment
 * holding this key physically cannot read or write another client's rows,
 * even if a query forgets to filter.
 *
 * Usage:
 *   SUPABASE_JWT_SECRET=… node scripts/mint-tenant-key.mjs <bot_id> [years]
 *
 * The secret is in Supabase → Settings → API → JWT Secret (legacy HS256).
 *
 * The printed token goes in SUPABASE_TENANT_KEY — alongside, not instead of,
 * SUPABASE_SERVICE_ROLE_KEY: the API gateway only accepts one of the project's
 * own keys in the `apikey` header, while the role is resolved from this token
 * in `Authorization`. Removing SUPABASE_TENANT_KEY reverts the deployment to
 * unrestricted service_role access, which makes the rollout reversible.
 */
import crypto from "node:crypto";

const secret = process.env.SUPABASE_JWT_SECRET;
const botId = process.argv[2];
const years = Number(process.argv[3] ?? 5);

if (!secret || !botId) {
  console.error(
    "Использование: SUPABASE_JWT_SECRET=… node scripts/mint-tenant-key.mjs <bot_id> [лет]",
  );
  process.exit(1);
}
if (!/^[0-9a-f-]{36}$/i.test(botId)) {
  console.error(`Некорректный bot_id: ${botId}`);
  process.exit(1);
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const now = Math.floor(Date.now() / 1000);
const header = { alg: "HS256", typ: "JWT" };
const payload = {
  role: "tenant_bot",
  bot_id: botId,
  iss: "supabase",
  iat: now,
  exp: now + Math.round(years * 365 * 24 * 60 * 60),
};

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const signature = b64url(crypto.createHmac("sha256", secret).update(signingInput).digest());

console.log(`\nbot_id : ${botId}`);
console.log(`годен до: ${new Date(payload.exp * 1000).toISOString().slice(0, 10)}\n`);
console.log(
  "Добавить в переменные окружения деплоя (SUPABASE_SERVICE_ROLE_KEY оставить как есть):\n",
);
console.log(`BOT_ID=${botId}`);
console.log(`SUPABASE_TENANT_KEY=${signingInput}.${signature}\n`);
