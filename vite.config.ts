import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart({
      srcDirectory: "src",
      server: { entry: "server" },
    }),
    nitro({
      vercel: {
        functionRules: {
          "/api/public/mini-app/checkout": {
            maxDuration: 60,
          },
          "/api/public/mini-app/search": {
            maxDuration: 60,
          },
          // Общий эндпоинт всех createServerFn-вызовов (TanStack Start,
          // TSS_SERVER_FN_BASE = /_serverFn). listPostCommentsFn листает
          // комментарии поста постранично — на посте с сотнями комментариев
          // это несколько последовательных обращений к Zernio подряд,
          // и дефолтный таймаут Vercel рвал запрос раньше, чем страницы
          // успевали дочитаться ("An error occurred with your deployment").
          "/_serverFn/**": {
            maxDuration: 60,
          },
        },
      },
    }),
    viteReact(),
  ],
});
