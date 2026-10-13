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

// ACP agents (ADR-0122): `acp:<registry id>`, plus `pi` and `autohand-acp`.
// Names come from GET /api/acp/registry once the chooser has fetched it; the
// bundled ones below keep chips and notes right before that and offline.
const BUILT_IN_ACP_IDS = Object.freeze({ pi: "Pi", "autohand-acp": "Autohand Code (ACP)" });
const BUNDLED_ACP_NAMES = Object.freeze({
  "acp:autohand": "Autohand Code",
  "acp:claude-acp": "Claude Agent",
  "acp:codex-acp": "Codex",
  "acp:gemini": "Gemini CLI",
  "acp:github-copilot-cli": "Copilot",
  "acp:opencode": "OpenCode",
  "acp:cursor": "Cursor",
  "acp:grok-build": "Grok Build",
});
const acpAgents = new Map();

export function isAcpHarnessId(value) {
  const id = String(value || "").trim().toLowerCase();
  return Boolean(BUILT_IN_ACP_IDS[id]) || /^acp:[a-z0-9][a-z0-9._-]{0,60}$/.test(id);
}

export function normalizeHarnessId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return DEFAULT_HARNESS_ID;
  if (HARNESS_OPTIONS.some((option) => option.id === raw)) return raw;
  if (HARNESS_ALIASES[raw]) return HARNESS_ALIASES[raw];
  if (raw === "pi-acp") return "pi";
  if (isAcpHarnessId(raw)) return raw;
  return DEFAULT_HARNESS_ID;
}

/** Remember the registry listing so labels and chips can name every agent. */
export function registerAcpAgents(agents) {
  for (const agent of Array.isArray(agents) ? agents : []) {
    if (agent?.harnessId) acpAgents.set(String(agent.harnessId), agent);
  }
}

export function acpAgentFor(id) {
  return acpAgents.get(normalizeHarnessId(id)) || null;
}

export function listAcpAgents() {
  return Array.from(acpAgents.values());
}

/** The chooser option for an ACP id, from the registry when fetched, else the bundled name. */
export function acpOption(id) {
  const normalized = normalizeHarnessId(id);
  const agent = acpAgents.get(normalized);
  const label = agent?.name || BUILT_IN_ACP_IDS[normalized] || BUNDLED_ACP_NAMES[normalized] || normalized.replace(/^acp:/, "");
  return { id: normalized, label, vendor: agent?.authors?.[0] || "ACP", short: label, isDefault: false, acp: true, description: agent?.description || "", installed: Boolean(agent?.installed), fetchOnUse: Boolean(agent?.fetchOnUse), available: agent ? Boolean(agent.available) : true };
}

/** Fetch the registry through the app's api() helper; `refresh` forces a fetch. Returns the listing or null. */
export async function fetchAcpRegistry(api, { refresh = false } = {}) {
  try {
    const data = await api(`/api/acp/registry${refresh ? "?refresh=1" : ""}`);
    registerAcpAgents(data?.agents);
    return data || null;
  } catch {
    return null;
  }
}

/** One line under an ACP agent's name in the chooser. */
export function acpAvailabilityLabel(agent) {
  if (!agent) return "";
  if (agent.installed) return "installed";
  if (agent.fetchOnUse) return "fetched on first use";
  return "not installed";
}

// Access (ADR-0114): what a turn may do, in one vocabulary the app shows in
// each engine's own words. "" means derive it from the member's permission
// level the way the adapters always did (derivedAccess below).
export const ACCESS_IDS = Object.freeze(["plan", "write", "full"]);
export const ACCESS_COPY = Object.freeze({
  claude: {
    plan: { label: "Plan only", detail: "Reads and plans; no edits, no commands (Claude Code plan mode)." },
    write: { label: "Accept edits", detail: "Edits files; commands Claude Code would ask about are refused instead." },
    full: { label: "Full access", detail: "Every permission prompt is bypassed." },
  },
  codex: {
    plan: { label: "Read only", detail: "Read-only sandbox; nothing is written." },
    write: { label: "Workspace write", detail: "Writes inside the workspace; other folders and the network stay closed." },
    full: { label: "Full access", detail: "No sandbox and no approvals." },
  },
  autohand: {
    plan: { label: "Restricted", detail: "Deny dangerous operations." },
    write: { label: "Normal prompts", detail: "Ask on risky or unknown operations." },
    full: { label: "Yes mode", detail: "Approve non-blacklisted operations." },
  },
  acp: {
    plan: { label: "Plan only", detail: "Reads, searches and fetches are allowed; edits, deletes and commands the agent asks about are refused." },
    write: { label: "Edit in folders", detail: "Edits inside the member's folders and commands are allowed; edits elsewhere are refused." },
    full: { label: "Full access", detail: "Every permission request from the agent is allowed." },
  },
});

