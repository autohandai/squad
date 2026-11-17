export function getComputerUseConsentClient({ userAgent = globalThis.navigator?.userAgent || "", invoke = globalThis.window?.__TAURI_INTERNALS__?.invoke } = {}) {
  if (!/^AutohandSquadDesktop\/[^\s]+ \(macos(?:; [^)]*)?\)$/.test(userAgent) || typeof invoke !== "function") return null;
  async function call(command, args) {
    const context = currentOwnership();
    try { return await invoke(command, { ...args, contextGeneration: context?.generation || '' }); }
    catch (error) { throw new Error(typeof error === "string" ? error : error?.message || "Could not update Computer Use permission."); }
  }
  return {
    confirm: (memberId, scope) => call("squad_confirm_computer_use", { memberId, scope }),
    revoke: (memberId) => call("squad_revoke_computer_use", { memberId }),
    setup: () => call("squad_setup_computer_use", {}),
  };
}

function attachmentId(url) {
  let hash = 2166136261;
  for (const character of url) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `computer-${(hash >>> 0).toString(36)}`;
}

/** Only bridge-owned evidence is rendered; model-provided URLs are not media. */
export function computerUseAttachments(files = []) {
  const seen = new Set();
  return (Array.isArray(files) ? files : []).slice(0, 200).flatMap((file) => {
    const url = typeof file?.url === "string" ? file.url : "";
    if (!/^\/api\/computer-use\/evidence\/[a-zA-Z0-9_-]+\/(?:[a-zA-Z0-9_%.-]+\/)*[a-zA-Z0-9_%.-]+\.(?:png|json)$/.test(url) || seen.has(url)) return [];
    const image = url.endsWith(".png");
    if (file.mediaType !== (image ? "image/png" : "application/json")) return [];
    seen.add(url);
    return [{ id: attachmentId(url), name: String(file.name || (image ? "Screenshot" : "Action details")).slice(0, 240), url, size: Math.max(0, Number(file.size) || 0), mime: file.mediaType, kind: image ? "image" : "file" }];
  });
}

export function evidenceForMessage(message, sessions = []) {
  const identity = message?.computerUse;
  if (!identity?.sessionId) return [];
  const stored = sessions.find((session) => session.id === identity.sessionId);
  return computerUseAttachments([...(Array.isArray(identity.files) ? identity.files : []), ...(Array.isArray(stored?.files) ? stored.files : [])]);
}
import { currentOwnership } from "../../lib/ownership-client.js";

/**
 * The one readiness sentence on the Permissions page. When macOS holds the
 * grant for another build of Autohand Computer Use (ADR-0247), System
 * Settings shows the switch on, so "allow it in System Settings" asks for a
 * step the person has already taken; name the real state and the reset.
 */
export function computerUsePermissionMessage({ native, current, ready }) {
  if (!native) return "Open this member’s Permissions page in the Squad desktop app to allow Computer Use.";
  if (!current) return "Checking readiness…";
  if (current.readinessError) return current.readinessError;
  if (!current.available) return "Computer Use readiness could not be confirmed. Install Autohand Computer Use with the button below, or check that this Squad build includes the engine and macOS permission host.";
  if (ready) return "macOS permissions are ready.";
  const product = current.host?.product || "Computer Use";
  const diagnosis = current.grantDiagnosis;
  if (diagnosis?.checked && diagnosis.stale) {
    return `System Settings shows ${product} as allowed, but macOS gave that permission to ${diagnosis.grantedTo || "another build"} of it, not the copy installed now, so macOS ignores it. Reset the macOS permission and allow ${product} again when macOS asks.`;
  }
  const missing = [current.accessibility ? "" : "Accessibility", current.screenRecording ? "" : "Screen Recording"].filter(Boolean).join(" and ") || "Accessibility and Screen Recording";
  const steps = `Allow ${product} in System Settings → Privacy & Security → ${missing}, then check again.`;
  return current.canResetMacGrant ? `${steps} If it is already switched on there, macOS is holding the permission for an older build: reset the macOS permission and allow it again.` : steps;
}
