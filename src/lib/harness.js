// Harness (execution engine) helpers shared by member creation, the profile
// Harness section, launch preflight, and the sidebar.

export const DEFAULT_HARNESS_ID = "autohand";
export const HARNESS_SCHEMA_VERSION = 1;

export const HARNESS_OPTIONS = [
  { id: "autohand", label: "Autohand Code", vendor: "Autohand", short: "Autohand", isDefault: true },
  { id: "codex", label: "Codex", vendor: "OpenAI", short: "Codex", isDefault: false },
  { id: "claude", label: "Claude Code", vendor: "Anthropic", short: "Claude", isDefault: false },
];

const HARNESS_ALIASES = {
  "autohand-code": "autohand",
  autohandai: "autohand",
  "openai-codex": "codex",
  "codex-cli": "codex",
  "claude-code": "claude",
  claudecode: "claude",
  anthropic: "claude",
};

export function normalizeHarnessId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return DEFAULT_HARNESS_ID;
  if (HARNESS_OPTIONS.some((option) => option.id === raw)) return raw;
  return HARNESS_ALIASES[raw] || DEFAULT_HARNESS_ID;
}

export function normalizeHarnessAssignment(input) {
  const source = input && typeof input === "object" ? input : typeof input === "string" ? { id: input } : {};
  return {
    schemaVersion: HARNESS_SCHEMA_VERSION,
    id: normalizeHarnessId(source.id || source.harnessId),
    executablePath: String(source.executablePath || "").trim(),
    model: String(source.model || "").trim().slice(0, 120),
  };
}

export function harnessOption(id) {
  const normalized = normalizeHarnessId(id);
  return HARNESS_OPTIONS.find((option) => option.id === normalized) || HARNESS_OPTIONS[0];
}

export function harnessLabel(id) {
  return harnessOption(id).label;
}

export function harnessForAgent(agent) {
  return normalizeHarnessAssignment(agent?.harness);
}

export const HARNESS_STATUS_COPY = {
  ready: "Ready",
  "setup-required": "Setup required",
  "not-detected": "Not detected",
  unsupported: "Unsupported version",
  checking: "Checking…",
  unknown: "Not checked yet",
};

export function readinessLabel(status) {
  return HARNESS_STATUS_COPY[String(status || "unknown")] || HARNESS_STATUS_COPY.unknown;
}

export function readinessTone(status) {
  switch (String(status || "")) {
    case "ready":
      return "text-emerald-700 dark:text-emerald-300";
    case "setup-required":
      return "text-amber-700 dark:text-amber-300";
    case "not-detected":
    case "unsupported":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

export function readinessFor(harnesses, id) {
  const normalized = normalizeHarnessId(id);
  return (Array.isArray(harnesses) ? harnesses : []).find((item) => item?.id === normalized) || null;
}

export function harnessBlocksLaunch(readiness) {
  return Boolean(readiness) && readiness.status !== "ready";
}

/** Fetch readiness through the app's api() helper. Returns [] on failure. */
export async function fetchHarnesses(api, { refresh = false } = {}) {
  try {
    const data = await api(`/api/harnesses${refresh ? "?refresh=1" : ""}`);
    return Array.isArray(data?.harnesses) ? data.harnesses : [];
  } catch {
    return [];
  }
}

export async function testHarness(api, assignment) {
  const normalized = normalizeHarnessAssignment(assignment);
  return api("/api/harnesses/test", { method: "POST", body: JSON.stringify(normalized) });
}
