// Why a chat turn stopped, in words (bug hunt 2026-10, #52).
//
// A turn ends when its abort signal fires: the person pressed Stop, or the
// page that streamed it closed (a reload, a closed window). Both used to be
// recorded as "chat stopped by the user", so History blamed the person for a
// reload. The bridge aborts with CLIENT_CLOSED in the second case.
export const CLIENT_CLOSED = "client-closed";

export function clientClosedReason() {
  return Object.assign(new Error("the page that asked for this reply closed"), { code: CLIENT_CLOSED });
}

export function stopMessage(signal) {
  return signal?.reason?.code === CLIENT_CLOSED
    ? "chat ended because the page that asked for it was closed or reloaded"
    : "chat stopped by the user";
}

// The Autohand CLI (0.9.11) ends a turn whose model only narrated, with exit
// code 0 and this as the reply ("…through 2 tool-free recoveries. I stopped
// without marking the task complete…"). Nothing was done, so the run is a
// failure, not a completed reply (ADR-0274).
const GAVE_UP = /^\s*The model kept announcing steps instead of executing them\b/;

/** Why the engine gave up on a turn it reported as finished, or "". */
export function engineGaveUp(reply) {
  return GAVE_UP.test(String(reply || "")) ? "The engine stopped without doing the work: the model kept describing steps instead of running them." : "";
}
