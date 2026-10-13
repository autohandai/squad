const PERMISSIONS = new Set(["granted", "denied", "not-determined", "unknown", "unsupported"]);

export function normalizeNativeNotificationPermission(value) {
  return PERMISSIONS.has(value) ? value : "unknown";
}

/** No browser permission is substituted for the native app's OS permission. */
export function getNativeNotificationClient({ userAgent = globalThis.navigator?.userAgent || "", invoke = globalThis.window?.__TAURI_INTERNALS__?.invoke } = {}) {
  if (!/^AutohandSquad(?:Desktop|QuickChat)\/[^\s]+ \(macos(?:; [^)]*)?\)$/.test(userAgent) || typeof invoke !== "function") return null;

  async function invokeCommand(command, args) {
    try { return await invoke(command, args); }
    catch (error) { throw new Error(typeof error === "string" ? error : error?.message || "The native notification action failed."); }
  }

  async function permission({ request = false } = {}) {
    const current = normalizeNativeNotificationPermission((await invokeCommand("squad_notification_permission", { request: false }))?.permission);
    if (!request || current !== "not-determined") return current;
    return normalizeNativeNotificationPermission((await invokeCommand("squad_notification_permission", { request: true }))?.permission);
  }

  return {
    permission,
    async test({ requestPermission = false } = {}) {
      const current = await permission({ request: requestPermission });
      if (current !== "granted") {
        throw new Error(current === "denied" ? "Allow notifications for Autohand Squad in macOS System Settings first." : current === "not-determined" ? "Enable notifications for Autohand Squad before sending a test." : "Could not confirm macOS notification permission. Check System Settings and try again.");
      }
      const result = await invokeCommand("squad_notification_test");
      if (result?.posted !== true) throw new Error(result?.message || "macOS did not confirm notification submission.");
      return result;
    },
    openSettings: () => invokeCommand("squad_notification_settings"),
  };
}

/** Submission is observable; banner display and delivery are not. */
export function notificationTestMessage(result) {
  if (result?.posted !== true) throw new Error(result?.message || "The notification was not accepted for submission.");
  if (typeof result.message === "string" && result.message.trim()) return result.message.trim();
  return result.method === "macos-user-notifications"
    ? "macOS accepted the test notification. Banner display follows your notification settings and Focus mode."
    : "Notification submitted. Display follows your system notification settings.";
}
