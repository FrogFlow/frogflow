import { createServerFn } from "@tanstack/react-start";
import { loadModules, botStatus, pausedMessage, emptyModules } from "./modules.server";
import { currentVerticalDef } from "@/lib/verticals/vertical.server";

/** Loaded once per navigation by the root route and put into router context — see __root.tsx. */
export const getRuntimeModulesFn = createServerFn({ method: "GET" }).handler(async () => {
  // Ниша деплоя (VERTICAL) решает, что по умолчанию выбрано в форме товара
  // при создании — см. lib/verticals/registry.ts. Читается здесь, а не
  // напрямую в компоненте: currentVerticalDef() смотрит process.env, который
  // на клиенте недоступен.
  const defaultFulfillmentKind = currentVerticalDef().defaultFulfillment;
  // Панель оператора — не деплой клиента: у неё нет своей строки в `bots`, нет
  // BOT_ID и нет ключа арендатора. Модули там неприменимы, а не «выключены»,
  // поэтому отдаём нейтральное значение, не заглядывая в базу. Для клиентского
  // деплоя отсутствие BOT_ID остаётся громкой ошибкой — там это настоящая
  // поломка конфигурации, а не штатный случай.
  if (process.env.CONTROL_PLANE === "1") {
    return {
      modules: emptyModules(),
      status: "active" as const,
      pausedMessage: "",
      isPanel: true,
      defaultFulfillmentKind,
    };
  }
  const [modules, status, paused] = await Promise.all([
    loadModules(),
    botStatus(),
    pausedMessage(),
  ]);
  return { modules, status, pausedMessage: paused, isPanel: false, defaultFulfillmentKind };
});
