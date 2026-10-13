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

/** Explicit access wins; otherwise the member's permission level and the launch policy decide, as before. */
export function resolveAccess({ access = "", permissionMode = "", policy = "" } = {}) {
  const explicit = normalizeAccess(access);
  if (explicit) return explicit;
  if (permissionMode === "unrestricted") return "full";
  if (permissionMode === "restricted" || policy === "restricted") return "plan";
  return "write";
}
