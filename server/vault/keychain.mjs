// Where the vault's 32-byte data key lives. Never beside the data folder.
//
// Order: the OS keychain for this platform (macOS `security`, Windows DPAPI
// through PowerShell, Linux `secret-tool`), then a 0600 file outside the
// Squad state directory. The key is created once and never recreated while
// items exist: a vault whose key is gone says so instead of silently
// becoming a new, empty vault with unreadable leftovers. See ADR-0104.
//
// Checks set AUTOHAND_SQUAD_VAULT_KEY_SOURCE=file so no test touches the
// person's real keychain, and AUTOHAND_SQUAD_VAULT_KEY_FILE to keep the file
// inside their temporary home.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync as nodeSpawnSync } from "node:child_process";

export const KEYCHAIN_SERVICE = "ai.autohand.squad.vault";

export class VaultLockedError extends Error {
  constructor(source) {
    super(`The vault's key is missing${source ? ` from ${source}` : ""}, so saved items can't be opened. If Squad moved to another computer or user account, remove the items and add them again.`);
    this.name = "VaultLockedError";
    this.status = 503;
  }
}

const PS_DPAPI = (verb) => `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($env:AUTOHAND_SQUAD_VAULT_IN); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${verb}($b,$null,'CurrentUser'))`;

function decode(base64) {
  if (!base64) return null;
  const key = Buffer.from(String(base64).trim(), "base64");
  return key.length === 32 ? key : null;
}

/**
 * Build the ordered key stores. Every store is `{ source, read(), write(base64) }`
 * where read returns base64 or null and write returns true on success.
 */
export function createKeyStores({
  stateDir,
  homeDir,
  platform = process.platform,
  env = process.env,
  spawnSync = nodeSpawnSync,
  keyFile = env.AUTOHAND_SQUAD_VAULT_KEY_FILE || join(homeDir, ".autohand", "squad-vault.key"),
} = {}) {
  // One key per state directory, so two Squad installs never share one.
  const account = createHash("sha256").update(String(stateDir)).digest("hex").slice(0, 16);
  const run = (command, args, input, extraEnv) => {
    try {
      return spawnSync(command, args, { input, encoding: "utf8", windowsHide: true, timeout: 15_000, env: extraEnv ? { ...env, ...extraEnv } : env });
    } catch (error) {
      return { status: 1, stdout: "", stderr: String(error?.message || error) };
    }
  };
  const dpapiFile = join(dirname(keyFile), "squad-vault.key.dpapi");
  const stores = [];
  const forced = String(env.AUTOHAND_SQUAD_VAULT_KEY_SOURCE || "").trim();
  if (forced !== "file") {
    if (platform === "darwin") {
      stores.push({
        source: "keychain",
        read: () => {
          const result = run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"]);
          return result.status === 0 ? result.stdout.trim() || null : null;
        },
        write: (base64) => run("security", ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", account, "-l", "Autohand Squad vault", "-w", base64]).status === 0,
      });
    } else if (platform === "win32") {
      stores.push({
        source: "dpapi",
        read: () => {
          if (!existsSync(dpapiFile)) return null;
          const result = run("powershell", ["-NoProfile", "-NonInteractive", "-Command", PS_DPAPI("Unprotect")], undefined, { AUTOHAND_SQUAD_VAULT_IN: readFileSync(dpapiFile, "utf8").trim() });
          return result.status === 0 ? result.stdout.trim() || null : null;
        },
        write: (base64) => {
          const result = run("powershell", ["-NoProfile", "-NonInteractive", "-Command", PS_DPAPI("Protect")], undefined, { AUTOHAND_SQUAD_VAULT_IN: base64 });
          if (result.status !== 0 || !result.stdout.trim()) return false;
          mkdirSync(dirname(dpapiFile), { recursive: true });
          writeFileSync(dpapiFile, result.stdout.trim(), { mode: 0o600 });
          return true;
        },
      });
    } else if (platform === "linux") {
      stores.push({
        source: "secret-service",
        read: () => {
          const result = run("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE, "account", account]);
          return result.status === 0 ? result.stdout.trim() || null : null;
        },
        write: (base64) => run("secret-tool", ["store", "--label=Autohand Squad vault", "service", KEYCHAIN_SERVICE, "account", account], base64).status === 0,
      });
    }
  }
  stores.push({
    source: "file",
    read: () => (existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() || null : null),
    write: (base64) => {
      mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
      writeFileSync(keyFile, base64, { mode: 0o600 });
      return true;
    },
  });
  return { stores, account, keyFile };
}

/**
 * A keyring over the stores: `load({ hasItems })` returns `{ key, source }`,
 * creating the key only when the vault is empty. `source()` reports where the
 * key is held without creating anything.
 */
export function createKeyring(options = {}) {
  const { stores } = createKeyStores(options);
  let cached = null;
  function find() {
    for (const store of stores) {
      const key = decode(store.read());
      if (key) return { key, source: store.source };
    }
    return null;
  }
  return {
    async load({ hasItems = false } = {}) {
      if (cached) return cached;
      const found = find();
      if (found) return (cached = found);
      if (hasItems) throw new VaultLockedError(stores[0]?.source === "file" ? "its key file" : "the OS keychain and the key file");
      const fresh = randomBytes(32);
      for (const store of stores) {
        if (store.write(fresh.toString("base64"))) return (cached = { key: fresh, source: store.source });
      }
      throw Object.assign(new Error("Couldn't store the vault key anywhere on this computer."), { status: 503 });
    },
    source() {
      if (cached) return cached.source;
      return find()?.source || null;
    },
    sources: stores.map((store) => store.source),
    forget() {
      cached = null;
    },
  };
}
