// The vault's items on disk: <stateDir>/vault/items.json holds labels, hints
// and sealed values; the key lives elsewhere (keychain.mjs). Every public
// method returns views only; `open()` is the one path to a value and it is
// server-side for the L3 fill path. See ADR-0104.

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { VAULT_KINDS, VaultError, defaultLabel, fieldValue, hintFor, normalizeFields, seal, unseal, view } from "./crypto.mjs";
import { createKeyring } from "./keychain.mjs";

const FILE_VERSION = 1;
const MAX_ITEMS = 500;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function createVaultStore({ stateDir, homeDir, keyring = createKeyring({ stateDir, homeDir }), now = () => new Date().toISOString() }) {
  const file = join(stateDir, "vault", "items.json");
  let queue = Promise.resolve();
  const serial = (operation) => {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  };

  async function read() {
    let raw;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { version: FILE_VERSION, items: [] };
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new VaultError(`The vault file at ${file} is not readable JSON. Fix or move it; Squad will not overwrite it.`, 503);
    }
    if (!record(parsed) || !Array.isArray(parsed.items)) throw new VaultError(`The vault file at ${file} has an unexpected shape.`, 503);
    return { version: FILE_VERSION, items: parsed.items.filter((item) => record(item) && typeof item.id === "string" && VAULT_KINDS.includes(item.kind)) };
  }

  async function write(state) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") await chmod(temporary, 0o600).catch(() => {});
    await rename(temporary, file);
  }

  async function key(state) {
    return keyring.load({ hasItems: state.items.length > 0 });
  }

  return {
    file,
    async list() {
      return (await read()).items.map(view).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    async get(id) {
      const item = (await read()).items.find((entry) => entry.id === id);
      return item ? view(item) : null;
    },
    /** Where the key is held and whether the vault can be opened right now. */
    async status() {
      const state = await read();
      let keySource = keyring.source();
      let locked = false;
      let error = "";
      if (!keySource && state.items.length) {
        locked = true;
        error = "The vault's key is missing, so saved items can't be opened. Remove them and add them again.";
      }
      if (!keySource && !state.items.length) keySource = keyring.sources[0];
      return { count: state.items.length, keySource, locked, error, sources: keyring.sources, file };
    },
    add(kind, input, { label = "" } = {}) {
      return serial(async () => {
        const fields = normalizeFields(kind, input);
        const state = await read();
        if (state.items.length >= MAX_ITEMS) throw new VaultError("The vault is full.");
        const { key: dataKey } = await key(state);
        const id = `vlt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
        const at = now();
        const item = {
          id,
          kind,
          label: String(label || "").trim().slice(0, 60) || defaultLabel(kind, fields),
          hint: hintFor(kind, fields),
          site: kind === "login" ? fields.site : null,
          secret: seal(dataKey, id, kind, fields),
          createdAt: at,
          updatedAt: at,
          lastUsedAt: null,
        };
        state.items.push(item);
        await write(state);
        return view(item);
      });
    },
    remove(id) {
      return serial(async () => {
        const state = await read();
        const index = state.items.findIndex((item) => item.id === id);
        if (index < 0) throw new VaultError("That vault item doesn't exist (any more).", 404);
        const [removed] = state.items.splice(index, 1);
        await write(state);
        return view(removed);
      });
    },
    /**
     * One field's value. Server-side only: the fill path (L3) and the check
     * that proves tampering is detected. Never returned by a route.
     */
    async open(id, field) {
      const state = await read();
      const item = state.items.find((entry) => entry.id === id);
      if (!item) throw new VaultError("That vault item doesn't exist (any more).", 404);
      const { key: dataKey } = await key(state);
      const fields = unseal(dataKey, item.id, item.kind, item.secret, item.label);
      const value = fieldValue(item.kind, fields, field);
      if (!value) throw new VaultError(`“${item.label}” has no ${field.replace(/_/g, " ")} saved.`, 404);
      return value;
    },
    markUsed(id) {
      return serial(async () => {
        const state = await read();
        const item = state.items.find((entry) => entry.id === id);
        if (!item) return null;
        item.lastUsedAt = now();
        await write(state);
        return view(item);
      });
    },
  };
}
