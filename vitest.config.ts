import { defineConfig } from "vitest/config";

/**
 * Отдельный конфиг, а не vite.config.ts: там подключены плагины TanStack Start
 * и Nitro, которые собирают приложение целиком — тестам это не нужно и только
 * замедляет их. Нужно ровно одно: чтобы резолвились пути вида «@/lib/…», а это
 * Vite 8 умеет сам, без vite-tsconfig-paths.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Интеграционные тесты ходят в настоящую базу и живут дольше юнитов.
    testTimeout: 30_000,
  },
});
