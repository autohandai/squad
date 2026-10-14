// Stopped work the person has dealt with and hidden from Needs you. A row is
// hidden at the moment it was hidden: if it changes (fails again, is retried
// and stops again) its time moves on and it comes back. Kept in this browser.
import { useCallback, useEffect, useState } from "react";

export const HIDDEN_STOPPED_KEY = "autohandSquad.v1.hiddenStopped";
const EVENT = "squad:hidden-stopped";

function read() {
  try {
    const value = JSON.parse(window.localStorage.getItem(HIDDEN_STOPPED_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** Is this stopped row hidden, given the stored map? Pure, for checks. */
export function isHiddenStopped(row, hidden = {}) {
  return Boolean(row?.id) && Object.prototype.hasOwnProperty.call(hidden, row.id) && hidden[row.id] === String(row.at || "");
}

/** `[hidden, hide(row), unhideAll()]`, shared by every component that asks. */
export function useHiddenStopped() {
  const [hidden, setHidden] = useState(read);
  useEffect(() => {
    const sync = () => setHidden(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const write = useCallback((next) => {
    try { window.localStorage.setItem(HIDDEN_STOPPED_KEY, JSON.stringify(next)); } catch { /* storage may be off */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  const hide = useCallback((row) => write({ ...read(), [row.id]: String(row.at || "") }), [write]);
  const unhideAll = useCallback(() => write({}), [write]);
  return [hidden, hide, unhideAll];
}
