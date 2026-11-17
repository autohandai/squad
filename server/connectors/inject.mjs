// How enabled connectors reach a member: the same managed-MCP seam Computer
// Use uses (ADR-0070). Autohand gets entries in its isolated config's
// `mcp.servers`; Claude gets an `--mcp-config` file; Codex gets `-c
// mcp_servers.*` overrides. Entries are named with MANAGED_PREFIX so a later
// turn can replace exactly the entries Squad wrote and nothing the person
// configured themselves.
import { MANAGED_PREFIX } from './store.mjs';

export { MANAGED_PREFIX };

const MODES = new Set(['allow', 'ask', 'block']);

/**
 * The member's `mcp.connectors` policy from the permission ladder
 * (src/App.jsx CLI_PERMISSION_GROUPS, stored as permissions.modes). A
 * member without a recorded mode is treated as the ladder's default, "ask".
 */
export function connectorsPolicy(agent) {
  const modes = agent?.permissions?.modes;
  const mode = modes && typeof modes === 'object' ? modes['mcp.connectors'] : undefined;
  return MODES.has(mode) ? mode : 'ask';
}

/**
 * Only "allow" injects. There is no per-call approval path for MCP tools in
 * the pinned harnesses' non-interactive modes, so "ask" cannot be honoured
 * by prompting; it is treated as not enabled (ADR-0107). "block" never
 * receives a connector.
 */
export function connectorsAllowed(agent) {
  return connectorsPolicy(agent) === 'allow';
}

function isManaged(entry) {
  return typeof entry?.name === 'string' && entry.name.startsWith(MANAGED_PREFIX);
}

/** Autohand `mcp.servers` entries for launch specs. */
export function autohandServersFor(specs) {
  return (specs || []).map((spec) => (spec.kind === 'stdio'
    ? { name: spec.serverName, transport: 'stdio', stdioFraming: spec.framing || 'newline', command: spec.command, args: [...(spec.args || [])], env: { ...(spec.env || {}) }, autoConnect: true }
    : { name: spec.serverName, transport: spec.transport === 'sse' ? 'sse' : 'http', url: spec.url, headers: { ...(spec.headers || {}) }, autoConnect: true }));
}

/**
 * Merge managed entries into a member's `mcp` block. Existing entries the
 * person configured are kept; stale managed entries are replaced; the block
 * is only switched on when something is added.
 */
export function mergeAutohandMcp(mcp, entries) {
  const base = mcp && typeof mcp === 'object' && !Array.isArray(mcp) ? mcp : {};
  const existing = Array.isArray(base.servers) ? base.servers : [];
  const kept = existing.filter((entry) => !isManaged(entry));
  const servers = [...kept, ...(entries || [])];
  return { ...base, servers, ...(entries?.length ? { enabled: true } : {}) };
}

/** Claude Code `--mcp-config` document. */
export function claudeMcpConfig(specs) {
  const mcpServers = {};
  for (const spec of specs || []) {
    mcpServers[spec.serverName] = spec.kind === 'stdio'
      ? { command: spec.command, args: [...(spec.args || [])], env: { ...(spec.env || {}) } }
      : { type: spec.transport === 'sse' ? 'sse' : 'http', url: spec.url, headers: { ...(spec.headers || {}) } };
  }
  return { mcpServers };
}

function tomlTable(map) {
  return `{${Object.entries(map || {}).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(',')}}`;
}

/** Codex `-c key=value` override pairs, flattened for argv. */
export function codexConfigArgs(specs) {
  const args = [];
  for (const spec of specs || []) {
    const prefix = `mcp_servers.${spec.serverName}`;
    if (spec.kind === 'stdio') {
      args.push('-c', `${prefix}.command=${JSON.stringify(spec.command)}`);
      args.push('-c', `${prefix}.args=${JSON.stringify(spec.args || [])}`);
      args.push('-c', `${prefix}.env=${tomlTable(spec.env)}`);
    } else {
      args.push('-c', `${prefix}.url=${JSON.stringify(spec.url)}`);
      if (Object.keys(spec.headers || {}).length) args.push('-c', `${prefix}.http_headers=${tomlTable(spec.headers)}`);
    }
    // Only an "allow" connector is injected, and codex exec cannot ask: without
    // this a tool that needs approval is refused ("requires approval, but
    // approval policy is never").
    args.push('-c', `${prefix}.default_tools_approval_mode="approve"`);
  }
  return args;
}

/** A short instruction so the member knows which connectors it has. */
const GOOGLE_HINTS = {
  gmail: 'gmail_search and gmail_read find and read mail; gmail_create_draft writes a draft; gmail_send sends, so only send when the person asked you to.',
  drive: 'drive_search, drive_recent and drive_read find and read Drive files as text.',
  calendar: 'calendar_list_events reads the calendar; calendar_create_event adds an event without notifying attendees unless asked.',
};
export function connectorInstructions(specs) {
  if (!specs?.length) return '';
  const lines = specs.map((spec) => {
    if (spec.builtin) return `- ${spec.name} (MCP server ${spec.serverName}): web_search finds pages, web_fetch reads one as markdown. Cite the source URLs these tools return.`;
    if (spec.google) return `- ${spec.name} (MCP server ${spec.serverName}): ${GOOGLE_HINTS[spec.google] || ''}`.trimEnd();
    return `- ${spec.name} (MCP server ${spec.serverName}).`;
  });
  return `Connectors enabled for this member through Squad-managed MCP servers:\n${lines.join('\n')}\nUse them through their MCP tools; do not assume any connector that is not listed here. If a connector answers that it needs a sign-in, tell the person to open Settings › Connectors; never ask them to paste a password or token into the chat.`;
}
