/** Main window owns the Dock badge; compact chats cannot overwrite attention. */
export function getAttentionBadgeClient({ userAgent = globalThis.navigator?.userAgent || "", invoke = globalThis.window?.__TAURI_INTERNALS__?.invoke } = {}) {
  if (!/^AutohandSquadDesktop\/[^\s]+ \(macos(?:; [^)]*)?\)$/.test(userAgent) || typeof invoke !== "function") return null;
  let desired = null;
  let applied = null;
  let pending = null;
  return {
    setCount(value) {
      if (!Number.isSafeInteger(value) || value < 0) return Promise.reject(new Error("Invalid attention count."));
      desired = Math.min(value, 9999);
      if (pending) return pending;
      pending = (async () => {
        while (desired !== applied) {
          const count = desired;
          const result = await invoke("squad_set_attention_badge", { count });
          if (result?.supported !== true || result.count !== count) throw new Error("macOS did not confirm the attention badge.");
          applied = count;
        }
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}
