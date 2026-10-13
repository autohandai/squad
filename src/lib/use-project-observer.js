import { useEffect, useRef, useState } from "react";

/** The main window publishes assignments; every chat may receive durable notices. */
export function useProjectObserver({ api, members, enabled, ready, signedIn, compact, onNotice }) {
  const [state, setState] = useState({ snapshot: null, error: "" });
  const callback = useRef(onNotice);
  const delivered = useRef(new Set());
  callback.current = onNotice;
  const assignments = JSON.stringify(members);
  useEffect(() => {
    if (!ready || compact || !signedIn) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const snapshot = await api("/api/project-observer", { method: "PUT", signal: controller.signal, body: JSON.stringify({ settings: { observeAssignedProjects: enabled }, members: JSON.parse(assignments) }) });
        if (!cancelled) setState({ snapshot, error: "" });
      } catch (error) { if (!cancelled) setState(current => ({ ...current, error: error.message })); }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [api, ready, compact, signedIn, enabled, assignments]);
  useEffect(() => {
    if (!ready || !signedIn) return;
    let cancelled = false;
    let timer;
    async function poll() {
      try {
        const snapshot = await api("/api/project-observer");
        if (!cancelled) {
          setState({ snapshot, error: "" });
          for (const notice of snapshot.notices || []) {
            if (!notice?.id || delivered.current.has(notice.id)) continue;
            delivered.current.add(notice.id);
            callback.current?.(notice);
          }
        }
      } catch (error) { if (!cancelled) setState(current => ({ ...current, error: error.message })); }
      if (!cancelled) timer = setTimeout(poll, 15_000);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, ready, signedIn]);
  return state;
}
