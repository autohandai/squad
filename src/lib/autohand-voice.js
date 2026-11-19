// Autohand Voice in the browser (ADR-0260): the composer's mic asks this
// computer's bridge to record and transcribe on-device (Parakeet), instead of
// the browser's speech service or the Mac's own dictation.
import { ownershipFetch } from "@/lib/ownership-client";

async function call(path, method = "GET") {
  const response = await ownershipFetch(path, { method, headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw Object.assign(new Error(payload?.error || "Autohand Voice did not answer."), { code: payload?.code || "" });
  return payload.data;
}

let statusRequest = null;
/** Cached for the page: whether this computer has on-device voice. */
export function voiceStatus({ fresh = false } = {}) {
  if (!statusRequest || fresh) statusRequest = call("/api/dictation/status").catch(() => ({ available: false }));
  return statusRequest;
}
export const prepareVoice = () => call("/api/dictation/prepare", "POST");
export const startVoice = () => call("/api/dictation/start", "POST");
export const stopVoice = () => call("/api/dictation/stop", "POST");
export const cancelVoice = () => call("/api/dictation/cancel", "POST");

/** Where spoken text goes: after what was typed, with one space between. */
export function appendSpoken(draft, spoken) {
  const typed = String(draft || "");
  const heard = String(spoken || "").trim();
  if (!heard) return typed;
  if (!typed) return heard;
  return /\s$/.test(typed) ? `${typed}${heard}` : `${typed} ${heard}`;
}
