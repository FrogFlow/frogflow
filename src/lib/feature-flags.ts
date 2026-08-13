/**
 * Premium add-on modules (VIP group, Instagram, blocking) are not part of
 * every client's base package. Read from an env var so the SAME codebase —
 * one repository, several Vercel projects — can turn a module on for one
 * client without forking the file: set VITE_FEATURE_<NAME> in that
 * deployment's own project settings and rebuild. Falls back to this
 * deployment's current defaults when the var isn't set, so an existing
 * deployment that predates this doesn't need every var filled in at once.
 *
 * VITE_-prefixed vars are inlined at build time (Vite's `import.meta.env`),
 * matching how VITE_SUPABASE_URL etc. already work in this codebase — so
 * "redeploy to activate" still applies, just via a project setting instead
 * of an edit to this file.
 */
function flag(name: string, fallback: boolean): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>)[`VITE_FEATURE_${name}`];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

export const FEATURE_FLAGS = {
  vip: flag("VIP", false),
  instagram: flag("INSTAGRAM", true),
  blocked: flag("BLOCKED", false),
};