export function normalizeAccess(value) {
  const raw = String(value || "").trim().toLowerCase();
  return ACCESS_IDS.includes(raw) ? raw : "";
}

export function normalizeEffort(value) {
  const raw = String(value || "").trim().toLowerCase();
  return /^[a-z0-9-]{1,20}$/.test(raw) ? raw : "";
}

/**
 * The access the adapters derive when nothing explicit is chosen: full, on
 * every engine (ADR-0114, second revision, at the person's request). Plan or
 * read-only is a choice made per message or per member, never a default.
 */
export function derivedAccess() {
  return "full";
}

export function accessOption(harnessId, access) {
  const normalized = normalizeHarnessId(harnessId);
  const table = ACCESS_COPY[normalized] || (isAcpHarnessId(normalized) ? ACCESS_COPY.acp : ACCESS_COPY.autohand);
  const id = normalizeAccess(access) || "write";
  return { id, ...(table[id] || table.write) };
}

/** Model choices for a select: the engine default first, then what the bridge reported. */
export function modelChoices(readiness, { current = "" } = {}) {
  const reported = Array.isArray(readiness?.models) ? readiness.models.filter((item) => item && item.id) : [];
  const defaultLabel = readiness?.defaults?.model ? `Engine default (${readiness.defaults.model})` : "Engine default";
  const choices = [{ id: "", label: defaultLabel }, ...reported.map((item) => ({ id: String(item.id), label: String(item.label || item.id), detail: String(item.detail || "") }))];
  if (current && !choices.some((item) => item.id === current)) choices.push({ id: current, label: current, custom: true });
  return choices;
}

export function effortChoices(readiness) {
  return Array.isArray(readiness?.efforts) ? readiness.efforts.map((item) => String(item)).filter(Boolean) : [];
}

// Autohand Code's `--thinking` levels; only the moa model takes them.
export const AUTOHAND_THINKING_LEVELS = Object.freeze(["none", "normal", "extended"]);
export const AUTOHAND_THINKING_MODELS = Object.freeze(["moa"]);

/** The reasoning levels a turn can choose, for this engine and model. */
export function effortLevelsFor(harnessId, readiness, model = "") {
  const id = normalizeHarnessId(harnessId);
  if (id === "autohand") return AUTOHAND_THINKING_MODELS.includes(String(model || "").trim().toLowerCase()) ? [...AUTOHAND_THINKING_LEVELS] : [];
  return effortChoices(readiness);
}

export function normalizeHarnessAssignment(input) {
  const source = input && typeof input === "object" ? input : typeof input === "string" ? { id: input } : {};
  return {
    schemaVersion: HARNESS_SCHEMA_VERSION,
    id: normalizeHarnessId(source.id || source.harnessId),
    executablePath: String(source.executablePath || "").trim(),
    model: String(source.model || "").trim().slice(0, 120),
    effort: normalizeEffort(source.effort),
    access: normalizeAccess(source.access),
  };
}

export function harnessOption(id) {
  const normalized = normalizeHarnessId(id);
  if (isAcpHarnessId(normalized)) return acpOption(normalized);
  return HARNESS_OPTIONS.find((option) => option.id === normalized) || HARNESS_OPTIONS[0];
}

/** True when the engine takes a model name on the command line; ACP agents choose their own. */
export function harnessTakesModel(id) {
  return !isAcpHarnessId(normalizeHarnessId(id));
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

/** Sign-in copy per harness; the bridge reports the same labels in readiness.signIn. */
export function signInLabel(id) {
  switch (normalizeHarnessId(id)) {
    case "codex":
      return "Sign in with ChatGPT";
    case "claude":
      return "Sign in with your Claude account";
    default:
      return "Sign in with your Autohand account";
  }
}

export function signInAlternative(id) {
  switch (normalizeHarnessId(id)) {
    case "codex":
      return "or set OPENAI_API_KEY";
    case "claude":
      return "or set ANTHROPIC_API_KEY";
    default:
      return "or add an Autohand AI API key in Settings";
  }
}

/** True when the harness is installed but its account is missing. */
export function harnessNeedsSignIn(readiness) {
  return Boolean(readiness) && readiness.status === "setup-required";
}

/** Start the vendor's browser sign-in flow through the bridge. */
export async function startHarnessLogin(api, id) {
  return api("/api/harnesses/login", { method: "POST", body: JSON.stringify({ id: normalizeHarnessId(id) }) });
}

export async function harnessLoginStatus(api, id) {
  return api(`/api/harnesses/login?id=${encodeURIComponent(normalizeHarnessId(id))}`);
}

export async function cancelHarnessLogin(api, id) {
  return api(`/api/harnesses/login?id=${encodeURIComponent(normalizeHarnessId(id))}`, { method: "DELETE" });
}
