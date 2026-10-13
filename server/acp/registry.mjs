// The ACP registry (ADR-0122): the published list of agents that speak the
// Agent Client Protocol, cached on disk, with a bundled snapshot so the
// engine chooser works offline, and a cheap "is it installed" check per
// entry. Nothing here spawns a process: detection is a PATH lookup, and an
// agent that is not installed but distributed through npx or uvx is
// "fetched on first use" by the launcher itself.
//
// Registry format read on 2026-10-14 from
// https://github.com/agentclientprotocol/registry/blob/main/FORMAT.md:
//   { version, agents: [{ id, name, version, description, repository,
//     website, authors, license, license_url, icon,
//     distribution: { npx: { package, args }, uvx: { package, args },
//                     binary: { "<platform>": { archive, sha256, cmd, args, env } } } }] }

import { readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findExecutable, redactHome } from "../harness/discovery.mjs";

export const REGISTRY_URL = String(process.env.AUTOHAND_ACP_REGISTRY_URL || "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json");
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 6000;

const here = dirname(fileURLToPath(import.meta.url));
const bundled = JSON.parse(readFileSync(join(here, "bundled-registry.json"), "utf8"));

/** Harness ids that are ACP agents but carry their own short id. */
export const BUILT_IN_IDS = Object.freeze({ pi: "pi", "autohand-acp": "autohand-acp" });

// Registry entries that are folded into a built-in id (the registry's
// `pi-acp` is the adapter the `pi` engine launches).
const FOLDED = Object.freeze({ "pi-acp": "pi" });

// The bin an npm package installs, when it is not the unscoped package name.
const KNOWN_BINS = Object.freeze({
  autohand: "autohand-acp",
  "claude-acp": "claude-agent-acp",
  "codex-acp": "codex-acp",
  gemini: "gemini",
  "github-copilot-cli": "copilot",
  "grok-build": "grok",
  "pi-acp": "pi-acp",
  "qwen-code": "qwen",
  "mistral-vibe": "vibe",
  "factory-droid": "droid",
  opencode: "opencode",
  cursor: "cursor-agent",
});

let stateDir = process.env.AUTOHAND_SQUAD_HOME
  ? resolve(process.env.AUTOHAND_SQUAD_HOME)
  : join(process.env.AUTOHAND_HOME ? resolve(process.env.AUTOHAND_HOME) : join(homedir(), ".autohand"), "squad");

export function configureAcpRegistry({ stateDir: dir } = {}) {
  if (dir) stateDir = resolve(dir);
}

export function registryCachePath() {
  return join(stateDir, "acp", "registry.json");
}

export function platformTarget(platform = process.platform, arch = process.arch) {
  const os = platform === "darwin" ? "darwin" : platform === "win32" ? "windows" : "linux";
  const cpu = arch === "arm64" ? "aarch64" : "x86_64";
  return `${os}-${cpu}`;
}

export function harnessIdFor(agentId) {
  const id = String(agentId || "").trim();
  if (BUILT_IN_IDS[id]) return id;
  return `acp:${id}`;
}

export function agentIdFromHarnessId(harnessId) {
  const id = String(harnessId || "").trim().toLowerCase();
  if (BUILT_IN_IDS[id]) return id;
  if (FOLDED[id]) return FOLDED[id];
  return id.startsWith("acp:") ? id.slice(4) : "";
}

export function isAcpHarnessId(value) {
  const id = String(value || "").trim().toLowerCase();
  return Boolean(BUILT_IN_IDS[id]) || /^acp:[a-z0-9][a-z0-9._-]{0,60}$/.test(id);
}

function unscopedPackageName(spec) {
  const text = String(spec || "").trim();
  const withoutVersion = text.startsWith("@") ? text.replace(/(@[^@/]+\/[^@]+)@.*$/, "$1") : text.replace(/@.*$/, "");
  return withoutVersion.includes("/") ? withoutVersion.split("/").pop() : withoutVersion;
}

