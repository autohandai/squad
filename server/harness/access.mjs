// Access and reasoning effort vocabulary (ADR-0114). A leaf module: the
// adapters import it and the registry re-exports it, so neither side can
// create an import cycle. Mirrors normalizeAccess / normalizeEffort /
// derivedAccess in src/lib/harness.js.
export const ACCESS_IDS = Object.freeze(["plan", "write", "full"]);

export function normalizeAccess(value) {
  const raw = String(value || "").trim().toLowerCase();
  return ACCESS_IDS.includes(raw) ? raw : "";
}

export function normalizeEffort(value) {
  const raw = String(value || "").trim().toLowerCase();
  return /^[a-z0-9-]{1,20}$/.test(raw) ? raw : "";
}

/**
 * Explicit access wins; otherwise full (ADR-0114, second revision): the
 * person asked for full access by default on every engine. The permission
 * level and the launch policy no longer force plan mode or a read-only
 * sandbox; they are still passed to Autohand's own flags.
 */
export function resolveAccess({ access = "" } = {}) {
  return normalizeAccess(access) || "full";
}
