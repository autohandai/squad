// A bound on a call to an engine that may never answer (ADR-0161 §13).
//
// The Agent SDK's requests wait five minutes each by default. A turn whose
// engine had gone silent used to pay that three times over during cleanup
// (interrupt, the change-batch decision, interrupt again) before the process
// was killed, so the chat showed "Working…" for twenty minutes after the
// inactivity window had fired. Cleanup calls go through this instead.
export const ENGINE_CLEANUP_MS = 3000;

export function withDeadline(promise, ms = ENGINE_CLEANUP_MS, label = "the engine") {
  let timer = null;
  const deadline = new Promise((_, reject) => {
    // Not unref'd: the timer is the only thing that settles a promise the
    // engine will never settle, and a drained loop would exit before it.
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} did not answer within ${Math.round(ms / 1000)} s`), { code: "ENGINE_DEADLINE" })), ms);
  });
  return Promise.race([Promise.resolve(promise), deadline]).finally(() => clearTimeout(timer));
}