/** Pure: one registry entry in the shape the rest of the app reads. */
export function normalizeAgent(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,60}$/.test(id)) return null;
  const distribution = entry.distribution && typeof entry.distribution === "object" ? entry.distribution : {};
  return {
    id,
    name: String(entry.name || id).trim().slice(0, 80),
    version: String(entry.version || "").trim().slice(0, 40),
    description: String(entry.description || "").trim().replace(/\s+/g, " ").slice(0, 200),
    repository: String(entry.repository || "").trim(),
    website: String(entry.website || entry.repository || "").trim(),
    authors: Array.isArray(entry.authors) ? entry.authors.map((item) => String(item)).slice(0, 4) : [],
    license: String(entry.license || "").trim(),
    icon: String(entry.icon || "").trim(),
    distribution: {
      npx: distribution.npx && typeof distribution.npx === "object" ? { package: String(distribution.npx.package || ""), args: Array.isArray(distribution.npx.args) ? distribution.npx.args.map(String) : [] } : null,
      uvx: distribution.uvx && typeof distribution.uvx === "object" ? { package: String(distribution.uvx.package || ""), args: Array.isArray(distribution.uvx.args) ? distribution.uvx.args.map(String) : [] } : null,
      binary: distribution.binary && typeof distribution.binary === "object" ? distribution.binary : null,
    },
    // Reasoning levels are only shown when the entry says so; no published
    // entry does today, so the slider stays hidden for ACP agents.
    efforts: Array.isArray(entry.efforts) ? entry.efforts.map(String) : [],
  };
}

function builtInAgents(agents) {
  const piAdapter = agents.find((agent) => agent.id === "pi-acp");
  return [
    {
      id: "pi",
      name: "Pi",
      version: piAdapter?.version || "",
      description: "Mario Zechner's pi coding agent, through the pi-acp adapter from the registry.",
      repository: "https://github.com/earendil-works/pi",
      website: "https://github.com/earendil-works/pi",
      authors: ["Mario Zechner"],
      license: "MIT",
      icon: piAdapter?.icon || "",
      distribution: { npx: { package: piAdapter?.distribution?.npx?.package || "pi-acp", args: [] }, uvx: null, binary: null },
      requires: "pi",
      efforts: [],
      builtIn: true,
    },
    {
      id: "autohand-acp",
      name: "Autohand Code (ACP)",
      version: "",
      description: "The Autohand CLI speaking the Agent Client Protocol (autohand --acp).",
      repository: "https://github.com/autohandai/code-cli",
      website: "https://www.autohand.ai/cli/",
      authors: ["Autohand AI"],
      license: "",
      icon: "",
      distribution: { npx: null, uvx: null, binary: null },
      command: "autohand",
      commandArgs: ["--acp"],
      efforts: [],
      builtIn: true,
    },
  ];
}

/** Pure: the published list plus the built-in Pi and Autohand (ACP) entries, folded entries removed. */
export function normalizeRegistry(raw) {
  const list = Array.isArray(raw?.agents) ? raw.agents : [];
  const agents = list.map(normalizeAgent).filter(Boolean);
  const visible = agents.filter((agent) => !FOLDED[agent.id]);
  return { version: String(raw?.version || ""), agents: [...builtInAgents(agents), ...visible] };
}

/**
 * Pure given a lookup: how this agent is started on this machine. `installed`
 * means its own executable is on the PATH; `fetchOnUse` means npx or uvx will
 * download it the first time; neither means the person has to install it.
 */
