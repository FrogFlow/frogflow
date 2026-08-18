import { createFileRoute } from "@tanstack/react-router";
import { tg } from "@/lib/telegram.server";

async function getBotUrl(): Promise<string | null> {
  try {
    const res = await tg("getMe", {});
    const username = (res?.result as { username?: string })?.username;
    return username ? `https://t.me/${username}` : null;
  } catch {
    return null;
  }
}

function htmlPage(title: string, message: string, botUrl: string | null) {
  const redirectScript = botUrl
    ? `<meta http-equiv="refresh" content="3;url=${botUrl}" />
       <script>
         setTimeout(function() {
           window.location.href = "${botUrl}";
         }, 2000);
       </script>`
    : "";

  const buttonHtml = botUrl
    ? `<a href="${botUrl}" class="btn">Вернуться в Telegram-бот</a>`
    : `<p class="muted">Вы можете закрыть эту страницу и вернуться в мессенджер Telegram.</p>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  ${redirectScript}
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 1.5rem;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 1rem;
      padding: 2.5rem 2rem;
      max-width: 28rem;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
    }
    .icon {
      width: 4rem;
      height: 4rem;
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
      margin: 0 auto 1.5rem auto;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 0 0 0.75rem 0;
      color: #ffffff;
    }
    p {
      color: #94a3b8;
      font-size: 0.95rem;
      line-height: 1.6;
      margin: 0 0 1.75rem 0;
    }
    .muted {
      font-size: 0.85rem;
      color: #64748b;
    }
    .btn {
      display: inline-block;
      width: 100%;
      padding: 0.875rem 1.5rem;
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: #ffffff;
      font-weight: 600;
      font-size: 1rem;
      text-decoration: none;
      border-radius: 0.75rem;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
    }
    .btn:hover {
      background: linear-gradient(135deg, #dc2626, #b91c1c);
      transform: translateY(-1px);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✕</div>
    <h1>${title}</h1>
    <p>${message}</p>
    ${buttonHtml}
  </div>
</body>
</html>`;
}

async function handleFail() {
  const botUrl = await getBotUrl();
  const html = htmlPage(
    "Оплата не завершена",
    "Платёж отменён или не прошёл. Вернитесь в бот, чтобы попробовать оплатить ещё раз.",
    botUrl,
  );
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export const Route = createFileRoute("/api/public/robokassa/fail")({
  server: {
    handlers: {
      GET: async () => handleFail(),
      POST: async () => handleFail(),
    },
  },
});
