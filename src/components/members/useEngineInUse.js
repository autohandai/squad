import { useCallback, useEffect, useState } from "react";
import { engineInUse } from "@/lib/model-routing";

/**
 * The engine answering a member now, refreshed every 30 s, on focus and after
 * each reply (`refreshKey`). Falls back to "the primary answers" until the
 * router's health has loaded or when it cannot be read.
 */
export function useEngineInUse({ api, agent, harnesses = [], refreshKey }) {
  const [state, setState] = useState({ routing: null, health: {}, at: Date.now() });
  const load = useCallback(async () => {
    if (!api || !agent?.id) return;
    try {
      const data = await api(`/api/members/${encodeURIComponent(agent.id)}/model-routing`);
      setState({ routing: data?.configuration ?? null, health: data?.health || {}, at: Date.now() });
    } catch { /* The header keeps naming the primary. */ }
  }, [api, agent?.id]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [load, refreshKey]);
  return { ...engineInUse({ agent, routing: state.routing, health: state.health, harnesses, now: state.at }), reload: load };
}
