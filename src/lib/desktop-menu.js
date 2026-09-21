// Native menu bar → web app bridge for the desktop shell (Tauri).
//
// The Rust shell owns the menu (File › New › Agent / Channel, View › Inbox,
// Agents, Channels, Mission Control, Settings, …). Each selection is delivered
// to the page as one DOM event carrying an action id, so the web app keeps a
// single navigation code path and works identically in a browser tab.

export const DESKTOP_MENU_EVENT = "autohand-squad:menu";

export const DESKTOP_MENU_ACTIONS = new Set([
  "new-agent",
  "new-channel",
  "inbox",
  "agents",
  "channels",
  "mission-control",
  "settings",
  "search",
  "toggle-sidebar",
]);

/** Subscribe to native menu selections; returns the unsubscribe function. */
export function onDesktopMenu(handler) {
  function listener(event) {
    const action = String(event?.detail?.action ?? event?.detail ?? "").trim();
    if (DESKTOP_MENU_ACTIONS.has(action)) handler(action);
  }
  window.addEventListener(DESKTOP_MENU_EVENT, listener);
  return () => window.removeEventListener(DESKTOP_MENU_EVENT, listener);
}

/** Dispatch a menu action (used by the shell through `window.eval`, and by tests). */
export function dispatchDesktopMenu(action) {
  window.dispatchEvent(new CustomEvent(DESKTOP_MENU_EVENT, { detail: { action } }));
}