export function launchFor(agent, { platform = platformTarget(), explicitPath = "", find = findExecutable, context = {} } = {}) {
  const none = (detail, setup = "") => ({ kind: "", command: "", args: [], installed: false, fetchOnUse: false, available: false, executableName: "", detail, setup });
  if (!agent) return none("Unknown agent.");
  if (explicitPath) {
    const exe = find("", { explicitPath });
    return exe
      ? { kind: "explicit", command: exe, args: agent.commandArgs || agent.distribution?.npx?.args || [], installed: true, fetchOnUse: false, available: true, executableName: basename(exe), detail: `Runs ${redactHome(exe)}.`, setup: "" }
      : none(`${explicitPath} was not found.`);
  }
  if (agent.command) {
    const exe = String(context.autohandPath || "") || find(agent.command);
    return exe
      ? { kind: "binary", command: exe, args: [...(agent.commandArgs || [])], installed: true, fetchOnUse: false, available: true, executableName: agent.command, detail: `Runs ${agent.command} ${(agent.commandArgs || []).join(" ")}`.trim() + ".", setup: "" }
      : none(`${agent.name} was not found on this machine.`, "Install the Autohand CLI.");
  }
  if (agent.requires && !find(agent.requires)) {
    return none(`${agent.requires} is not installed; the adapter needs it.`, `npm install -g @earendil-works/pi-coding-agent`);
  }
  const { npx, uvx, binary } = agent.distribution || {};
  if (npx?.package) {
    const bin = KNOWN_BINS[agent.id] || unscopedPackageName(npx.package);
    const exe = find(bin);
    if (exe) return { kind: "npx", command: exe, args: [...npx.args], installed: true, fetchOnUse: false, available: true, executableName: bin, detail: `Installed (${redactHome(exe)}).`, setup: "" };
    const runner = find("npx");
    if (runner) return { kind: "npx", command: runner, args: ["-y", npx.package, ...npx.args], installed: false, fetchOnUse: true, available: true, executableName: "npx", detail: `Fetched on first use (npx ${npx.package}).`, setup: "" };
    return none("npx is not available, so the package cannot be fetched.", `npm install -g ${npx.package}`);
  }
  if (uvx?.package) {
    const bin = KNOWN_BINS[agent.id] || unscopedPackageName(uvx.package);
    const exe = find(bin);
    if (exe) return { kind: "uvx", command: exe, args: [...uvx.args], installed: true, fetchOnUse: false, available: true, executableName: bin, detail: `Installed (${redactHome(exe)}).`, setup: "" };
    const runner = find("uvx");
    if (runner) return { kind: "uvx", command: runner, args: [uvx.package, ...uvx.args], installed: false, fetchOnUse: true, available: true, executableName: "uvx", detail: `Fetched on first use (uvx ${uvx.package}).`, setup: "" };
    return none("uvx is not available, so the package cannot be fetched.", "Install uv (https://docs.astral.sh/uv/).");
  }
  if (binary) {
    const target = binary[platform];
    if (!target) return none(`${agent.name} has no build for ${platform}.`);
    const cmd = String(target.cmd || "").replace(/\\/g, "/");
    const bin = basename(cmd).replace(/\.(cmd|exe)$/i, "");
    const exe = KNOWN_BINS[agent.id] ? find(KNOWN_BINS[agent.id]) || find(bin) : find(bin);
    if (exe) return { kind: "binary", command: exe, args: Array.isArray(target.args) ? target.args.map(String) : [], installed: true, fetchOnUse: false, available: true, executableName: bin, detail: `Installed (${redactHome(exe)}).`, setup: "" };
    return none(`${agent.name} is not installed; Squad does not download binaries yet.`, `Install ${agent.name} from ${agent.website || target.archive || "its website"} so that \`${bin}\` is on the PATH.`);
  }
  return none(`${agent.name} has no distribution Squad can launch.`);
}

// ---------------------------------------------------------------------------
// Loading: cache on disk, refreshed at most daily and only when asked.
// ---------------------------------------------------------------------------

let memo = null;

function cacheStamp() {
  try {
    return String(statSync(registryCachePath()).mtimeMs);
  } catch {
    return "";
  }
}

async function readCache() {
  try {
    const parsed = JSON.parse(await readFile(registryCachePath(), "utf8"));
    if (!Array.isArray(parsed?.registry?.agents)) return null;
    return { fetchedAt: String(parsed.fetchedAt || ""), registry: parsed.registry, url: String(parsed.url || "") };
  } catch {
    return null;
  }
}

async function writeCache(registry, fetchedAt) {
  const path = registryCachePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ fetchedAt, url: REGISTRY_URL, registry }, null, 2), "utf8");
}

