import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      /**
       * В подписях интерфейса стоит узкий неразрывный пробел (U+202F) как
       * разделитель разрядов — «10 000 ₸». Для русской типографики это верно,
       * и правило ругалось на неё как на случайный символ. Послабление
       * распространяется только на текст JSX: в самом коде необычный пробел
       * по-прежнему ошибка, а там он как раз и опасен.
       */
      "no-irregular-whitespace": ["error", { skipJSXText: true }],
    },
  },
  {
    /**
     * `useSession` из «@tanstack/react-start/server» — серверный хелпер работы
     * с cookie-сессией, а не React-хук: плагин react-hooks опознаёт его лишь по
     * имени на `use*` и требует React-контекста, которого на сервере нет.
     * Правило снимается только с серверных модулей — React-компонентов в них не
     * бывает по определению (`*.server.ts` не попадает в браузерный бандл), так
     * что настоящих нарушений это не спрячет.
     */
    files: ["**/*.server.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  {
    /**
     * shadcn/ui-примитивы экспортируют компонент вместе с вспомогательной
     * функцией из того же файла — `buttonVariants` (cva), `useFormField`,
     * `useSidebar` и подобные. `allowConstantExport` разрешает это для
     * простых констант, но не для функций, и предупреждение неизбежно на
     * каждом файле такого рода — их так поставляет сам shadcn/ui, и разносить
     * компонент с его вариантами по двум файлам значило бы разойтись с
     * апстримом ради устранения предупреждения о Fast Refresh в файлах,
     * которые правятся раз в год.
     */
    files: ["src/components-ui/**/*.{ts,tsx}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  eslintPluginPrettier,
);
