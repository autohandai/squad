// Warm Autohand SDK sessions per squad member.
//
// Every chat message used to spawn a fresh CLI process (skills, profile,
// workspace index, provider handshake) and tear it down afterwards, so even a
// one-line reply paid several seconds of cold start. The pool keeps one
// started SDK per (member, workspace, launch options) and serialises prompts
// on it, so follow-ups reuse the process and keep the CLI's own conversation
// context. Sessions are closed when they misbehave (stall, timeout, stop,
// error), when the member starts a new conversation, after an idle TTL, or
// when the pool is over capacity (least recently used first).

import { createHash } from "node:crypto";

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function sessionKeyFor({ agentId, workspace, options }) {
  const { timeout, ...rest } = options || {};
  void timeout;
  const digest = createHash("sha256").update(stableStringify({ agentId, workspace, options: rest })).digest("hex").slice(0, 16);
  return `${agentId}:${digest}`;
}

export class SdkSessionPool {
  constructor({ createSdk, maxSessions = 8, idleTtlMs = 15 * 60_000, sweepMs = 60_000, onEvent } = {}) {
    if (typeof createSdk !== "function") throw new Error("SdkSessionPool needs createSdk(options)");
    this.createSdk = createSdk;
    this.maxSessions = maxSessions;
    this.idleTtlMs = idleTtlMs;
    this.sessions = new Map();
    this.onEvent = onEvent || (() => {});
    this.sweepTimer = setInterval(() => void this.sweep(), sweepMs);
    this.sweepTimer.unref?.();
  }

  /**
   * Acquire a started SDK for the given launch. Resolves once no other prompt
   * is using that session. The caller must call `release(healthy)` exactly once.
   */
  async acquire({ agentId, workspace, options, command = "" }) {
    const key = sessionKeyFor({ agentId, workspace, options });
    let session = this.sessions.get(key);
    let created = false;
    if (!session) {
      session = {
        key,
        agentId,
        workspace,
        command,
        sdk: null,
        starting: null,
        lock: Promise.resolve(),
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        prompts: 0,
        busy: false,
      };
      this.sessions.set(key, session);
      created = true;
      session.starting = (async () => {
        const sdk = this.createSdk(options);
        await sdk.start();
        session.sdk = sdk;
      })();
      session.starting.catch(() => {});
      await this.enforceCapacity(key);
    }

    // Serialise prompts on this session.
    const previous = session.lock;
    let unlock;
    session.lock = new Promise((resolve) => {
      unlock = resolve;
    });
    await previous;

    try {
      if (session.starting) await session.starting;
    } catch (error) {
      unlock();
      this.sessions.delete(key);
      throw error;
    }
    if (!session.sdk || this.sessions.get(key) !== session) {
      unlock();
      // Closed while we waited: start over with a fresh session.
      return this.acquire({ agentId, workspace, options, command });
    }

    session.busy = true;
    session.prompts += 1;
    session.lastUsedAt = Date.now();
    this.onEvent(created ? "session_started" : "session_reused", session);
    let released = false;
    const release = async (healthy = true) => {
      if (released) return;
      released = true;
      session.busy = false;
      session.lastUsedAt = Date.now();
      if (!healthy) await this.close(key, "unhealthy");
      unlock();
    };
    return { sdk: session.sdk, session, created, release };
  }

  async close(key, reason = "closed") {
    const session = this.sessions.get(key);
    if (!session) return false;
    this.sessions.delete(key);
    this.onEvent("session_closed", session, reason);
    try {
      if (session.starting) await session.starting.catch(() => {});
      await session.sdk?.interrupt?.().catch(() => {});
      await session.sdk?.close?.();
    } catch {
      // Closing is best effort; the process is dropped either way.
    }
    return true;
  }

  /** Close every session of a member (new conversation, profile change). */
  async reset(agentId, reason = "reset") {
    const keys = Array.from(this.sessions.values())
      .filter((session) => session.agentId === agentId)
      .map((session) => session.key);
    await Promise.all(keys.map((key) => this.close(key, reason)));
    return keys.length;
  }

  async closeAll(reason = "shutdown") {
    clearInterval(this.sweepTimer);
    const keys = Array.from(this.sessions.keys());
    await Promise.all(keys.map((key) => this.close(key, reason)));
    return keys.length;
  }

  async sweep() {
    const now = Date.now();
    for (const session of Array.from(this.sessions.values())) {
      if (!session.busy && now - session.lastUsedAt > this.idleTtlMs) {
        await this.close(session.key, "idle");
      }
    }
  }

  async enforceCapacity(keepKey) {
    while (this.sessions.size > this.maxSessions) {
      const victim = Array.from(this.sessions.values())
        .filter((session) => !session.busy && session.key !== keepKey)
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (!victim) break;
      await this.close(victim.key, "capacity");
    }
  }

  stats() {
    return {
      active: this.sessions.size,
      busy: Array.from(this.sessions.values()).filter((session) => session.busy).length,
      maxSessions: this.maxSessions,
      idleTtlMs: this.idleTtlMs,
      sessions: Array.from(this.sessions.values()).map((session) => ({
        agentId: session.agentId,
        workspace: session.workspace,
        prompts: session.prompts,
        busy: session.busy,
        idleMs: Date.now() - session.lastUsedAt,
        ageMs: Date.now() - session.createdAt,
      })),
    };
  }
}
