// Managed stdio MCP server for the team (ADR-0134). Each harness (Autohand, Codex,
// Claude) spawns this with a per-work credential; it forwards every JSON-RPC
// request to the local bridge, which owns team memory, the roster and the
// messages members send each other. Both MCP framings are accepted: the pinned Autohand CLI
// speaks Content-Length, Codex and Claude speak newline (ADR-0070).

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_MESSAGE = 4 * 1024 * 1024;
const error = (message) => Object.assign(new Error(message), { status: 400 });

export async function runTeamProxy({ input = process.stdin, output = process.stdout, url = process.env.AUTOHAND_SQUAD_TEAM_URL, token = process.env.AUTOHAND_SQUAD_TEAM_TOKEN, fetchRequest = fetch } = {}) {
  delete process.env.AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN;
  let endpoint;
  try { endpoint = new URL(String(url || "")); } catch { throw error("A local Squad team session is required."); }
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(endpoint.hostname) || endpoint.pathname !== "/api/team/mcp" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !token) {
    throw error("A local Squad team session is required.");
  }
  let buffer = Buffer.alloc(0);
  // Requests run side by side: a squad_message can wait most of a minute for
  // a teammate, and two asked at once, or a squad_team after it, used to
  // queue behind it. Each response is one write, so they never interleave.
  const pending = new Set();
  const start = (body, framing) => {
    const task = receive(body, framing).finally(() => pending.delete(task));
    pending.add(task);
  };
  function write(response, framing) {
    const encoded = Buffer.from(JSON.stringify(response));
    output.write(framing === "header" ? Buffer.concat([Buffer.from(`Content-Length: ${encoded.length}\r\n\r\n`), encoded]) : Buffer.concat([encoded, Buffer.from("\n")]));
  }
  async function receive(body, framing) {
    let request;
    try {
      request = JSON.parse(body.toString());
      if (request.id === undefined) return;
      const response = await fetchRequest(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-squad-team-token": token }, body: JSON.stringify(request), signal: AbortSignal.timeout(150000) });
      const envelope = await response.json();
      if (!response.ok || envelope.success !== true) throw error(envelope.error || "Team request failed.");
      write({ jsonrpc: "2.0", id: request.id, result: envelope.data }, framing);
    } catch (failure) {
      write({ jsonrpc: "2.0", id: request?.id ?? null, error: { code: -32000, message: failure.message } }, framing);
    }
  }
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.length > MAX_MESSAGE) throw error("Team message exceeds its size limit.");
    while (buffer.length) {
      if (buffer.subarray(0, 15).toString().toLowerCase().startsWith("content-length:")) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) break;
        const match = buffer.subarray(0, end).toString().match(/^Content-Length:\s*(\d+)/i);
        const size = Number(match?.[1]);
        if (!Number.isSafeInteger(size) || size > MAX_MESSAGE) throw error("Invalid team message size.");
        if (buffer.length < end + 4 + size) break;
        const body = buffer.subarray(end + 4, end + 4 + size);
        buffer = buffer.subarray(end + 4 + size);
        start(body, "header");
      } else {
        const end = buffer.indexOf("\n");
        if (end < 0) break;
        const body = buffer.subarray(0, end);
        buffer = buffer.subarray(end + 1);
        if (body.length) start(body, "newline");
      }
    }
  }
  await Promise.all(pending);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--mcp")) {
  runTeamProxy().catch(() => { process.stderr.write("Squad team connection failed.\n"); process.exitCode = 1; });
}
