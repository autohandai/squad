// Executable discovery for external harnesses. Never runs a shell string:
// every probe is an argument-array spawn with a timeout. GUI processes on
// macOS/Windows inherit a minimal PATH, so discovery also searches the usual
// user tool directories (mirrors `gui_path_env` in the Rust launcher).

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import process from "node:process";

const isWindows = process.platform === "win32";
const home = homedir();

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function versionedBinDirs(root) {
  if (!isDir(root)) return [];
  let entries = [];
  try {
    entries = readdirSync(root).filter((name) => isDir(join(root, name))).sort().reverse().slice(0, 3);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const installation = join(root, name, "installation", "bin");
    const bin = join(root, name, "bin");
    if (isDir(installation)) return [installation];
    if (isDir(bin)) return [bin];
    return [];
  });
}

export function wellKnownToolDirs() {
  const dirs = [];
  if (isWindows) {
    dirs.push(join(home, ".local", "bin"), join(home, ".bun", "bin"), join(home, ".cargo", "bin"), join(home, ".autohand", "bin"));
    if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, "npm"));
    if (process.env.LOCALAPPDATA) {
      dirs.push(
        join(process.env.LOCALAPPDATA, "Programs", "nodejs"),
        join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"),
      );
    }
    if (process.env.ProgramFiles) {
      dirs.push(join(process.env.ProgramFiles, "nodejs"), join(process.env.ProgramFiles, "Git", "bin"));
    }
    return dirs;
  }
  dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/local/sbin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/snap/bin");
  dirs.push(
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".cargo", "bin"),
    join(home, ".autohand", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".claude", "local"),
    join(home, "bin"),
    ...versionedBinDirs(join(home, ".nvm", "versions", "node")),
    ...versionedBinDirs(join(home, ".local", "share", "fnm", "node-versions")),
    ...versionedBinDirs(join(home, "Library", "Application Support", "fnm", "node-versions")),
  );
  return dirs;
}

let cachedPath = null;

/** PATH string with the inherited entries first and well-known tool dirs appended. */
export function guiSafePath() {
  if (cachedPath) return cachedPath;
  const seen = new Set();
  const entries = [];
  const push = (dir) => {
    const value = String(dir || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    entries.push(value);
  };
  for (const dir of String(process.env.PATH || "").split(delimiter)) push(dir);
  for (const dir of wellKnownToolDirs()) push(dir);
  cachedPath = entries.join(delimiter);
  return cachedPath;
}

export function guiSafeEnv(extra = {}) {
  return { ...process.env, PATH: guiSafePath(), ...extra };
}

function candidateNames(name) {
  if (!isWindows) return [name];
  const pathext = String(process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean);
  const names = [name];
  for (const ext of pathext) {
    if (!name.toLowerCase().endsWith(ext.toLowerCase())) names.push(`${name}${ext}`);
  }
  return names;
}

/**
 * Resolve an executable. Order: explicit path (must exist) → PATH search over
 * the GUI-safe PATH. Returns "" when nothing is found.
 */
export function findExecutable(name, { explicitPath = "" } = {}) {
  const explicit = String(explicitPath || "").trim();
  if (explicit) {
    const resolved = isAbsolute(explicit) ? explicit : resolve(explicit);
    return isFile(resolved) ? resolved : "";
  }
  for (const dir of guiSafePath().split(delimiter)) {
    for (const candidate of candidateNames(name)) {
      const full = join(dir, candidate);
      if (isFile(full)) return full;
    }
  }
  return "";
}

/**
 * Run an executable with arguments and a timeout. Returns
 * { ok, stdout, stderr, status, error } without throwing.
 */
export function probe(executable, args = [], { timeoutMs = 10000, cwd = undefined, env = {} } = {}) {
  if (!executable) return { ok: false, stdout: "", stderr: "", status: null, error: "executable not found" };
  const shell = isWindows && /\.(cmd|bat)$/i.test(executable);
  const result = spawnSync(executable, args, {
    cwd,
    env: guiSafeEnv(env),
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    shell,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (result.error) {
    const timedOut = result.error.code === "ETIMEDOUT";
    return { ok: false, stdout, stderr, status: result.status, error: timedOut ? `timed out after ${timeoutMs} ms` : result.error.message };
  }
  return { ok: result.status === 0, stdout, stderr, status: result.status, error: result.status === 0 ? "" : (stderr.trim() || stdout.trim() || `exit ${result.status}`) };
}

/** First semver-like token in a version string, or the trimmed first line. */
export function parseVersion(text) {
  const line = String(text || "").split(/\r?\n/).map((item) => item.trim()).find(Boolean) || "";
  const match = line.match(/(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? match[0] : line;
}

export function compareVersions(a, b) {
  const pa = String(a || "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = String(b || "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((pa[index] || 0) !== (pb[index] || 0)) return (pa[index] || 0) - (pb[index] || 0);
  }
  return 0;
}

/** Replace the home directory prefix so paths can be shown in the UI. */
export function redactHome(path) {
  const value = String(path || "");
  if (!value) return "";
  if (value.startsWith(home)) return `~${value.slice(home.length)}`;
  return value;
}

export function fileExists(path) {
  return Boolean(path) && existsSync(path);
}

export { home as homeDir };
