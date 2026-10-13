// A minimal Agent Client Protocol client side: JSON-RPC 2.0 over the stdio
// of a spawned agent, one JSON object per line. No SDK; readline and a map
// of pending requests are all the protocol needs. Protocol read on
// 2026-10-14 from https://agentclientprotocol.com/protocol/overview (v1,
// `protocolVersion: 1`).

import { createInterface } from "node:readline";

export const PROTOCOL_VERSION = 1;

export const JSON_RPC_ERRORS = Object.freeze({
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  // ACP reserves -32000 for "auth required"; the client uses it for refusals too.
  refused: -32000,
});

export class AcpConnection {
  /**
   * @param {{ stdin: import("node:stream").Writable, stdout: import("node:stream").Readable }} child
   * @param {{ onNotification?: (method: string, params: any) => void,
   *           onRequest?: (method: string, params: any, id: any) => Promise<any> | any,
   *           onRaw?: (line: string) => void,
   *           onLine?: (line: string) => void }} handlers
   */
  constructor(child, { onNotification = () => {}, onRequest = async () => { throw rpcError(JSON_RPC_ERRORS.methodNotFound, "method not found"); }, onRaw = () => {}, onLine = () => {} } = {}) {
    this.child = child;
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.onNotification = onNotification;
    this.onRequest = onRequest;
    this.onRaw = onRaw;
    this.onLine = onLine;
    this.reader = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
    this.reader.on("line", (line) => this.handleLine(line));
    child.stdout.on("close", () => this.close(new Error("the agent closed its output")));
  }

  handleLine(line) {
    const text = String(line || "").trim();
    if (!text) return;
    this.onLine(text);
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      this.onRaw(text);
      return;
    }
    if (!message || typeof message !== "object") {
      this.onRaw(text);
      return;
    }
    const hasId = message.id !== undefined && message.id !== null;
    if (typeof message.method === "string") {
      if (hasId) {
        Promise.resolve()
          .then(() => this.onRequest(message.method, message.params ?? {}, message.id))
          .then((result) => this.send({ jsonrpc: "2.0", id: message.id, result: result ?? {} }))
          .catch((error) => this.send({ jsonrpc: "2.0", id: message.id, error: { code: Number(error?.code) || JSON_RPC_ERRORS.internal, message: String(error?.message || error) } }));
      } else {
        try {
          this.onNotification(message.method, message.params ?? {});
        } catch {
          // A listener failure must not break the stream.
        }
      }
      return;
    }
    if (hasId && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(Object.assign(new Error(String(message.error.message || "agent error")), { code: message.error.code, data: message.error.data }));
      else entry.resolve(message.result ?? {});
      return;
    }
    this.onRaw(text);
  }

  send(message) {
    if (this.closed) return false;
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  request(method, params = {}, { timeoutMs = 0 } = {}) {
    if (this.closed) return Promise.reject(new Error("the agent connection is closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.delete(id);
          reject(Object.assign(new Error(`${method} did not answer within ${Math.round(timeoutMs / 1000)} s`), { code: "ETIMEDOUT" }));
        }, timeoutMs)
        : null;
      this.pending.set(id, { resolve, reject, timer });
      if (!this.send({ jsonrpc: "2.0", id, method, params })) {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(new Error("could not write to the agent"));
      }
    });
  }

  notify(method, params = {}) {
    return this.send({ jsonrpc: "2.0", method, params });
  }

  close(error = new Error("connection closed")) {
    if (this.closed) return;
    this.closed = true;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    try {
      this.reader.close();
    } catch {}
  }
}

export function rpcError(code, message, data) {
  return Object.assign(new Error(message), { code, data });
}
