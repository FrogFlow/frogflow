import { createServerFn } from "@tanstack/react-start";
import { loadModules, botStatus, pausedMessage } from "./modules.server";

/** Loaded once per navigation by the root route and put into router context — see __root.tsx. */
export const getRuntimeModulesFn = createServerFn({ method: "GET" }).handler(async () => {
  const [modules, status, paused] = await Promise.all([loadModules(), botStatus(), pausedMessage()]);
  return { modules, status, pausedMessage: paused };
});
