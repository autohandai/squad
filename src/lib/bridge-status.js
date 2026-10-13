// What the app says while the local bridge is away (ADR-0123). The desktop
// shell serves the app from the bridge itself, so when the bridge dies the
// page that is already open keeps running; it just stops getting answers.
// One quiet line says so and the presence poll hurries until it is back,
// after which the runtime is re-read so the recovery that keys on
// `serverStartedAt` (interrupted chats, handoffs) runs without a reload.
// Pure, so scripts/check-reliability.mjs can read the wording.

/** The presence poll interval: quick while the bridge is away. */
export const PRESENCE_POLL_MS = 10_000;
export const PRESENCE_POLL_AWAY_MS = 2_000;

export function presencePollInterval(bridgeReachable) {
  return bridgeReachable ? PRESENCE_POLL_MS : PRESENCE_POLL_AWAY_MS;
}

/**
 * One line, or "" when there is nothing to say. `awaySinceMs` is how long the
 * bridge has been unreachable; the first few seconds are not worth a line
 * (a restart takes about two), so the wording changes only past that.
 */
export function bridgeStatusLine({ bridgeReachable = true, awaySinceMs = 0, copy = {} } = {}) {
  if (bridgeReachable) return "";
  if (awaySinceMs < 1500) return "";
  if (awaySinceMs > 60_000) return copy.bridgeAwayLong || "Squad's local service has not answered for a minute. It restarts on its own; if this stays, restart Autohand Squad.";
  return copy.bridgeRestarting || "Squad's local service is restarting. Replies and queues continue once it is back.";
}

/** True once the bridge is back after being away: time to re-read the runtime. */
export function bridgeReturned(previousReachable, reachable) {
  return previousReachable === false && reachable === true;
}
