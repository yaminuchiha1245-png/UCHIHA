// Retained temporarily as a compatibility import target for old release tooling.
// The production UI no longer serves the v41 inline runtime, so no v41-specific
// CSP hash or response hook is required. General CSP is installed by app.mjs.
export const V41_PRODUCTION_SCRIPT_HASH = null;

export function installV41ProductionCsp(app) {
  return app;
}
