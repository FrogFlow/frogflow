import { useRouteContext } from "@tanstack/react-router";
import type { ModuleKey } from "./registry";

/** Reads the module flags the root route loaded for this deployment's bot — see __root.tsx. */
export function useModules(): Record<ModuleKey, boolean> {
  return useRouteContext({ from: "__root__" }).modules;
}
