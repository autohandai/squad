const PENDING_KEY = "autohandSquad.v1.systemReset";
let resetPending = false;
if (typeof window !== "undefined") window.addEventListener("storage", event => { if (event.key === PENDING_KEY && event.newValue) resetPending = true; });

export function pendingSystemReset() {
  try { return JSON.parse(globalThis.localStorage?.getItem(PENDING_KEY) || "null"); } catch { return null; }
}
export function isSystemResetPending() {
  resetPending ||= Boolean(pendingSystemReset());
  return resetPending;
}
export function clearSquadBrowserState(storage = globalThis.localStorage) {
  for (const key of Object.keys(storage)) if (key.startsWith("autohandSquad.")) storage.removeItem(key);
}

export function getSystemResetClient({ userAgent = globalThis.navigator?.userAgent || "", invoke = globalThis.window?.__TAURI_INTERNALS__?.invoke } = {}) {
  if (!userAgent.startsWith("AutohandSquadDesktop/") || typeof invoke !== "function") return null;
  return {
    stage: (stage, requestId = null, previousPid = null) => invoke("squad_set_system_reset_stage", { stage, requestId, previousPid }),
    status: pending => invoke("squad_system_reset_status", pending),
    restart: pending => invoke("squad_restart_after_system_reset", pending),
  };
}

async function jsonRequest(path, { signal } = {}) {
  const response = await fetch(path, { signal: signal || AbortSignal.timeout(1500), cache: "no-store" });
  if (!response.ok) throw new Error("Squad's local service has not answered yet.");
  return response.json();
}

export async function recoverSystemReset(pending, { native, timeout = 30_000, request = jsonRequest } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const progress = native ? await native.status(pending) : (await request(`/api/system/reset/status?requestId=${encodeURIComponent(pending.requestId)}&previousPid=${pending.previousPid}`)).data;
      if (progress?.requestId === pending.requestId && ["complete", "failed", "not-started"].includes(progress.phase)) {
        await native?.stage("complete", pending.requestId, pending.previousPid);
        return progress;
      }
    } catch {}
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error("Squad has not confirmed that reset is finished. Keep Squad open and check its status again.");
}

export async function performSystemReset({ api, native, request = jsonRequest, onRecovery = () => {} }) {
  // Prove the service is available before arming a reset which cannot cancel.
  const health = await request("/api/health");
  if (health.service !== "autohand-squad-bridge" || !Number.isInteger(health.pid)) throw new Error("Squad's local service is not ready. Cancel and restart Squad before trying again.");
  const pending = { requestId: crypto.randomUUID(), previousPid: health.pid };
  await native?.stage("working", pending.requestId, pending.previousPid);
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  resetPending = true;
  try {
    const receipt = await api("/api/system/reset", { method: "POST", body: JSON.stringify({ confirm: "RESET", requestId: pending.requestId }), signal: AbortSignal.timeout(30_000) });
    if (receipt.requestId !== pending.requestId || receipt.previousPid !== pending.previousPid || receipt.phase !== "complete") throw new Error("Reset completion could not be confirmed.");
    await native?.stage("complete", pending.requestId, pending.previousPid);
    return receipt;
  } catch {
    onRecovery(pending);
    return recoverSystemReset(pending, { native, request });
  }
}

export async function restartAfterSystemReset(receipt, native, { request = jsonRequest, navigate = () => window.location.assign("/") } = {}) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    let health;
    try {
      health = await request("/api/health");
    } catch {}
    if (health?.service === "autohand-squad-bridge" && health.pid && (receipt.phase !== "complete" || health.pid !== receipt.previousPid)) {
      clearSquadBrowserState();
      if (native) {
        try { await native.restart({ requestId: receipt.requestId, previousPid: receipt.previousPid }); }
        catch (error) { localStorage.setItem(PENDING_KEY, JSON.stringify({ requestId: receipt.requestId, previousPid: receipt.previousPid })); throw error; }
      } else navigate();
      return;
    }
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error("Squad's local service has not restarted yet. Your dated backups are kept. Try Restart Squad again.");
}
