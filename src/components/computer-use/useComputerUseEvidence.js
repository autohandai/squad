import { useEffect, useState } from "react";

/** Durable evidence polling belongs to the open conversation, not a global SSE. */
export function useComputerUseEvidence(memberId, active, api) {
  const [snapshot, setSnapshot] = useState({ memberId: null, sessions: [] });
  useEffect(() => {
    if (!memberId) return undefined;
    const controller = new AbortController();
    let timer;
    async function refresh() {
      try {
        const result = await api(`/api/computer-use/evidence?memberId=${encodeURIComponent(memberId)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setSnapshot({ memberId, sessions: Array.isArray(result?.sessions) ? result.sessions : [] });
      } catch {
        // Existing inline evidence remains readable during a bridge restart.
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, active ? 2500 : 15000);
      }
    }
    void refresh();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [memberId, active, api]);
  return snapshot.memberId === memberId ? snapshot.sessions : [];
}
