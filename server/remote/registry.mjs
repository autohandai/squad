// Remote member registry: which members run on another machine's bridge,
// and which tokens this bridge hands out so other machines can reach it.
//
//   <squadStateDir>/remotes.json  (mode 0600)
//   {
//     "<memberId>": { "url", "token", "label", "addedAt" },
//     "_served": [ { "id", "label", "hash", "createdAt" } ]
//   }
//
// Tokens for remote members are stored in clear because the proxy must send
// them; tokens this bridge serves are stored only as SHA-256 hashes, so a
// minted token is shown once and never readable again.

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { hashToken } from "./auth.mjs";

export const REMOTES_FILE = "remotes.json";
const SERVED_KEY = "_served";
const FILE_MODE = 0o600;

export class RemoteRegistryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "RemoteRegistryError";
    this.status = status;
  }
}

export function normalizeRemoteUrl(value) {
  const text = String(value || "").trim();
  if (!text) throw new RemoteRegistryError("bridge URL is required");
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new RemoteRegistryError(`bridge URL is not a valid URL: ${text}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new RemoteRegistryError("bridge URL must start with http:// or https://");
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

export function normalizeMemberId(value) {
  const id = String(value || "").trim();
  if (!id) throw new RemoteRegistryError("member id is required");
  if (id.startsWith("_") || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new RemoteRegistryError(`member id is not valid: ${id}`);
  }
  return id;
}

/** The shape callers outside the bridge may see: never the token. */
export function publicRemote(memberId, record) {
  if (!record) return null;
  return {
    memberId,
    url: record.url,
    label: record.label,
    addedAt: record.addedAt,
    hasToken: Boolean(record.token),
    ...(record.workspace ? { workspace: record.workspace } : {}),
  };
}

export function publicServedToken(record) {
  return { id: record.id, label: record.label, createdAt: record.createdAt };
}

function labelFor(url, label) {
  const text = String(label || "").trim().slice(0, 80);
  if (text) return text;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function createRemoteRegistry({ squadStateDir, now = () => new Date().toISOString() }) {
  if (!squadStateDir) throw new RemoteRegistryError("squadStateDir is required", 500);
  const path = join(squadStateDir, REMOTES_FILE);
  let queue = Promise.resolve();

  async function read() {
    let text;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new RemoteRegistryError(`${path} is not valid JSON`, 500);
    }
  }

  async function write(state) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: FILE_MODE });
    await chmod(tmp, FILE_MODE).catch(() => {});
    await rename(tmp, path);
    // rename keeps the temp file's mode; enforce again in case the target
    // existed with a looser mode from an older write.
    await chmod(path, FILE_MODE).catch(() => {});
  }

  function serial(task) {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }

  function memberEntries(state) {
    return Object.entries(state).filter(([key, value]) => key !== SERVED_KEY && value && typeof value === "object" && value.url);
  }

  return {
    path,

    /** Register or replace a remote member. Returns the public shape. */
    set(memberId, { url, token, label, workspace } = {}) {
      return serial(async () => {
        const id = normalizeMemberId(memberId);
        const state = await read();
        const existing = state[id] && typeof state[id] === "object" ? state[id] : null;
        const nextUrl = normalizeRemoteUrl(url);
        const nextToken = String(token || "").trim() || (existing ? String(existing.token || "") : "");
        if (!nextToken) throw new RemoteRegistryError("bridge token is required");
        const record = {
          url: nextUrl,
          token: nextToken,
          label: labelFor(nextUrl, label),
          addedAt: existing?.addedAt || now(),
          ...(String(workspace || "").trim() ? { workspace: String(workspace).trim() } : {}),
        };
        state[id] = record;
        await write(state);
        return publicRemote(id, record);
      });
    },

    /** Full record including the token; for the proxy only. */
    async get(memberId) {
      const id = normalizeMemberId(memberId);
      const state = await read();
      const record = state[id];
      return record && typeof record === "object" && record.url ? { memberId: id, ...record } : null;
    },

    remove(memberId) {
      return serial(async () => {
        const id = normalizeMemberId(memberId);
        const state = await read();
        const had = Boolean(state[id]);
        delete state[id];
        await write(state);
        return had;
      });
    },

    /**
     * Every remote member. Public shapes by default; `{ includeTokens: true }`
     * is for the bridge itself and never for a route response.
     */
    async list({ includeTokens = false } = {}) {
      const state = await read();
      return memberEntries(state).map(([id, record]) => (includeTokens ? { memberId: id, ...record } : publicRemote(id, record)));
    },

    /** Hashes of the tokens this bridge accepts from other machines. */
    async servedTokens() {
      const state = await read();
      return Array.isArray(state[SERVED_KEY]) ? state[SERVED_KEY].filter((item) => item && item.hash) : [];
    },

    /** Record a freshly minted token (its hash) under `_served`. */
    addServedToken({ token, label } = {}) {
      return serial(async () => {
        const value = String(token || "").trim();
        if (!value) throw new RemoteRegistryError("token is required");
        const state = await read();
        const served = Array.isArray(state[SERVED_KEY]) ? state[SERVED_KEY] : [];
        const record = {
          id: hashToken(value).slice(0, 12),
          label: String(label || "").trim().slice(0, 80) || "Shared machine",
          hash: hashToken(value),
          createdAt: now(),
        };
        state[SERVED_KEY] = [...served.filter((item) => item?.id !== record.id), record];
        await write(state);
        return publicServedToken(record);
      });
    },

    removeServedToken(id) {
      return serial(async () => {
        const state = await read();
        const served = Array.isArray(state[SERVED_KEY]) ? state[SERVED_KEY] : [];
        const next = served.filter((item) => item?.id !== String(id));
        state[SERVED_KEY] = next;
        await write(state);
        return served.length !== next.length;
      });
    },
  };
}
