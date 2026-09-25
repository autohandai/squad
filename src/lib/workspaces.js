// Workspace model for the switcher and relay settings (ADR-0026). Pure: no
// React, no DOM, importable from scripts/check-relay.mjs.
//
// A workspace is either the local one (channels.json on this machine) or a
// relay workspace (the same channels.json, kept in step with a self-hosted
// relay). Members always run on the machine that owns them; ownership is
// derived from the `origin` stamp the owner's bridge puts on their messages.

export const LOCAL_WORKSPACE_ID = "local";

export function relayWorkspaceId(config = {}) {
  const url = String(config.url || "").trim();
  const workspace = String(config.workspace || "").trim().toLowerCase();
  return url && workspace ? `relay:${workspace}@${url.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : "";
}

function hostLabel(host) {
  const value = String(host || "").trim().replace(/\.local$/i, "");
  return value;
}

/** Build the switcher's list: the local workspace first, then the relay workspace when configured. */
export function buildWorkspaceList({ relayConfig = {}, relayStatus = {}, hostName = "", copy = {} } = {}) {
  const list = [
    {
      id: LOCAL_WORKSPACE_ID,
      kind: "local",
      name: copy.localWorkspace || "Local",
      detail: hostLabel(hostName) ? `${copy.onlyOn || "Only on"} ${hostLabel(hostName)}` : copy.localWorkspaceDetail || "Only on this machine",
      connected: true,
      peers: [],
    },
  ];
  const id = relayWorkspaceId(relayConfig);
  if (id) {
    const connected = relayStatus.connected === true;
    const peers = Array.isArray(relayStatus.peers) ? relayStatus.peers : [];
    list.push({
      id,
      kind: "relay",
      name: relayConfig.workspace,
      url: relayConfig.url,
      enabled: relayConfig.enabled === true,
      connected,
      peers,
      detail: relayWorkspaceDetail({ config: relayConfig, status: relayStatus, copy }),
    });
  }
  return list;
}

function relayWorkspaceDetail({ config, status, copy }) {
  if (config.enabled !== true) return copy.relayOff || "Relay off";
  if (status.connected !== true) return status.lastError ? copy.reconnecting || "Reconnecting…" : copy.connecting || "Connecting…";
  const count = Array.isArray(status.peers) ? status.peers.length : 0;
  if (count <= 1) return copy.onlyYouHere || "Only you here";
  return `${count} ${copy.peopleHere || "people here"}`;
}

/** Resolve the selected workspace: falls back to local when the relay one is gone or disabled. */
export function currentWorkspace(list = [], selectedId = LOCAL_WORKSPACE_ID) {
  const match = list.find((item) => item.id === selectedId);
  if (match && (match.kind === "local" || match.enabled)) return match;
  return list.find((item) => item.kind === "local") || list[0] || null;
}

/** Switcher state reducer: { selectedId }. Selecting an unknown id keeps the current one. */
export function selectWorkspace(state = { selectedId: LOCAL_WORKSPACE_ID }, list = [], id = "") {
  if (!list.some((item) => item.id === id)) return state;
  return state.selectedId === id ? state : { ...state, selectedId: id };
}

/**
 * Who runs a member. Looks at the newest agent message from that member: the
 * `origin` stamp names the person and host whose bridge produced it.
 * Returns { ownerName, host, isLocal, known }.
 */
export function memberOwnership(agentId, messages = [], self = {}) {
  const selfHost = hostLabel(self.host);
  const selfName = String(self.name || "").trim();
  let newest = null;
  for (const message of messages) {
    if (message?.agentId !== agentId || message?.role !== "agent" || !message?.origin) continue;
    if (!newest || String(message.updatedAt || "") > String(newest.updatedAt || "")) newest = message;
  }
  if (!newest) return { ownerName: selfName, host: selfHost, isLocal: true, known: false };
  const host = hostLabel(newest.origin.host);
  const ownerName = String(newest.origin.personName || "").trim();
  const isLocal = Boolean(selfHost && host && host === selfHost) || (!host && ownerName && ownerName === selfName);
  return { ownerName, host, isLocal, known: true };
}

function possessive(name) {
  const value = String(name || "").trim();
  if (!value) return "";
  return /s$/i.test(value) ? `${value}’` : `${value}’s`;
}

/** "Runs on Igor's Mac", "Runs on build-box", "Runs here". */
export function ownershipLabel(ownership = {}, copy = {}) {
  if (!ownership || ownership.isLocal || (!ownership.ownerName && !ownership.host)) return copy.runsHere || "Runs here";
  const machine = ownership.host || copy.machine || "machine";
  const owner = ownership.ownerName ? possessive(ownership.ownerName.split(/\s+/)[0]) : "";
  const looksLikeMac = !ownership.host || /\bmac|macbook|imac/i.test(ownership.host);
  const place = owner && looksLikeMac ? `${owner} ${copy.mac || "Mac"}` : owner ? `${owner} ${machine}` : machine;
  return `${copy.runsOn || "Runs on"} ${place}`;
}

/** "Igor and Noah are here", "Noah is here", "" when alone. */
export function peopleSentence(peers = [], self = {}, copy = {}) {
  const others = peers.filter((person) => person && person.id !== self?.id).map((person) => String(person.name || person.id || "").trim()).filter(Boolean);
  if (!others.length) return "";
  if (others.length === 1) return `${others[0]} ${copy.isHere || "is here"}`;
  if (others.length === 2) return `${others[0]} ${copy.and || "and"} ${others[1]} ${copy.areHere || "are here"}`;
  const rest = others.length - 2;
  return `${others[0]}, ${others[1]} ${copy.and || "and"} ${rest} ${rest === 1 ? copy.other || "other" : copy.others || "others"} ${copy.areHere || "are here"}`;
}

function relativeTime(iso, now = Date.now(), copy = {}) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "";
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 10) return copy.justNow || "just now";
  if (seconds < 60) return `${seconds} s ${copy.ago || "ago"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ${copy.ago || "ago"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ${copy.ago || "ago"}`;
  return `${Math.round(hours / 24)} d ${copy.ago || "ago"}`;
}

/** One calm sentence for the settings page. */
export function relayStatusSentence(status = {}, config = {}, copy = {}, now = Date.now()) {
  if (config.enabled !== true) return copy.relayOffSentence || "Relay off. Channels stay on this machine.";
  if (!status.configured) return copy.relayIncomplete || "Add a relay URL, a token and a workspace to connect.";
  const host = String(config.url || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!status.connected) {
    const reason = status.lastError ? ` (${status.lastError})` : "";
    return `${copy.reconnectingTo || "Reconnecting to"} ${host}${reason}…`;
  }
  const who = status.self?.name ? ` ${copy.as || "as"} ${status.self.name}` : "";
  const peers = Array.isArray(status.peers) ? status.peers.length : 0;
  const people = peers <= 1 ? copy.onlyYouOnline || "only you online" : `${peers} ${copy.peopleOnline || "people online"}`;
  const synced = status.lastSync ? `, ${copy.synced || "synced"} ${relativeTime(status.lastSync, now, copy)}` : "";
  return `${copy.connectedTo || "Connected to"} ${host}${who}: ${people}${synced}.`;
}
