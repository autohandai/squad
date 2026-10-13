// Managed stdio MCP server for the vault. Each harness (Autohand, Codex,
// Claude) spawns this with a per-work credential; it forwards every JSON-RPC
// request to the local bridge, which owns the store, the requests and the
// member's session. Both MCP framings are accepted: the pinned Autohand CLI
// speaks Content-Length, Codex and Claude speak newline (ADR-0070).

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_MESSAGE = 4 * 1024 * 1024;
const error = (message) => Object.assign(new Error(message), { status: 400 });

export async function runVaultProxy({ input = process.stdin, output = process.stdout, url = process.env.AUTOHAND_SQUAD_VAULT_URL, token = process.env.AUTOHAND_SQUAD_VAULT_TOKEN, fetchRequest = fetch } = {}) {
  delete process.env.AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN;
  let endpoint;
  try { endpoint = new URL(String(url || "")); } catch { throw error("A local Squad vault session is required."); }
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(endpoint.hostname) || endpoint.pathname !== "/api/vault/mcp" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !token) {
    throw error("A local Squad vault session is required.");
  }
  let buffer = Buffer.alloc(0);
  let pending = Promise.resolve();
  function write(response, framing) {
    const encoded = Buffer.from(JSON.stringify(response));
    output.write(framing === "header" ? Buffer.concat([Buffer.from(`Content-Length: ${encoded.length}\r\n\r\n`), encoded]) : Buffer.concat([encoded, Buffer.from("\n")]));
  }
  async function receive(body, framing) {
    let request;
    try {
      request = JSON.parse(body.toString());
      if (request.id === undefined) return;
      const response = await fetchRequest(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-squad-vault-token": token }, body: JSON.stringify(request), signal: AbortSignal.timeout(45000) });
      const envelope = await response.json();
      if (!response.ok || envelope.success !== true) throw error(envelope.error || "Vault request failed.");
      write({ jsonrpc: "2.0", id: request.id, result: envelope.data }, framing);
    } catch (failure) {
      write({ jsonrpc: "2.0", id: request?.id ?? null, error: { code: -32000, message: failure.message } }, framing);
    }
  }
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.length > MAX_MESSAGE) throw error("Vault message exceeds its size limit.");
    while (buffer.length) {
      if (buffer.subarray(0, 15).toString().toLowerCase().startsWith("content-length:")) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) break;
        const match = buffer.subarray(0, end).toString().match(/^Content-Length:\s*(\d+)/i);
        const size = Number(match?.[1]);
        if (!Number.isSafeInteger(size) || size > MAX_MESSAGE) throw error("Invalid vault message size.");
        if (buffer.length < end + 4 + size) break;
        const body = buffer.subarray(end + 4, end + 4 + size);
        buffer = buffer.subarray(end + 4 + size);
        pending = pending.then(() => receive(body, "header"));
      } else {
        const end = buffer.indexOf("\n");
        if (end < 0) break;
        const body = buffer.subarray(0, end);
        buffer = buffer.subarray(end + 1);
        if (body.length) pending = pending.then(() => receive(body, "newline"));
      }
    }
  }
  await pending;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--mcp")) {
  runVaultProxy().catch(() => { process.stderr.write("Squad vault connection failed.\n"); process.exitCode = 1; });
}