async function fetchRegistry(fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(REGISTRY_URL, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`registry answered ${response.status}`);
    const parsed = await response.json();
    if (!Array.isArray(parsed?.agents)) throw new Error("registry has no agents list");
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The registry as the app sees it. `network: false` never fetches (readiness
 * checks); `refresh: true` fetches even when the cache is fresh (the Re-check
 * button); otherwise a fetch happens only when the cache is missing or older
 * than a day, which is when the engine chooser opens. On any failure the cache,
 * then the bundled snapshot, answers, and `error` says why.
 */
export async function loadRegistry({ refresh = false, network = true, fetchImpl } = {}) {
  const stamp = cacheStamp();
  if (!refresh && memo && memo.stamp === stamp && (!network || !memo.stale)) return memo.value;
  const cache = await readCache();
  const age = cache?.fetchedAt ? Date.now() - Date.parse(cache.fetchedAt) : Number.POSITIVE_INFINITY;
  const stale = !(age < REFRESH_AFTER_MS);
  let value;
  if (network && (refresh || stale)) {
    try {
      const raw = await fetchRegistry(fetchImpl);
      const fetchedAt = new Date().toISOString();
      await writeCache(raw, fetchedAt).catch(() => {});
      value = { ...normalizeRegistry(raw), fetchedAt, source: "network", stale: false, error: "" };
    } catch (error) {
      value = cache
        ? { ...normalizeRegistry(cache.registry), fetchedAt: cache.fetchedAt, source: "cache", stale, error: `Could not refresh the registry: ${error?.message || error}` }
        : { ...normalizeRegistry(bundled), fetchedAt: String(bundled.snapshotAt || ""), source: "bundled", stale: true, error: `Could not fetch the registry: ${error?.message || error}` };
    }
  } else if (cache) {
    value = { ...normalizeRegistry(cache.registry), fetchedAt: cache.fetchedAt, source: "cache", stale, error: "" };
  } else {
    value = { ...normalizeRegistry(bundled), fetchedAt: String(bundled.snapshotAt || ""), source: "bundled", stale: true, error: "" };
  }
  memo = { stamp: cacheStamp(), stale: value.stale, value };
  return value;
}

/** Synchronous view for callers that only need names: bundled plus whatever the cache holds. */
export function knownAgentsSync() {
  if (memo?.value?.agents) return memo.value.agents;
  try {
    const parsed = JSON.parse(readFileSync(registryCachePath(), "utf8"));
    if (Array.isArray(parsed?.registry?.agents)) return normalizeRegistry(parsed.registry).agents;
  } catch {}
  return normalizeRegistry(bundled).agents;
}

export function findAgentSync(harnessId) {
  const agentId = agentIdFromHarnessId(harnessId);
  return knownAgentsSync().find((agent) => agent.id === agentId) || null;
}

/** The public listing for GET /api/acp/registry. Launch commands are redacted to their names. */
export async function listAcpAgents({ refresh = false, network = true, context = {}, fetchImpl } = {}) {
  const registry = await loadRegistry({ refresh, network, fetchImpl });
  const platform = platformTarget();
  const agents = registry.agents.map((agent) => {
    const launch = launchFor(agent, { platform, context });
    return {
      id: agent.id,
      harnessId: harnessIdFor(agent.id),
      name: agent.name,
      description: agent.description,
      version: agent.version,
      website: agent.website,
      repository: agent.repository,
      authors: agent.authors,
      icon: agent.icon,
      builtIn: Boolean(agent.builtIn),
      installed: launch.installed,
      fetchOnUse: launch.fetchOnUse,
      available: launch.available,
      efforts: agent.efforts,
      launch: launch.available ? { kind: launch.kind, command: redactHome(launch.command), args: launch.args } : null,
      detail: launch.detail,
      setup: launch.setup,
      source: agent.builtIn ? "built-in" : registry.source,
    };
  });
  return { agents, fetchedAt: registry.fetchedAt, source: registry.source, stale: registry.stale, error: registry.error, version: registry.version, url: REGISTRY_URL };
}
