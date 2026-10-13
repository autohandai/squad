export function getComputerUseConsentClient({ userAgent = globalThis.navigator?.userAgent || "", invoke = globalThis.window?.__TAURI_INTERNALS__?.invoke } = {}) {
  if (!/^AutohandSquadDesktop\/[^\s]+ \(macos(?:; [^)]*)?\)$/.test(userAgent) || typeof invoke !== "function") return null;
  async function call(command, args) {
    try { return await invoke(command, args); }
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
