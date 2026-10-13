// Installing Squad's lifecycle hooks into Claude Code and Codex (ADR-0127).
//
// Both engines read the same shape: an object with `hooks`, keyed by event
// name, each a list of `{ matcher?, hooks: [{ type: "command", command }] }`.
// Claude Code keeps it in <CLAUDE_CONFIG_DIR or ~/.claude>/settings.json next
// to the person's other settings; Codex in <CODEX_HOME or ~/.codex>/hooks.json.
// Squad only ever adds or removes its own entries (recognised by the
// forwarder's path) and leaves every other hook and setting as it found it.
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const HOOK_ENGINES = Object.freeze(["claude", "codex"]);
export const HOOK_EVENTS = Object.freeze(["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"]);
export const FORWARDER_MARK = "server/hooks/forward.mjs";
const MATCHED_EVENTS = new Set(["PostToolUse"]);

export function hookConfigPath(engine, env = process.env, home = homedir()) {
  if (engine === "codex") return join(env.CODEX_HOME || join(home, ".codex"), "hooks.json");
  return join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "settings.json");
}

const quote = (value) => `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`;

/** The command a hook runs: the bridge's own node and forwarder, the engine and the port. */
export function forwarderCommand({ nodePath, rootDir, engine, port }) {
  return `${quote(nodePath)} ${quote(join(rootDir, FORWARDER_MARK))} ${engine} ${Number(port) || 19821}`;
}

const isOurs = (entry) => String(entry?.command || "").includes(FORWARDER_MARK);

/** Pure: is any Squad hook present? */
export function hooksInstalled(config) {
  const hooks = config?.hooks && typeof config.hooks === "object" ? config.hooks : {};
  return Object.values(hooks).some((groups) => Array.isArray(groups) && groups.some((group) => (group?.hooks || []).some(isOurs)));
}

/** Pure: the config without Squad's entries; groups emptied by that are dropped. */
export function withoutSquadHooks(config) {
  const next = { ...(config || {}) };
  const hooks = next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks) ? { ...next.hooks } : {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map((group) => (Array.isArray(group?.hooks) ? { ...group, hooks: group.hooks.filter((entry) => !isOurs(entry)) } : group))
      .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length);
    if (kept.length) hooks[event] = kept; else delete hooks[event];
  }
  if (Object.keys(hooks).length) next.hooks = hooks; else delete next.hooks;
  return next;
}

/** Pure: the config with Squad's entries for every event, replacing older ones. */
export function withSquadHooks(config, command) {
  const next = withoutSquadHooks(config);
  const hooks = { ...(next.hooks || {}) };
  for (const event of HOOK_EVENTS) {
    const group = { ...(MATCHED_EVENTS.has(event) ? { matcher: "*" } : {}), hooks: [{ type: "command", command }] };
    hooks[event] = [...(Array.isArray(hooks[event]) ? hooks[event] : []), group];
  }
  return { ...next, hooks };
}

async function readConfig(path) {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Object.assign(new Error(`${path} is not a JSON object; nothing was changed`), { status: 409 });
    return { config: parsed, existed: true };
  } catch (error) {
    if (error?.code === "ENOENT") return { config: {}, existed: false };
    if (error?.status) throw error;
    throw Object.assign(new Error(`${path} could not be read as JSON (${error.message}); nothing was changed`), { status: 409 });
  }
}

async function writeConfig(path, config, existed) {
  await mkdir(dirname(path), { recursive: true });
  // One backup per change, next to the file, before Squad writes it.
  if (existed) await copyFile(path, `${path}.squad-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

export async function hookStatus(engine, options = {}) {
  const path = hookConfigPath(engine, options.env, options.home);
  try {
    const { config, existed } = await readConfig(path);
    return { engine, path, exists: existed, installed: hooksInstalled(config) };
  } catch (error) {
    return { engine, path, exists: true, installed: false, error: error.message };
  }
}

export async function installHooks(engine, { nodePath, rootDir, port, env, home } = {}) {
  const path = hookConfigPath(engine, env, home);
  const { config, existed } = await readConfig(path);
  await writeConfig(path, withSquadHooks(config, forwarderCommand({ nodePath, rootDir, engine, port })), existed);
  return { engine, path, exists: true, installed: true };
}

export async function uninstallHooks(engine, { env, home } = {}) {
  const path = hookConfigPath(engine, env, home);
  const { config, existed } = await readConfig(path);
  if (!existed || !hooksInstalled(config)) return { engine, path, exists: existed, installed: false };
  await writeConfig(path, withoutSquadHooks(config), existed);
  return { engine, path, exists: true, installed: false };
}
